/**
 * Bunny Edge Storage helpers for the Custom-Landingpage zone.
 *
 * The existing `src/lib/bunny/storage.ts` is hard-wired to the
 * `BUNNY_STORAGE_*` env trio (used for PDFs). Custom-LPs live in a
 * **separate** zone (`BUNNY_CUSTOM_LP_ZONE`, default `videocomet-custom-lp`)
 * so we don't mix tenant content with our system buckets and can rotate
 * keys independently.
 *
 * ENV reads (all optional with sane fallbacks so dev environments work):
 *
 *   - BUNNY_CUSTOM_LP_ZONE         default: "videocomet-custom-lp"
 *   - BUNNY_CUSTOM_LP_ACCESS_KEY   fallback: BUNNY_STORAGE_ACCESS_KEY
 *   - BUNNY_CUSTOM_LP_READONLY_KEY fallback: BUNNY_STORAGE_READONLY_KEY,
 *                                  then BUNNY_CUSTOM_LP_ACCESS_KEY
 *   - BUNNY_CUSTOM_LP_CDN_HOSTNAME optional ("…b-cdn.net"); used to compose
 *                                  read-through URLs for the sandbox. If
 *                                  unset the helpers still work for write
 *                                  paths; only `cdnUrl()` will throw.
 *
 * All write operations use the existing `bunnyFetch` retry/backoff wrapper.
 */

import { bunnyFetch } from "@/lib/bunny/_fetch";

const STORAGE_API_BASE = "https://storage.bunnycdn.com";

export interface CustomLpStorageEnv {
  zone: string;
  accessKey: string;
  readonlyKey: string;
  cdnHostname: string | null;
}

/**
 * Reads the Custom-LP storage env at call-time (not module load) so that
 * tests and dev sessions can override env vars freely.
 */
export function getCustomLpStorageEnv(): CustomLpStorageEnv {
  const zone = process.env.BUNNY_CUSTOM_LP_ZONE || "videocomet-custom-lp";
  const accessKey =
    process.env.BUNNY_CUSTOM_LP_ACCESS_KEY ||
    process.env.BUNNY_STORAGE_ACCESS_KEY ||
    "";
  if (!accessKey) {
    throw new Error(
      "[custom-lp/storage] Es ist kein Schreib-Schlüssel konfiguriert. " +
        "Bitte setzen Sie BUNNY_CUSTOM_LP_ACCESS_KEY oder BUNNY_STORAGE_ACCESS_KEY.",
    );
  }
  const readonlyKey =
    process.env.BUNNY_CUSTOM_LP_READONLY_KEY ||
    process.env.BUNNY_STORAGE_READONLY_KEY ||
    accessKey;
  const cdnHostname = process.env.BUNNY_CUSTOM_LP_CDN_HOSTNAME || null;
  return { zone, accessKey, readonlyKey, cdnHostname };
}

/** Trims leading/trailing slashes from a single path segment. */
function trimSlashes(p: string): string {
  return p.replace(/^\/+/, "").replace(/\/+$/, "");
}

/**
 * Joins a version's storage prefix with a file's relative path. Both are
 * trimmed so we never end up with double slashes (which Bunny treats as a
 * different key).
 */
function joinPath(prefix: string, relPath: string): string {
  return `${trimSlashes(prefix)}/${trimSlashes(relPath)}`;
}

/**
 * Composes the storage prefix used for a (templateId, version) pair.
 * Always ends WITHOUT a trailing slash (so `joinPath` can append cleanly).
 */
export function buildVersionStoragePath(
  templateId: string,
  version: number,
): string {
  return `custom-lp/${templateId}/v${version}`;
}

/** Composes a public CDN URL for a file in the Custom-LP zone. */
export function cdnUrl(remotePath: string): string {
  const env = getCustomLpStorageEnv();
  if (!env.cdnHostname) {
    throw new Error(
      "[custom-lp/storage] BUNNY_CUSTOM_LP_CDN_HOSTNAME ist nicht gesetzt.",
    );
  }
  return `https://${env.cdnHostname}/${trimSlashes(remotePath)}`;
}

export interface UploadFileInput {
  /** Storage prefix for the version, e.g. `custom-lp/<tplId>/v1`. */
  versionStoragePath: string;
  /** Path of the file relative to the version prefix, e.g. `assets/x.png`. */
  filePath: string;
  content: Buffer;
  contentType: string;
}

/**
 * Uploads a single file to the Custom-LP zone. Returns the remote path
 * (without protocol/host) so callers can store it in the file-manifest.
 */
