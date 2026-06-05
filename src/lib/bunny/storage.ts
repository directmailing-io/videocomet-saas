/**
 * Bunny Edge Storage client (used for PDFs).
 *
 * Base API: https://storage.bunnycdn.com
 * Auth: `AccessKey: <BUNNY_STORAGE_ACCESS_KEY>` header (write key for
 *       PUT/DELETE; read-only key may be used for GET/LIST).
 */

import { getBunnyStorageEnv } from "./env";
import { bunnyFetch } from "./_fetch";

const STORAGE_API_BASE = "https://storage.bunnycdn.com";

export interface UploadFileInput {
  buffer: Buffer;
  remotePath: string;
  contentType: string;
}

export interface UploadFileResult {
  url: string;
  remotePath: string;
}

export interface StorageObject {
  ObjectName: string;
  Length: number;
  LastChanged: string;
}

/** Strips leading/trailing slashes from a path segment. */
function normalizePath(p: string): string {
  return p.replace(/^\/+/, "").replace(/\/+$/, "");
}

/**
 * Uploads a buffer to Bunny Edge Storage.
 */
export async function uploadFile(
  input: UploadFileInput,
): Promise<UploadFileResult> {
  const env = getBunnyStorageEnv();
  const remote = normalizePath(input.remotePath);
  const url = `${STORAGE_API_BASE}/${env.zone}/${remote}`;

  await bunnyFetch(url, {
    method: "PUT",
    headers: {
      AccessKey: env.accessKey,
      "Content-Type": input.contentType,
    },
    // Node Buffer is a Uint8Array subclass; fetch accepts it as body.
    body: input.buffer as unknown as BodyInit,
  });

  return {
    url: `https://${env.cdnHostname}/${remote}`,
    remotePath: remote,
  };
}

/**
 * Deletes a file from Bunny Edge Storage.
 *
 * Single-argument call (`deleteFile("path/to/file")`) verwendet die default-
 * Zone aus `BUNNY_STORAGE_ZONE` — Backwards-compatible mit allen bestehenden
 * Callern.
 *
 * Zwei-Argument-Form (`deleteFile(zone, path)`) erlaubt es dem Purge-Worker,
 * einen Asset aus EINER explizit benannten Zone zu löschen — wir teilen den
 * Worker zwischen mehreren Zones (Bunny-PDF + Bunny-Custom-LP), und der
 * Bunny-Asset-Tracker hält den vollen CDN-Pfad inkl. Zone fest.
 *
 * Achtung: nur die default-Zone hat einen passenden `AccessKey` im
 * `BUNNY_STORAGE_ACCESS_KEY`. Fuer Cross-Zone-Loeschungen muss der Caller
 * (Purge-Worker) sicherstellen, dass die Zone übereinstimmt — sonst kommt
 * Bunny mit 401 zurueck.
 */
export async function deleteFile(remotePath: string): Promise<void>;
export async function deleteFile(zone: string, remotePath: string): Promise<void>;
export async function deleteFile(a: string, b?: string): Promise<void> {
  const env = getBunnyStorageEnv();
  const zone = b === undefined ? env.zone : a;
  const remotePath = b === undefined ? a : b;
  const remote = normalizePath(remotePath);
  await bunnyFetch(`${STORAGE_API_BASE}/${zone}/${remote}`, {
    method: "DELETE",
    headers: {
      AccessKey: env.accessKey,
    },
  });
}

/**
 * Parsed einen Bunny-Storage-CDN-URL in `{ zone, path }` für DELETE-Calls.
 * Pattern: `https://<zone>.b-cdn.net/<path>`. Returnt `null` wenn der URL
 * nicht dem Pattern entspricht (z.B. Stream-URL oder externer Host).
 *
 * Wichtig:
 *  - `<zone>` ist hier der CDN-Hostname-Prefix (z.B. `videocomet-pdf`),
 *    NICHT zwingend identisch mit dem Storage-API-Zone-Namen — beide sind
 *    bei Bunny per Convention gleich, aber abweichbar. Caller muss bei
 *    Zweifel mit `getBunnyStorageEnv().zone` abgleichen.
 *  - Query-Strings und Fragments werden gestrippt; nur der reine Pfad
 *    landet in `path`.
 */
export function parseStorageUrl(
  cdnUrl: string,
): { zone: string; path: string } | null {
  let parsed: URL;
  try {
    parsed = new URL(cdnUrl);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return null;
  }
  const host = parsed.hostname.toLowerCase();
  // Pattern: <zone>.b-cdn.net (single-label sub of b-cdn.net).
  const match = /^([a-z0-9][a-z0-9-]*)\.b-cdn\.net$/.exec(host);
  if (!match) return null;
  const zone = match[1];
  const path = normalizePath(decodeURIComponent(parsed.pathname));
  if (!path) return null;
  return { zone, path };
}

/**
 * Lists files at the given prefix.
 * Bunny returns a JSON array of objects with ObjectName / Length / LastChanged.
 */
export async function listFiles(prefix: string): Promise<StorageObject[]> {
  const env = getBunnyStorageEnv();
  const normalized = normalizePath(prefix);
  // Listing endpoints require a trailing slash on the directory
  const url = `${STORAGE_API_BASE}/${env.zone}/${normalized}/`;

  const response = await bunnyFetch(url, {
    method: "GET",
    headers: {
      AccessKey: env.readonlyKey || env.accessKey,
      Accept: "application/json",
    },
  });

  const json = (await response.json()) as Array<Record<string, unknown>>;
  return json.map((entry) => ({
    ObjectName: String(entry.ObjectName ?? ""),
    Length: Number(entry.Length ?? 0),
    LastChanged: String(entry.LastChanged ?? ""),
  }));
}
