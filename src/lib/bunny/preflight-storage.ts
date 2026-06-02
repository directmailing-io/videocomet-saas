/**
 * Bunny Edge Storage helpers for the Preflight-Screenshot zone.
 *
 * Phase-1 Pre-Flight produces ONE light-weight WebP screenshot per Lead. We
 * keep these in their own zone (`BUNNY_PREFLIGHT_ZONE`, default
 * `videocomet-preflight`) so:
 *   - the 14-day TTL / bulk-delete-by-folder lifecycle can be managed
 *     independently of the long-lived PDF / video zones,
 *   - rotating the access key has zero blast-radius on customer assets,
 *   - listing / cleanup walks don't iterate over millions of unrelated files.
 *
 * Path-Schema: `runs/<runId>/preflight/<leadId>.webp`
 *
 * ENV reads (all lazy at call-time so tests can override per spec):
 *
 *   - BUNNY_PREFLIGHT_ZONE          default: "videocomet-preflight"
 *   - BUNNY_PREFLIGHT_ACCESS_KEY    fallback: BUNNY_STORAGE_ACCESS_KEY
 *   - BUNNY_PREFLIGHT_READONLY_KEY  fallback: BUNNY_STORAGE_READONLY_KEY,
 *                                   then BUNNY_PREFLIGHT_ACCESS_KEY
 *   - BUNNY_PREFLIGHT_CDN_HOSTNAME  required for `cdnUrlFor()` — without it
 *                                   we cannot compose a public read URL and
 *                                   fail fast rather than emit a broken URL.
 *
 * All requests go through the shared `bunnyFetch` retry/backoff wrapper.
 */

import { bunnyFetch } from "@/lib/bunny/_fetch";

const STORAGE_API_BASE = "https://storage.bunnycdn.com";

export interface PreflightStorageEnv {
  zone: string;
  accessKey: string;
  readonlyKey: string;
  cdnHostname: string | null;
}

/**
 * Reads the Preflight storage env at call-time (not module load). Throws
 * only when a write-capable key is missing — read paths and `cdnUrlFor()`
 * surface their own targeted error messages.
 */
export function getPreflightStorageEnv(): PreflightStorageEnv {
  const zone = process.env.BUNNY_PREFLIGHT_ZONE || "videocomet-preflight";
  const accessKey =
    process.env.BUNNY_PREFLIGHT_ACCESS_KEY ||
    process.env.BUNNY_STORAGE_ACCESS_KEY ||
    "";
  if (!accessKey) {
    throw new Error(
      "[preflight/storage] No write access key configured. " +
        "Set BUNNY_PREFLIGHT_ACCESS_KEY or BUNNY_STORAGE_ACCESS_KEY.",
    );
  }
  const readonlyKey =
    process.env.BUNNY_PREFLIGHT_READONLY_KEY ||
    process.env.BUNNY_STORAGE_READONLY_KEY ||
    accessKey;
  const cdnHostname = process.env.BUNNY_PREFLIGHT_CDN_HOSTNAME || null;
  return { zone, accessKey, readonlyKey, cdnHostname };
}

/** Trims leading/trailing slashes — Bunny treats `//` as a different key. */
function trimSlashes(p: string): string {
  return p.replace(/^\/+/, "").replace(/\/+$/, "");
}

/**
 * Composes the canonical object-key for a (runId, leadId) pair.
 * Exported so the worker's processor can construct the same key it later
 * uses for deletion / cdn lookup.
 */
export function buildPreflightObjectKey(runId: string, leadId: string): string {
  return `runs/${runId}/preflight/${leadId}.webp`;
}

/** Composes a public CDN URL for a given Preflight object key. */
export function cdnUrlFor(key: string): string {
  const env = getPreflightStorageEnv();
  if (!env.cdnHostname) {
    throw new Error(
      "[preflight/storage] BUNNY_PREFLIGHT_CDN_HOSTNAME is not set.",
    );
  }
  return `https://${env.cdnHostname}/${trimSlashes(key)}`;
}

export interface UploadPreflightScreenshotInput {
  runId: string;
  leadId: string;
  webp: Buffer;
}

export interface UploadPreflightScreenshotResult {
  url: string;
  key: string;
}

/**
 * Uploads a single WebP screenshot. Returns both the public CDN URL (for
 * the DB) and the raw object-key (for later targeted deletion). Throws when
 * the CDN hostname is not configured — we never want to write to storage
 * we can't read back.
 */
