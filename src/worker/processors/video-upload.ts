/**
 * Stage: video-upload (with-presentation pipeline).
 *
 * Erwartet einen BEREITS KOMPRIMIERTEN MP4 (siehe `video-compress.ts` —
 * Paket D fügt den Compress-Step ZWISCHEN render und upload). Bekommt die
 * Datei also bunny-friendly H.264/AAC; Bunny muss nicht re-encoden, der
 * Upload ist schnell und der Endkonsument bekommt sofort eine kleine MP4-
 * Fallback-Variante.
 *
 * Post-Upload: Bunny encoding ist async (kann Minuten dauern). Wir pollen
 * SYNCHRON (bounded, siehe wait-for-bunny-encoding.ts) bis Bunny ready ist
 * und schreiben dann width/height/mp4-Url atomar auf den Lead.
 *
 * WICHTIG (Resume-Pfad): die Bunny-GUID wird SOFORT nach erfolgreichem
 * Upload persistiert (lead.bunnyVideoId), noch BEVOR wir auf das Encoding
 * warten. Wenn der Encoding-Wait timeouted und BullMQ retried, kann der
 * nächste Attempt via `runVideoUploadResume` das BEREITS encodierende Video
 * weiterverwenden statt neu zu rendern + hochzuladen. Vorher hat jeder
 * Retry ein neues Video hochgeladen — die Encoding-Wartezeit begann jedes
 * Mal bei null und die Library-Encoding-Queue wurde mit Duplikaten
 * geflutet (Teufelskreis: je mehr Retries, desto langsamer wurde Bunny).
 */

import {
  deleteVideo,
  getVideo,
  getVideoDownloadUrls,
  streamUrlsFor,
  uploadVideo,
} from "@/lib/bunny/stream";
import { removeStreamAssetRefsForGuids } from "@/lib/db/queries/bunny-assets";
import { updateLeadStatus } from "@/lib/db/queries/leads";
import { waitForBunnyEncoding } from "../lib/wait-for-bunny-encoding";

export interface VideoUploadInput {
  leadId: string;
  videoFilePath: string;
  title: string;
  /** Optional userId — wird für späteres bunny-asset-tracking gebraucht (Paket B). */
  userId?: string;
  /**
   * Content-Fingerprint der Render-Inputs (Review-Fund 5). Wird zusammen mit
   * der GUID persistiert, damit der Resume-Pfad erkennt, ob das existierende
   * Bunny-Video noch zu den aktuellen Inputs passt.
   */
  contentHash?: string;
  /** Heartbeat während des Encoding-Waits (ca. alle 60s) — für Live-Log-Events. */
  onEncodingProgress?: (info: { elapsedMs: number; lastStatus: number }) => void;
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
 * Bunny nach 5 min noch nicht durch ist — BullMQ retried den Job, der Lead
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
  onProgress?: (info: { elapsedMs: number; lastStatus: number }) => void,
): Promise<{
  width: number | null;
  height: number | null;
  mp4Url: string | null;
  orientation: "landscape" | "portrait" | "square" | null;
}> {
  const parsed = parseStreamHlsUrl(hlsUrl);
  if (!parsed) return { width: null, height: null, mp4Url: null, orientation: null };
  // Bounded-Poll auf Bunny-Encoding. Throws nach 5 min (BullMQ-Retry-Pfad).
  const ready = await waitForBunnyEncoding(videoId, { onProgress });
  const width = ready.width > 0 ? ready.width : null;
  const height = ready.height > 0 ? ready.height : null;
  const orientation =
    width != null && height != null ? orientationOf(width, height) : null;
  // Review-Fund 6: `availableResolutions` kann unmittelbar nach dem
  // ready-Signal noch leer sein (Bunny schreibt die Metadaten async nach).
  // Bounded Re-Poll (3 × 8s ≈ 24s) statt sofort mp4=null zu persistieren —
  // bleibt deutlich unter dem 330s-Stage-Timeout.
  let mp4Url: string | null = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const downloads = await getVideoDownloadUrls(videoId, parsed.cdnHostname);
      mp4Url = downloads[0]?.url ?? null;
    } catch (err) {
      console.warn(
        `[video-upload] getVideoDownloadUrls failed for ${videoId} (attempt ${attempt}): ${(err as Error).message}`,
      );
    }
    if (mp4Url != null || attempt === 3) break;
    await new Promise((resolve) => setTimeout(resolve, 8000));
  }
  if (mp4Url == null) {
    // Tolerieren + lassen Public-LP lazy nachsuchen.
    console.warn(
      `[video-upload] no mp4 url resolved for ${videoId} after 3 attempts — persisting null`,
    );
  }
  return { width, height, mp4Url, orientation };
}