export async function uploadFile(input: UploadFileInput): Promise<{
  remotePath: string;
}> {
  const env = getCustomLpStorageEnv();
  const remote = joinPath(input.versionStoragePath, input.filePath);
  const url = `${STORAGE_API_BASE}/${env.zone}/${remote}`;
  await bunnyFetch(url, {
    method: "PUT",
    headers: {
      AccessKey: env.accessKey,
      "Content-Type": input.contentType || "application/octet-stream",
    },
    body: input.content as unknown as BodyInit,
  });
  return { remotePath: remote };
}

/**
 * Uploads the JSON file-manifest under `<versionStoragePath>/manifest.json`.
 * Convenience wrapper around `uploadFile` so callers don't repeat the path.
 */
export async function uploadManifest(args: {
  versionStoragePath: string;
  manifest: unknown;
}): Promise<{ remotePath: string }> {
  const body = Buffer.from(JSON.stringify(args.manifest, null, 2), "utf8");
  return uploadFile({
    versionStoragePath: args.versionStoragePath,
    filePath: "manifest.json",
    content: body,
    contentType: "application/json; charset=utf-8",
  });
}

export interface StorageObject {
  ObjectName: string;
  Length: number;
  LastChanged: string;
  IsDirectory: boolean;
}

/**
 * Lists the immediate children of `prefix`. Bunny's LIST endpoint is not
 * recursive — to enumerate a deep tree we walk it ourselves.
 */
export async function listFiles(prefix: string): Promise<StorageObject[]> {
  const env = getCustomLpStorageEnv();
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
 * Walks the storage tree at `prefix` and returns every file (not directory).
 * Used by the sandbox subdomain to fetch a specific asset and also by
 * `deleteVersion` to know what to remove.
 */
export async function listFilesRecursive(prefix: string): Promise<string[]> {
  const collected: string[] = [];
  const trimmed = trimSlashes(prefix);

  async function walk(p: string): Promise<void> {
    const children = await listFiles(p);
    for (const c of children) {
      if (c.IsDirectory) {
        const childPath = `${trimSlashes(p)}/${trimSlashes(c.ObjectName)}`;
        await walk(childPath);
      } else {
        collected.push(`${trimSlashes(p)}/${trimSlashes(c.ObjectName)}`);
      }
    }
  }

  await walk(trimmed);
  return collected;
}

/**
 * Deletes a single file. 404 is treated as success (idempotent).
 */
export async function deleteFile(remotePath: string): Promise<void> {
  const env = getCustomLpStorageEnv();
  const url = `${STORAGE_API_BASE}/${env.zone}/${trimSlashes(remotePath)}`;
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

/**
 * Recursively deletes everything under a version's storage prefix. Bunny
 * doesn't expose a "delete prefix" operation, so we LIST + DELETE per file.
 *
 * Errors during individual deletes are logged but do NOT abort the loop —
 * a half-deleted version is better than a stuck request. Callers should
 * still surface the failure to the user (e.g. via the DB row remaining).
 */
export async function deleteVersion(
  versionStoragePath: string,
): Promise<{ deleted: number; failed: number }> {
  let deleted = 0;
  let failed = 0;
  let files: string[];
  try {
    files = await listFilesRecursive(versionStoragePath);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(
      `[custom-lp/storage] listFilesRecursive failed for ${versionStoragePath}:`,
      err,
    );
    return { deleted: 0, failed: 0 };
  }
  for (const f of files) {
    try {
      await deleteFile(f);
      deleted += 1;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(`[custom-lp/storage] deleteFile failed for ${f}:`, err);
      failed += 1;
    }
  }
  return { deleted, failed };
}

/**
 * Reads a file from the Custom-LP zone as a Buffer. Used by the sandbox
 * to stream HTML / JS / assets to the customer's visitor. Throws on 4xx/5xx
 * (the underlying BunnyApiError surfaces the status).
 */
export async function readFile(remotePath: string): Promise<{
  buffer: Buffer;
  contentType: string | null;
}> {
  const env = getCustomLpStorageEnv();
  const url = `${STORAGE_API_BASE}/${env.zone}/${trimSlashes(remotePath)}`;
  const response = await bunnyFetch(url, {
    method: "GET",
    headers: { AccessKey: env.readonlyKey },
  });
  const arrayBuffer = await response.arrayBuffer();
  return {
    buffer: Buffer.from(arrayBuffer),
    contentType: response.headers.get("content-type"),
  };
}
