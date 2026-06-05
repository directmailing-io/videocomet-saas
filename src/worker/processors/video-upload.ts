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
  getVideoDownloadUrls,
  uploadVideo,
} from "@/lib/bunny/stream";
import { updateLeadStatus } from "@/lib/db/queries/leads";
import { waitForBunnyEncoding } from "../lib/wait-for-bunny-encoding";

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
 * Wartet SYNCHRON auf Bunny-Encoding (status>=3 ODER availableResolutions!=""),
 * dann liest mp4Url + width/height. Wirft `BunnyEncodingRetryableError` wenn
 * Bunny nach 60 s noch nicht durch ist — BullMQ retried den Job, der Lead
 * bleibt im `uploading`-Status (wir schreiben in dem Pfad NICHT updateLeadStatus).
 *
 * Bug E1: Vorher haben wir EINEN getVideo()-Call gemacht. Wenn Bunny da noch
 * nicht durch war (häufig: 1080p Portrait braucht > sofort), schrieben wir
 * videoMp4Url=null an den Lead, und der Custom-LP-Player fiel auf den
 * hardcoded play_720p.mp4-Pfad zurück → 404 für Portrait-Quellen.
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
  // Bounded-Poll auf Bunny-Encoding. Throws nach 60s (BullMQ-Retry-Pfad).
  const ready = await waitForBunnyEncoding(videoId);
  const width = ready.width > 0 ? ready.width : null;
  const height = ready.height > 0 ? ready.height : null;
  const orientation =
    width != null && height != null ? orientationOf(width, height) : null;
  let mp4Url: string | null = null;
  try {
    const downloads = await getVideoDownloadUrls(videoId, parsed.cdnHostname);
    mp4Url = downloads[0]?.url ?? null;
  } catch (err) {
    // Sollte selten passieren — Bunny hat eben gerade ready gemeldet. Wir
    // tolerieren null + lassen Public-LP lazy nachsuchen.
    console.warn(
      `[video-upload] getVideoDownloadUrls failed for ${videoId}: ${(err as Error).message}`,
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