export async function uploadPreflightScreenshot(
  input: UploadPreflightScreenshotInput,
): Promise<UploadPreflightScreenshotResult> {
  const env = getPreflightStorageEnv();
  const key = buildPreflightObjectKey(input.runId, input.leadId);
  const url = `${STORAGE_API_BASE}/${env.zone}/${key}`;
  await bunnyFetch(url, {
    method: "PUT",
    headers: {
      AccessKey: env.accessKey,
      "Content-Type": "image/webp",
    },
    body: input.webp as unknown as BodyInit,
  });
  // cdnUrlFor will fail-fast if no CDN hostname is configured — that is the
  // desired behaviour because a stored screenshot without a read URL is
  // useless to the UI.
  return { url: cdnUrlFor(key), key };
}

/**
 * Deletes a single screenshot. 404 is treated as success so callers can
 * blindly call this on user-rejected leads without race-checking the
 * object's existence first.
 */
export async function deletePreflightScreenshot(key: string): Promise<void> {
  const env = getPreflightStorageEnv();
  const trimmed = trimSlashes(key);
  const url = `${STORAGE_API_BASE}/${env.zone}/${trimmed}`;
  try {
    await bunnyFetch(url, {
      method: "DELETE",
      headers: { AccessKey: env.accessKey },
    });
  } catch (err) {
    const status =
      err instanceof Error && "status" in err
        ? (err as Error & { status: number }).status
        : 0;
    if (status === 404) return;
    throw err;
  }
}

interface BunnyStorageEntry {
  ObjectName: string;
  Length: number;
  LastChanged: string;
  IsDirectory: boolean;
}

/**
 * Lists the immediate children of a storage prefix. Bunny's LIST endpoint
 * is non-recursive; we walk it ourselves below.
 */
async function listChildren(prefix: string): Promise<BunnyStorageEntry[]> {
  const env = getPreflightStorageEnv();
  const trimmed = trimSlashes(prefix);
  const url = `${STORAGE_API_BASE}/${env.zone}/${trimmed}/`;
  const response = await bunnyFetch(url, {
    method: "GET",
    headers: {
      AccessKey: env.readonlyKey,
      Accept: "application/json",
    },
  });
  const json = (await response.json()) as Array<Record<string, unknown>>;
  return json.map((entry) => ({
    ObjectName: String(entry.ObjectName ?? ""),
    Length: Number(entry.Length ?? 0),
    LastChanged: String(entry.LastChanged ?? ""),
    IsDirectory: Boolean(entry.IsDirectory),
  }));
}

/**
 * Recursively enumerates every file (not directory) under `prefix`.
 * Empty list on a 404 / missing prefix — typical for runs that were
 * cancelled before any screenshot landed.
 */
async function listFilesRecursive(prefix: string): Promise<string[]> {
  const collected: string[] = [];

  async function walk(p: string): Promise<void> {
    let children: BunnyStorageEntry[];
    try {
      children = await listChildren(p);
    } catch (err) {
      const status =
        err instanceof Error && "status" in err
          ? (err as Error & { status: number }).status
          : 0;
      // Empty prefix → empty list. Surface anything else.
      if (status === 404) return;
      throw err;
    }
    for (const c of children) {
      if (c.IsDirectory) {
        const childPath = `${trimSlashes(p)}/${trimSlashes(c.ObjectName)}`;
        await walk(childPath);
      } else {
        collected.push(`${trimSlashes(p)}/${trimSlashes(c.ObjectName)}`);
      }
    }
  }

  await walk(trimSlashes(prefix));
  return collected;
}

/**
 * Bulk-delete helper for the 14-day cleanup cron. Walks every file under
 * `runs/<runId>/preflight/` and deletes them one by one. Failures inside
 * the loop are logged but don't abort — a partially deleted run is still
 * better than a deadlocked cleanup.
 */
export async function deletePreflightRun(
  runId: string,
): Promise<{ deleted: number }> {
  const prefix = `runs/${runId}/preflight`;
  let files: string[];
  try {
    files = await listFilesRecursive(prefix);
  } catch (err) {
    console.warn(
      `[preflight/storage] listFilesRecursive failed for ${prefix}:`,
      err,
    );
    return { deleted: 0 };
  }
  let deleted = 0;
  for (const f of files) {
    try {
      await deletePreflightScreenshot(f);
      deleted += 1;
    } catch (err) {
      console.warn(`[preflight/storage] deletePreflightScreenshot failed for ${f}:`, err);
    }
  }
  return { deleted };
}
