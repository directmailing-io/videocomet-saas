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
 */
export async function deleteFile(remotePath: string): Promise<void> {
  const env = getBunnyStorageEnv();
  const remote = normalizePath(remotePath);
  await bunnyFetch(`${STORAGE_API_BASE}/${env.zone}/${remote}`, {
    method: "DELETE",
    headers: {
      AccessKey: env.accessKey,
    },
  });
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
