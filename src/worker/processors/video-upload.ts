/**
 * Stage: video-upload (with-presentation pipeline).
 *
 * Erwartet einen BEREITS KOMPRIMIERTEN MP4 (siehe `video-compress.ts` —
 * Paket D fügt den Compress-Step ZWISCHEN render und upload). Bekommt die
 * Datei also bunny-friendly H.264/AAC; Bunny muss nicht re-encoden, der
 * Upload ist schnell und der Endkonsument bekommt sofort eine kleine MP4-
 * Fallback-Variante.
 *
 * Post-Upload: Bunny encoding ist async (kann Minuten dauern). Wir machen
 * EINEN best-effort `getVideo()`-Poll-Roundtrip um width/height/mp4-Url
 * synchron auf den Lead zu schreiben. Falls Bunny noch nicht durch ist
 * (status<3, encodeProgress<100), bleibt `videoMp4Url` initial NULL und der
 * öffentliche LP-Renderer (Paket C) löst es lazy auf wenn er die LP
 * rendert.
 *
 * Retries sind via BullMQ (3 Attempts, expo backoff) — wir failen hier
 * schnell, damit die Queue übernimmt.
 */

import {
  getVideo,
  getVideoDownloadUrls,
  uploadVideo,
} from "@/lib/bunny/stream";
import { updateLeadStatus } from "@/lib/db/queries/leads";

export interface VideoUploadInput {
  leadId: string;
  videoFilePath: string;
  title: string;
  /** Optional userId — wird für späteres bunny-asset-tracking gebraucht (Paket B). */
  userId?: string;
}

export interface VideoUploadOutput {
  bunnyVideoId: string;
  videoUrl: string;
  thumbnailUrl: string;
  /** Beste verfügbare MP4-URL (null wenn Bunny encode noch nicht fertig). */
  mp4Url: string | null;
  width: number | null;
  height: number | null;
  orientation: "landscape" | "portrait" | "square" | null;
}

function parseStreamHlsUrl(
  rawUrl: string,
): { cdnHostname: string; guid: string } | null {
  const m = rawUrl.match(
    /^https?:\/\/([^/]+)\/([0-9a-f-]{36})\/playlist\.m3u8(?:\?.*)?$/i,
  );
  if (!m) return null;
  return { cdnHostname: m[1], guid: m[2] };
}

function orientationOf(
  w: number,
  h: number,
): "landscape" | "portrait" | "square" {
  if (w === h) return "square";
  return w > h ? "landscape" : "portrait";
}

/**
 * Probt Bunny-Meta + MP4-Fallback. Bunny-`status`:
 *   0 = created, 1 = uploaded, 2 = processing, 3 = transcoding, 4 = finished, 5 = error.
 * Pragmatisch: wir akzeptieren `status >= 3` ODER `availableResolutions` non-empty.
 */
async function resolvePostUploadMeta(
  videoId: string,
  hlsUrl: string,
): Promise<{
  width: number | null;
  height: number | null;
  mp4Url: string | null;
  orientation: "landscape" | "portrait" | "square" | null;
}> {
  const parsed = parseStreamHlsUrl(hlsUrl);
  if (!parsed) return { width: null, height: null, mp4Url: null, orientation: null };
  let width: number | null = null;
  let height: number | null = null;
  let mp4Url: string | null = null;
  let orientation: "landscape" | "portrait" | "square" | null = null;
  try {
    const meta = await getVideo(videoId);
    const w = Number(meta.width ?? 0);
    const h = Number(meta.height ?? 0);
    if (w > 0 && h > 0) {
      width = w;
      height = h;
      orientation = orientationOf(w, h);
    }
    // Status-Check: encode fertig genug für MP4-Fallback?
    const status = Number(meta.status ?? 0);
    const hasMp4 = String(meta.availableResolutions ?? "").trim().length > 0;
    if (status >= 3 || hasMp4) {
      try {
        const downloads = await getVideoDownloadUrls(
          videoId,
          parsed.cdnHostname,
        );
        mp4Url = downloads[0]?.url ?? null;
      } catch (err) {
        console.warn(
          `[video-upload] getVideoDownloadUrls failed for ${videoId}: ${(err as Error).message}`,
        );
      }
    }
  } catch (err) {
    console.warn(
      `[video-upload] getVideo failed for ${videoId}: ${(err as Error).message}`,
    );
  }
  return { width, height, mp4Url, orientation };
}

export async function runVideoUpload(
  input: VideoUploadInput,
): Promise<VideoUploadOutput> {
  const result = await uploadVideo({
    filePath: input.videoFilePath,
    title: input.title,
  });

  // Best-effort: Bunny-Meta + MP4-URL holen. Wenn die Encoding-Pipeline noch
  // nicht durch ist, bleiben width/height/mp4Url null — das ist OK, der
  // public-LP-Renderer (Paket C) löst es lazy auf.
  const meta = await resolvePostUploadMeta(result.videoId, result.hlsUrl);

  await updateLeadStatus(input.leadId, {
    bunnyVideoId: result.videoId,
    videoUrl: result.hlsUrl,
    thumbnailUrl: result.thumbnailUrl,
    videoWidth: meta.width,
    videoHeight: meta.height,
    videoOrientation: meta.orientation,
    videoMp4Url: meta.mp4Url,
  });

  return {
    bunnyVideoId: result.videoId,
    videoUrl: result.hlsUrl,
    thumbnailUrl: result.thumbnailUrl,
    mp4Url: meta.mp4Url,
    width: meta.width,
    height: meta.height,
    orientation: meta.orientation,
  };
}
