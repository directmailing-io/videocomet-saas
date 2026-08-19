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
import { extFromMime } from "@/lib/upload-sniff";
import { slugify } from "@/lib/utils";
import {
  probeVideoBufferDuration,
  probeVideoBufferDimensions,
  probeVideoDimensions,
  probeVideoDuration,
} from "@/lib/ffprobe";
import { trackBunnyAsset } from "@/lib/db/queries/bunny-assets";

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
  /**
   * Native Pixel-Dimensionen der Quelle. Wird via ffprobe gemessen für
   * Video-Uploads (webcam / video). Bei image / logo bleiben die Werte
   * `null`, weil wir dort keine Pipeline-Entscheidung darauf bauen.
   * Server-seitige Detection statt Client-`<video>.videoWidth`: ffprobe
   * sieht das echte Pixel-Format inkl. SAR/DAR und ist unabhängig vom
   * Browser-State (ein offener Tab könnte sonst die Werte falsch reporten).
   */
  width: number | null;
  height: number | null;
  bunnyVideoId?: string;
  storagePath?: string;
  /**
   * ID der `bunny_assets`-Zeile, die für dieses Upload registriert wurde.
   * Nur gesetzt, wenn das Asset in Bunny landet (`video` oder `webcam`).
   * Der Caller MUSS nach dem Erzeugen des Owner-Rows (`mediaItem.id`)
   * `addBunnyAssetRef(bunnyAssetId, 'media_item', mediaItem.id)` aufrufen,
   * sonst gilt das Asset beim nächsten Orphan-Sweep als verwaist und wird
   * im Hintergrund von Paket E gepurged.
   */
  bunnyAssetId?: string;
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

  // Webcam recordings are PIPELINE SOURCES: the render worker needs to
  // download them as raw MP4. Bunny Stream is great for player embedding
  // (HLS) but cannot serve direct MP4 from edge without signed URLs, so we
  // store webcam sources in Edge Storage where direct .mp4 GET works.
  //
  // The final per-lead personalised videos still go to Bunny Stream (done
  // in the worker's video-upload processor), where the player embed is
  // exactly what we want.
  if (kind === "video") {
    // Generic "video" media (e.g. a 800MB iPhone-MP4 the user uploaded) -> Stream.
    //
    // Pipeline:
    //   1. write raw upload to /tmp/<uuid>.<ext>
    //   2. ffprobe für (width, height) UND duration auf der QUELLE
    //   3. uploadVideo (ORIGINAL-Datei) → Bunny Stream
    //   4. trackBunnyAsset für späteres Cleanup (Paket E)
    //   5. /tmp aufräumen
    //
    // BEWUSST KEINE Server-Kompression mehr (Perf-Paket 2026-08-19): Bunny
    // Stream re-encodiert jede Quelle ohnehin in seine Renditionen — der
    // frühere libx264-Encode (30-90s bei 1-min-Handyvideos) verdoppelte nur
    // die Encode-Arbeit, blockierte die HTTP-Antwort und damit die Szene im
    // Studio. Trade-off: die Original-Datei liegt unkomprimiert bei Bunny
    // (Storage-Cent-Beträge) — dafür ist die Szene in Sekunden nutzbar.
    const tmpDir = join(tmpdir(), "videocomet-uploads");
    await mkdir(tmpDir, { recursive: true });
    const baseName = slugify(filename, false) || "upload";
    const uid = randomUUID();
    const dotIdx = filename.lastIndexOf(".");
    const inExt = (dotIdx > 0 ? filename.slice(dotIdx + 1) : "mp4")
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "") || "mp4";
    const tmpInputPath = join(tmpDir, `${uid}-${baseName}.${inExt}`);

    try {
      await writeFile(tmpInputPath, buffer);

      // ── Probe Source (dims + duration) ─────────────────────────────────
      // Wir messen Source-Dims weil das Render-/Player-Aspect am Source-
      // Material hängt; die Stream-Re-Encode-Dims müssen davon nicht
      // abweichen, sind aber theoretisch nicht garantiert identisch.
      let width: number | null = null;
      let height: number | null = null;
      try {
        const dims = await probeVideoDimensions(tmpInputPath);
        if (dims) {
          width = dims.width;
          height = dims.height;
        }
      } catch (err) {
        console.warn(
          "[media-upload] video dimension probe failed:",
          err instanceof Error ? err.message : err,
        );
      }
      let sourceDurationSec: number | null = null;
      try {
        const probed = await probeVideoDuration(tmpInputPath);
        if (probed !== null) sourceDurationSec = Math.round(probed);
      } catch (err) {
        console.warn(
          "[media-upload] video duration probe failed:",
          err instanceof Error ? err.message : err,
        );
      }

      // ── Upload (Original) ──────────────────────────────────────────────
      const result = await uploadVideo({ filePath: tmpInputPath, title: filename });

      // Dauer kommt aus dem ffprobe der Quelle. Das Bunny-Encoding-Poll
      // (bis 7,5s Wartezeit) läuft NUR noch, wenn der Probe scheiterte —
      // vorher wartete jeder Upload grundlos darauf.
      const durationSec =
        sourceDurationSec ?? (await pollStreamDuration(result.videoId));
      console.log(
        `[media-upload] stream-upload ok videoId=${result.videoId} duration=${durationSec ?? "n/a"} dims=${width ?? "n/a"}x${height ?? "n/a"} bytes=${bytes}`,
      );

      // ── Register asset für Cleanup-Tracking (Paket E) ──────────────────
      // Caller MUSS nach createMediaItem `addBunnyAssetRef(assetId,
      // 'media_item', mediaItem.id)` aufrufen, sonst rutscht das Asset im
      // nächsten Orphan-Sweep auf purge_pending.
      let bunnyAssetId: string | undefined;
      try {
        const tracked = await trackBunnyAsset({
          userId,
          kind: "stream",
          bunnyId: result.videoId,
          cdnUrl: result.hlsUrl,
          width,
          height,
          bytes,
        });
        bunnyAssetId = tracked.assetId;
      } catch (err) {
        // Tracking-Fehler darf den Upload nicht killen — der Sweeper hat
        // sowieso einen Fallback (Asset bleibt live, wird beim nächsten
        // referenzierenden Upload deduplizered).
        console.warn(
          "[media-upload] trackBunnyAsset (stream) failed:",
          err instanceof Error ? err.message : err,
        );
      }

      return {
        publicUrl: result.hlsUrl,
        durationSec,
        width,
        height,
        bytes,
        bunnyVideoId: result.videoId,
        bunnyAssetId,
      };
    } finally {
      try { await unlink(tmpInputPath); } catch { /* ignore */ }
    }
  }

  // webcam / image / logo -> Bunny Edge Storage (direct mp4/png GET works).
  // WICHTIG: Bunny Storage liefert den content-type basierend auf der
  // Datei-Endung. Die Endung kommt deshalb aus dem (allowlisted bzw. per
  // Magic Bytes verifizierten) MIME-Typ — NIE aus dem Dateinamen. Sonst
  // würde "bild.html" mit Fake-MIME vom CDN als text/html ausgeliefert
  // (Stored XSS, Security-Review 2026-08-15).
  const dotIdx = filename.lastIndexOf(".");
  const rawBase = dotIdx > 0 ? filename.slice(0, dotIdx) : filename;
  const safeBase = slugify(rawBase, false) || "file";
  const safeExt = extFromMime(mime) ?? "";
  const safeName = safeExt ? `${safeBase}.${safeExt}` : safeBase;
  const folder = kind === "webcam" ? "webcam" : "media";
  const remotePath = `users/${userId}/${folder}/${randomUUID()}-${safeName}`;
  const result = await uploadFile({
    buffer,
    remotePath,
    contentType: mime,
  });

  // KRITISCH für Webcam-Uploads: echte Dauer probe, sonst landet
  // mediaItems.durationSec = NULL → Render-Worker fällt auf 30s-Fallback
  // zurück → finales Video kann LÄNGER als die Webcam werden (Prod-Bug
  // 2026-06-03: 6s-Webcam → 22s-Video). Bei image/logo überspringen wir
  // den Probe — kein Video, keine Dauer.
  //
  // ZUSÄTZLICH: Pixel-Dimensionen probe für Webcam (Portrait vs Landscape).
  // Beide Probes greifen auf denselben Buffer zu — einmal nach /tmp
  // schreiben würde minimal sparen, ist aber Overkill: jeder Probe schreibt
  // selbst nur ein paar MB temporär raus.
  let durationSec: number | null = null;
  let width: number | null = null;
  let height: number | null = null;
  if (kind === "webcam") {
    try {
      const probed = await probeVideoBufferDuration(buffer, safeExt || "webm");
      if (probed !== null) {
        // Column ist integer — auf ganze Sekunden runden (so verhält sich
        // auch der Stream-Pfad in pollStreamDuration).
        durationSec = Math.round(probed);
        console.log(
          `[media-upload] webcam duration probed=${durationSec}s remotePath=${result.remotePath}`,
        );
      } else {
        console.warn(
          `[media-upload] webcam duration probe FAILED — durationSec stays NULL, worker will fallback. remotePath=${result.remotePath}`,
        );
      }
    } catch (err) {
      console.warn(
        "[media-upload] ffprobe-Aufruf gescheitert:",
        err instanceof Error ? err.message : err,
      );
    }
    try {
      const dims = await probeVideoBufferDimensions(buffer, safeExt || "webm");
      if (dims) {
        width = dims.width;
        height = dims.height;
        console.log(
          `[media-upload] webcam dims probed=${width}x${height} (orientation=${width >= height ? "landscape" : "portrait"})`,
        );
      } else {
        console.warn(
          `[media-upload] webcam dimension probe returned null — width/height stay NULL, worker falls back to landscape default.`,
        );
      }
    } catch (err) {
      console.warn(
        "[media-upload] ffprobe dimension probe failed:",
        err instanceof Error ? err.message : err,
      );
    }
  }

  console.log(`[media-upload] storage-upload ok remotePath=${result.remotePath}`);

  // ── Bunny-Asset-Tracking (nur webcam) ─────────────────────────────────
  // Webcam-Source bleibt unkomprimiert für spätere Re-Renders der Pipeline.
  // Trotzdem will Paket E (Purge-Worker) das Asset kennen, damit beim
  // media-item-Delete sauber aufgeräumt wird. Für image/logo verzichten wir
  // auf Tracking — die Footprints sind klein und die Cleanup-Risiken anders
  // skaliert (Branding-Assets sollen tendenziell nicht versehentlich
  // gepurged werden).
  let bunnyAssetId: string | undefined;
  if (kind === "webcam") {
    try {
      const tracked = await trackBunnyAsset({
        userId,
        kind: "storage",
        bunnyId: result.remotePath,
        cdnUrl: result.url,
        width,
        height,
        bytes,
      });
      bunnyAssetId = tracked.assetId;
    } catch (err) {
      console.warn(
        "[media-upload] trackBunnyAsset (storage/webcam) failed:",
        err instanceof Error ? err.message : err,
      );
    }
  }

  return {
    publicUrl: result.url,
    durationSec,
    width,
    height,
    bytes,
    storagePath: result.remotePath,
    bunnyAssetId,
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