async function finishUpload(
  leadId: string,
  videoId: string,
  hlsUrl: string,
  thumbnailUrl: string,
  onProgress?: (info: { elapsedMs: number; lastStatus: number }) => void,
): Promise<VideoUploadOutput> {
  const meta = await resolvePostUploadMeta(videoId, hlsUrl, onProgress);

  await updateLeadStatus(leadId, {
    bunnyVideoId: videoId,
    videoUrl: hlsUrl,
    thumbnailUrl,
    videoWidth: meta.width,
    videoHeight: meta.height,
    videoOrientation: meta.orientation,
    videoMp4Url: meta.mp4Url,
  });

  return {
    bunnyVideoId: videoId,
    videoUrl: hlsUrl,
    thumbnailUrl,
    mp4Url: meta.mp4Url,
    width: meta.width,
    height: meta.height,
    orientation: meta.orientation,
  };
}

export async function runVideoUpload(
  input: VideoUploadInput,
): Promise<VideoUploadOutput> {
  const result = await uploadVideo({
    filePath: input.videoFilePath,
    title: input.title,
  });

  // GUID sofort persistieren (nur die GUID — videoUrl bleibt null, denn
  // `lead.videoUrl != null` bedeutet "Video-Stages komplett fertig" und
  // steuert die Skip-Logik in pipeline.ts). Damit kann ein Retry nach
  // Encoding-Timeout via runVideoUploadResume hier weitermachen.
  await updateLeadStatus(input.leadId, {
    bunnyVideoId: result.videoId,
    videoContentHash: input.contentHash ?? null,
  });

  return finishUpload(
    input.leadId,
    result.videoId,
    result.hlsUrl,
    result.thumbnailUrl,
    input.onEncodingProgress,
  );
}

/**
 * Resume-Pfad für Retries: das Video liegt schon bei Bunny (GUID am Lead),
 * nur der Encoding-Wait ist beim vorigen Attempt getimeouted. Statt neu zu
 * rendern + hochzuladen pollen wir das EXISTIERENDE Video weiter.
 *
 * Returns null wenn das Video nicht weiterverwendbar ist (gelöscht oder
 * Bunny-Encode-Error status=5) — der Caller fällt dann auf den normalen
 * Render+Upload-Pfad zurück.
 */
export async function runVideoUploadResume(input: {
  leadId: string;
  bunnyVideoId: string;
  userId: string;
  onEncodingProgress?: (info: { elapsedMs: number; lastStatus: number }) => void;
}): Promise<VideoUploadOutput | null> {
  let probe: Record<string, unknown>;
  try {
    probe = await getVideo(input.bunnyVideoId);
  } catch (err) {
    console.warn(
      `[video-upload] resume probe failed for ${input.bunnyVideoId}, falling back to fresh upload: ${(err as Error).message}`,
    );
    return null;
  }

  const status = Number(probe.status ?? 0);
  if (status === 5) {
    // Bunny hat die Quelle verworfen — GUID ist tot: Asset-Ref lösen (damit
    // der Purge-Worker das Register aufräumen kann), Video löschen und die
    // Lead-Referenz nullen, damit kein weiterer Retry sie erneut probed.
    await removeStreamAssetRefsForGuids(input.userId, [input.bunnyVideoId], [
      { ownerType: "lead", ownerId: input.leadId },
    ]).catch(() => {});
    await deleteVideo(input.bunnyVideoId).catch(() => {});
    await updateLeadStatus(input.leadId, {
      bunnyVideoId: null,
      videoContentHash: null,
    }).catch(() => {});
    return null;
  }

  const urls = streamUrlsFor(input.bunnyVideoId);
  return finishUpload(
    input.leadId,
    input.bunnyVideoId,
    urls.hlsUrl,
    urls.thumbnailUrl,
    input.onEncodingProgress,
  );
}
