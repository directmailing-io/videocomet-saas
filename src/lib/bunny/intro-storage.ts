/**
 * Bunny-Storage-Helper für das Intro-Feature (Voice-Samples, Raumton,
 * TTS-Zwischenartefakte). Alles landet unter `intro/{userId}/…` in der
 * Default-Storage-Zone (BUNNY_STORAGE_*, gleiche Zone wie PDFs).
 */

import { uploadFile, deleteFile, parseStorageUrl } from "./storage";
import { getBunnyStorageEnv } from "./env";

export interface UploadIntroFileInput {
  userId: string;
  /** Dateiname unterhalb von `intro/{userId}/` (darf Unterordner enthalten). */
  fileName: string;
  buffer: Buffer;
  contentType: string;
}

export async function uploadIntroFile(
  input: UploadIntroFileInput,
): Promise<{ url: string; remotePath: string }> {
  const safeName = input.fileName.replace(/[^a-zA-Z0-9._/-]/g, "_");
  const remotePath = `intro/${input.userId}/${safeName}`;
  return uploadFile({
    buffer: input.buffer,
    remotePath,
    contentType: input.contentType,
  });
}

/**
 * Best-effort-Löschung einer Intro-Datei anhand ihrer CDN-URL. Schluckt
 * alle Fehler (Revoke-Pfad darf an Bunny-Hiccups nicht scheitern) und
 * ignoriert URLs, die nicht auf die eigene Storage-Zone zeigen.
 */
export async function deleteIntroFileByUrl(cdnUrl: string | null | undefined): Promise<void> {
  if (!cdnUrl) return;
  const parsed = parseStorageUrl(cdnUrl);
  if (!parsed) return;
  if (!parsed.path.startsWith("intro/")) return;
  const env = getBunnyStorageEnv();
  const zone = env.cdnHostname.startsWith(`${parsed.zone}.`) ? env.zone : parsed.zone;
  try {
    await deleteFile(zone, parsed.path);
  } catch (err) {
    console.warn(`[intro-storage] delete failed for ${parsed.path}:`, (err as Error).message);
  }
}
