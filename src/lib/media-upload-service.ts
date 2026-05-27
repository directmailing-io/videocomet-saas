/**
 * Media upload service.
 *
 * Routes media uploads to the correct Bunny backend based on the kind:
 *  - "webcam" / "video"  -> Bunny Stream (returns embed/HLS URL)
 *  - "image"  / "logo"   -> Bunny Edge Storage (returns CDN URL)
 *
 * The function returns the canonical public URL that should be stored on
 * the media_items row, plus optional duration (for stream uploads) and the
 * input size in bytes.
 *
 * Logging is prefixed with `[media-upload]` to make log greps trivial.
 */

import { writeFile, unlink, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { uploadVideo, getVideo } from "@/lib/bunny/stream";
import { uploadFile } from "@/lib/bunny/storage";
import { slugify } from "@/lib/utils";

export type MediaKind = "webcam" | "image" | "video" | "logo";

export interface UploadMediaInput {
  userId: string;
  kind: MediaKind;
  filename: string;
  mime: string;
  buffer: Buffer;
}

export interface UploadMediaResult {
  publicUrl: string;
  durationSec: number | null;
  bytes: number;
  bunnyVideoId?: string;
  storagePath?: string;
}

/** Polls Bunny Stream up to `maxAttempts` times to read the encoded duration. */
async function pollStreamDuration(
  videoId: string,
  maxAttempts = 5,
  delayMs = 1500,
): Promise<number | null> {
  for (let i = 0; i < maxAttempts; i += 1) {
    try {
      const meta = await getVideo(videoId);
      const length =
        (meta?.length as number | undefined) ??
        (meta?.duration as number | undefined);
      if (typeof length === "number" && Number.isFinite(length) && length > 0) {
        return Math.round(length);
      }
    } catch (err) {
      console.warn(
        `[media-upload] getVideo poll attempt ${i + 1} failed:`,
        err instanceof Error ? err.message : err,
      );
    }
    if (i < maxAttempts - 1) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  return null;
}

/**
 * Uploads a media buffer to the appropriate Bunny backend.
 * Throws on hard failures; partial failures (e.g. duration polling) return null duration.
 */
export async function uploadMediaFile(
  opts: UploadMediaInput,
): Promise<UploadMediaResult> {
  const { userId, kind, filename, mime, buffer } = opts;
  const bytes = buffer.byteLength;

  console.log(
    `[media-upload] start user=${userId} kind=${kind} filename=${filename} mime=${mime} bytes=${bytes}`,
  );

  if (kind === "webcam" || kind === "video") {
    // Write to a tmp file because Bunny Stream client reads from disk.
    const tmpDir = join(tmpdir(), "videocomet-uploads");
    await mkdir(tmpDir, { recursive: true });
    const tmpPath = join(tmpDir, `${randomUUID()}-${slugify(filename, false) || "upload"}`);

    try {
      await writeFile(tmpPath, buffer);

      const result = await uploadVideo({
        filePath: tmpPath,
        title: filename,
      });

      const durationSec = await pollStreamDuration(result.videoId);

      console.log(
        `[media-upload] stream-upload ok videoId=${result.videoId} duration=${durationSec ?? "n/a"}`,
      );

      return {
        publicUrl: result.hlsUrl,
        durationSec,
        bytes,
        bunnyVideoId: result.videoId,
      };
    } finally {
      // Best-effort cleanup of the tmp file
      try {
        await unlink(tmpPath);
      } catch {
        // ignore
      }
    }
  }

  // image / logo -> Bunny Edge Storage
  const safeName = slugify(filename, false) || "file";
  const remotePath = `users/${userId}/media/${randomUUID()}-${safeName}`;
  const result = await uploadFile({
    buffer,
    remotePath,
    contentType: mime,
  });

  console.log(`[media-upload] storage-upload ok remotePath=${result.remotePath}`);

  return {
    publicUrl: result.url,
    durationSec: null,
    bytes,
    storagePath: result.remotePath,
  };
}

/**
 * Inspects a publicUrl produced by uploadMediaFile and returns either a
 * Bunny Stream videoId (for HLS URLs) or a storage path (for storage CDN URLs).
 * Used by DELETE handlers to clean up the right Bunny backend.
 */
export interface MediaUrlInfo {
  kind: "stream" | "storage" | "unknown";
  videoId?: string;
  storagePath?: string;
}

export function parseMediaUrl(publicUrl: string): MediaUrlInfo {
  try {
    const url = new URL(publicUrl);
    // Bunny Stream HLS URLs look like https://<cdn>/<videoId>/playlist.m3u8
    if (url.pathname.endsWith("/playlist.m3u8")) {
      const parts = url.pathname.split("/").filter(Boolean);
      const videoId = parts[0];
      if (videoId) {
        return { kind: "stream", videoId };
      }
    }
    // Otherwise assume Bunny Storage CDN URL -> path is the storage key.
    const storagePath = url.pathname.replace(/^\/+/, "");
    if (storagePath) {
      return { kind: "storage", storagePath };
    }
  } catch {
    // fall through
  }
  return { kind: "unknown" };
}
