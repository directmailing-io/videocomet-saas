/**
 * Stage: video-resolve-shared (webcam-only mode).
 *
 * Resolves the SINGLE shared video for an entire run when the campaign is
 * `webcam-only` (no presentation, every lead shares the same video).
 *
 * Three sub-paths:
 *
 *   1. Bunny-Stream-HLS Source (`vz-*.b-cdn.net/<guid>/playlist.m3u8`):
 *      Guid extrahieren, Metadata via `getVideo(guid)` (width/height/MP4-
 *      URL), atomic claim, setReady. KEIN Upload — die Source IST schon in
 *      Bunny Stream.
 *
 *   2. Bunny-Storage-URL (Webcam-Recording → MP4 / WebM im Storage-Bucket):
 *      Download mit Referer-Header, compressForBunny, uploadVideo. Lock-
 *      Owner schreibt das Resultat; andere Worker pollen via
 *      `getSharedRunVideoState` bis `state='ready'`.
 *
 *   3. Bereits in `state='ready'`: direkt aus runs.* lesen + zurückgeben.
 *
 * Concurrency-Safety: `claimSharedVideoUpload()` ist atomar. Wenn jemand
 * anders gerade arbeitet, fallen wir in den Poll-Loop (1.5s × 2min Cap).
 */

import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { runs } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import {
  deleteVideo,
  getVideo,
  getVideoDownloadUrls,
  uploadVideo,
} from "@/lib/bunny/stream";
import { insertPipelineEvent } from "@/lib/db/queries/pipeline-events";
import {
  claimSharedVideoUpload,
  clearSharedVideoUploadRecord,
  getSharedRunVideoState,
  markSharedVideoUploading,
  recordSharedVideoUpload,
  setSharedVideoFailed,
  setSharedVideoReady,
  touchSharedVideoLock,
  type SharedVideoState,
} from "../lib/shared-run-video";
import { compressForBunny, type VideoOrientation } from "../lib/video-compress";
import { trackAndRefAsset } from "../lib/bunny-asset-tracking";
import {
  waitForBunnyEncoding,
  BunnyEncodingRetryableError,
} from "../lib/wait-for-bunny-encoding";

const POLL_INTERVAL_MS = 1500;
// Nicht-Lock-Owner warten so lange wie der Owner maximal aufs Encoding wartet
// (plus Puffer) — sonst failen 19 von 20 Lead-Jobs während der Owner noch
// legitim auf Bunny wartet.
const POLL_TIMEOUT_MS = 5 * 60_000;

/**
 * Wie lange der Lock-Owner PRO Job-Attempt auf Bunnys Encoding wartet. Bunny-
 * Backlogs von mehreren Minuten sind real (Incident 2026-07-16: Library-weiter
 * Encoding-Stau). Mit attempts:2 + Watchdog-Re-Enqueue ergibt das ein Gesamt-
 * Fenster von ~12 min — und dank idempotentem Upload (persistierte videoId)
 * kostet jeder weitere Versuch nur Warten, keinen erneuten Upload.
 */
const SHARED_ENCODING_TIMEOUT_MS = 4 * 60_000;
const SHARED_ENCODING_POLL_MS = 10_000;

/**
 * Intervall für den Stale-Lock-Heartbeat während compress/upload läuft (Bug E2).
 * `STALE_LOCK_MINUTES=5` in shared-run-video.ts ist die Schwelle — wir
 * refreshen alle 30 s, das gibt 10× Sicherheits-Faktor.
 */
const SHARED_LOCK_HEARTBEAT_MS = 30_000;

export interface VideoResolveSharedInput {
  runId: string;
  userId: string;
  webcamMediaUrl: string;
}

export interface VideoResolveSharedOutput {
  bunnyVideoId: string;
  hlsUrl: string;
  thumbnailUrl: string;
  mp4Url: string | null;
  width: number | null;
  height: number | null;
  orientation: VideoOrientation;
  /** Bunny-Asset-Row-ID (für späteres addBunnyAssetRef(lead)). Null wenn Tracking fehlschlug. */
  bunnyAssetId: string | null;
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

function buildThumbnailUrl(cdnHostname: string, guid: string): string {
  return `https://${cdnHostname}/${guid}/thumbnail.jpg`;
}

function buildHlsUrl(cdnHostname: string, guid: string): string {
  return `https://${cdnHostname}/${guid}/playlist.m3u8`;
}

function orientationFromDims(w: number, h: number): VideoOrientation {
  if (w === h) return "square";
  return w > h ? "landscape" : "portrait";
}

/**
 * Polling-Loop für Worker, die den Lock NICHT bekommen haben. Wartet bis
 * `state='ready'` oder Timeout. State='failed' bricht den Poll, damit der
 * Caller selbst neu claimen kann (Retry-Pfad in BullMQ).
 */
async function pollForReady(runId: string): Promise<VideoResolveSharedOutput> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < POLL_TIMEOUT_MS) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    const cur = await getSharedRunVideoState(runId);
    if (!cur) {
      throw new Error(
        `[video-resolve-shared] run vanished while polling: ${runId}`,
      );
    }
    if (cur.state === "ready" && cur.bunnyVideoId && cur.videoUrl) {
      return finalizeReadyState(runId, cur);
    }
    if (cur.state === "failed") {
      throw new Error(
        `[video-resolve-shared] shared upload failed (run=${runId}) — retry will re-claim`,
      );
    }
  }
  throw new Error(
    `[video-resolve-shared] poll timeout (run=${runId}, ${POLL_TIMEOUT_MS / 1000}s)`,
  );
}

/**
 * Liest den ready-Cache + reichert ihn mit MP4/Width/Height an (Bunny-Meta-
 * Call) — diese Felder leben aktuell pro-Lead in der DB, der run-Cache hat
 * sie nicht. Wenn der Bunny-Call faked, faellt der Wert auf null zurück und
 * der Caller (Pipeline) persistiert das so.
 */
async function finalizeReadyState(
  runId: string,
  st: {
    bunnyVideoId: string | null;
    videoUrl: string | null;
    thumbnailUrl: string | null;
  },
): Promise<VideoResolveSharedOutput> {
  if (!st.bunnyVideoId || !st.videoUrl) {
    throw new Error(
      `[video-resolve-shared] ready state has null fields for run=${runId}`,
    );
  }
  const parsed = parseStreamHlsUrl(st.videoUrl);
  let width: number | null = null;
  let height: number | null = null;
  let mp4Url: string | null = null;
  let orientation: VideoOrientation = "landscape";
  if (parsed) {
    try {
      const meta = await getVideo(st.bunnyVideoId);
      const w = Number(meta.width ?? 0);
      const h = Number(meta.height ?? 0);
      if (w > 0 && h > 0) {
        width = w;
        height = h;
        orientation = orientationFromDims(w, h);
      }
      const downloads = await getVideoDownloadUrls(
        st.bunnyVideoId,
        parsed.cdnHostname,
      );
      mp4Url = downloads[0]?.url ?? null;
    } catch (err) {
      console.warn(
        `[video-resolve-shared] bunny meta lookup failed for ${st.bunnyVideoId}: ${(err as Error).message}`,
      );
    }
  }
  return {
    bunnyVideoId: st.bunnyVideoId,
    hlsUrl: st.videoUrl,
    thumbnailUrl: st.thumbnailUrl ?? "",
    mp4Url,
    width,
    height,
    orientation,
    bunnyAssetId: null,
  };
}

/**
 * Pfad A: Source ist bereits Bunny-Stream-HLS — Guid reuse, kein Upload.
 * Wir holen aber trotzdem Width/Height/MP4-URL für das Lead-Schreiben.
 */
async function resolveExistingStream(
  input: VideoResolveSharedInput,
  parsed: { cdnHostname: string; guid: string },
): Promise<VideoResolveSharedOutput> {
  const hlsUrl = buildHlsUrl(parsed.cdnHostname, parsed.guid);
  const thumbnailUrl = buildThumbnailUrl(parsed.cdnHostname, parsed.guid);

  // Bunny-Meta optional — wenn der Call faked, gehen wir mit nulls weiter.
  let width: number | null = null;
  let height: number | null = null;
  let mp4Url: string | null = null;
  let orientation: VideoOrientation = "landscape";
  try {
    const meta = await getVideo(parsed.guid);
    const w = Number(meta.width ?? 0);
    const h = Number(meta.height ?? 0);
    if (w > 0 && h > 0) {
      width = w;
      height = h;
      orientation = orientationFromDims(w, h);
    }
  } catch (err) {
    console.warn(
      `[video-resolve-shared] getVideo failed for ${parsed.guid}: ${(err as Error).message}`,
    );
  }
  try {
    const downloads = await getVideoDownloadUrls(
      parsed.guid,
      parsed.cdnHostname,
    );
    mp4Url = downloads[0]?.url ?? null;
  } catch (err) {
    console.warn(
      `[video-resolve-shared] getVideoDownloadUrls failed for ${parsed.guid}: ${(err as Error).message}`,
    );
  }

  // Atomic claim → commit. Wenn jemand zwischen unserem Probe und dem
  // Claim schon ready gemacht hat, fall through und lese den Cache.
  const got = await claimSharedVideoUpload(input.runId);
  if (got) {
    await setSharedVideoReady(input.runId, {
      bunnyVideoId: parsed.guid,
      videoUrl: hlsUrl,
      thumbnailUrl,
      mp4Url,
      width,
      height,
    });
  } else {
    // Race: jemand anders war erster (oder es war schon ready).
    const cur = await getSharedRunVideoState(input.runId);
    if (cur?.state === "ready" && cur.bunnyVideoId && cur.videoUrl) {
      return finalizeReadyState(input.runId, cur);
    }
    // Wenn jemand anders gerade compressing/uploading läuft, pollen.
    return pollForReady(input.runId);
  }

  // Asset-Tracking (best-effort).
  const bunnyAssetId = await trackAndRefAsset({
    trackInput: {
      userId: input.userId,
      kind: "stream",
      bunnyId: parsed.guid,
      cdnUrl: hlsUrl,
      width,
      height,
    },
    ownerType: "run",
    ownerId: input.runId,
  });

  return {
    bunnyVideoId: parsed.guid,
    hlsUrl,
    thumbnailUrl,
    mp4Url,
    width,
    height,
    orientation,
    bunnyAssetId,
  };
}

/**
 * Prüft, ob ein früherer (fehlgeschlagener) Versuch bereits erfolgreich zu
 * Bunny hochgeladen hat. Wenn ja UND das Video dort noch lebt (kein status=5),
 * liefern wir die Daten zurück — der Caller überspringt Download/Compress/
 * Upload und wartet nur noch aufs Encoding. Verhindert Duplikat-Uploads bei
 * Encoding-Timeouts (Incident 2026-07-16: 3 identische Videos pro Run).
 */
async function findResumableUpload(
  runId: string,
): Promise<{ videoId: string; hlsUrl: string; thumbnailUrl: string } | null> {
  const prior = await getSharedRunVideoState(runId);
  if (!prior?.bunnyVideoId || !prior.videoUrl || !prior.thumbnailUrl) {
    return null;
  }
  try {
    const meta = await getVideo(prior.bunnyVideoId);
    const status = Number(meta.status ?? 0);
    if (status === 5) {
      // Bunny hat die Quelle verworfen — Video löschen, Record leeren,
      // frisch hochladen.
      console.warn(
        `[video-resolve-shared] persisted upload ${prior.bunnyVideoId} has status=5 — discarding, will re-upload`,
      );
      try {
        await deleteVideo(prior.bunnyVideoId);
      } catch {
        /* best-effort */
      }
      await clearSharedVideoUploadRecord(runId);
      return null;
    }
    return {
      videoId: prior.bunnyVideoId,
      hlsUrl: prior.videoUrl,
      thumbnailUrl: prior.thumbnailUrl,
    };
  } catch (err) {
    // 404 (Video weg) oder transienter Fehler: Record verwerfen und frisch
    // hochladen — schlimmstenfalls entsteht EIN Duplikat, nie ein hängender Run.
    console.warn(
      `[video-resolve-shared] resume check failed for ${prior.bunnyVideoId}: ${(err as Error).message} — re-uploading`,
    );
    await clearSharedVideoUploadRecord(runId);
    return null;
  }
}

/**
 * Pfad B: Source liegt in Bunny Storage / extern → herunterladen,
 * compressForBunny, uploadVideo. Lock-Owner ist verantwortlich.
 */
async function resolveByUpload(
  input: VideoResolveSharedInput,
): Promise<VideoResolveSharedOutput> {
  const got = await claimSharedVideoUpload(input.runId);
  if (!got) {
    // Anderer Worker arbeitet → pollen.
    return pollForReady(input.runId);
  }

  let workDir: string | null = null;
  // Bug E2: Stale-Lock-Defense. Während des langen compress/upload-Pfads
  // refreshen wir sharedVideoUploadStartedAt alle 30 s, damit kein anderer
  // Worker den Lock klaut (STALE_LOCK_MINUTES=5 ist die Grenze) und doppelt
  // zu Bunny hochlädt.
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  try {
    heartbeatTimer = setInterval(() => {
      void touchSharedVideoLock(input.runId);
    }, SHARED_LOCK_HEARTBEAT_MS);

    let videoId: string;
    let hlsUrl: string;
    let thumbnailUrl: string;
    let fallbackOrientation: VideoOrientation = "landscape";
    let bytesOut: number | undefined;

    const resumed = await findResumableUpload(input.runId);
    if (resumed) {
      ({ videoId, hlsUrl, thumbnailUrl } = resumed);
      await markSharedVideoUploading(input.runId);
      await insertPipelineEvent({
        runId: input.runId,
        leadId: null,
        level: "info",
        stage: "shared-video",
        message: `resume: Video ${videoId.slice(0, 8)}… bereits hochgeladen — warte nur aufs Bunny-Encoding (kein erneuter Upload)`,
      });
    } else {
      // Download mit Referer (Bunny Hotlink-Protection).
      const referer = process.env.APP_URL ?? "https://app.videocomet.de";
      const res = await fetch(input.webcamMediaUrl, {
        headers: {
          Referer: referer,
          Origin: referer,
          "User-Agent": "videocomet-worker/1.0",
        },
      });
      if (!res.ok) {
        throw new Error(
          `[video-resolve-shared] source fetch ${res.status} ${input.webcamMediaUrl}`,
        );
      }
      const buf = Buffer.from(await res.arrayBuffer());

      workDir = join(
        tmpdir(),
        `shared-${input.runId}-${randomUUID()}`,
      );
      await mkdir(workDir, { recursive: true });
      const rawPath = join(workDir, "source.raw");
      const compressedPath = join(workDir, "source-compressed.mp4");
      await writeFile(rawPath, buf);

      const compress = await compressForBunny({
        inputPath: rawPath,
        outputPath: compressedPath,
        reason: "shared-webcam-source",
      });
      fallbackOrientation = compress.orientation;
      bytesOut = compress.bytesOut;

      await markSharedVideoUploading(input.runId);

      const uploaded = await uploadVideo({
        filePath: compressedPath,
        title: `Shared run video ${input.runId}`,
      });
      videoId = uploaded.videoId;
      hlsUrl = uploaded.hlsUrl;
      thumbnailUrl = uploaded.thumbnailUrl;

      // Upload SOFORT persistieren (state bleibt 'uploading') — ein Retry
      // nach Encoding-Timeout darf nicht erneut hochladen.
      await recordSharedVideoUpload(input.runId, {
        bunnyVideoId: videoId,
        videoUrl: hlsUrl,
        thumbnailUrl,
      });
    }

    // Bug E1 Fix: synchron auf Bunny-Encoding warten, bevor wir mp4Url
    // berechnen. Sonst liefert getVideoDownloadUrls leer/original-only und
    // der Custom-LP-Player faellt auf 404 zurück. Throws RetryableError nach
    // Timeout — BullMQ retried mit Backoff; dank persistierter videoId wartet
    // der Retry dann nur weiter statt neu hochzuladen.
    const parsed = parseStreamHlsUrl(hlsUrl);
    let width: number | null = compressWidthFromOrientation(
      fallbackOrientation,
    );
    let height: number | null = compressHeightFromOrientation(
      fallbackOrientation,
    );
    let mp4Url: string | null = null;
    let ready: Awaited<ReturnType<typeof waitForBunnyEncoding>>;
    try {
      ready = await waitForBunnyEncoding(videoId, {
        timeoutMs: SHARED_ENCODING_TIMEOUT_MS,
        intervalMs: SHARED_ENCODING_POLL_MS,
      });
    } catch (err) {
      // Encoding-Stall-Recovery: wenn Bunny nach Timeout immer noch bei
      // Status <=2 hängt (Queued/Uploaded/Processing — kein Fortschritt in
      // Richtung transcoded), ist das Video defekt bei Bunny. Löschen +
      // DB-Reset, damit der BullMQ-Retry NICHT wieder auf dasselbe stuck
      // Video wartet, sondern frisch hochlädt. Retry sonst nur endlos.
      if (
        err instanceof BunnyEncodingRetryableError &&
        err.lastStatus >= 0 &&
        err.lastStatus <= 2
      ) {
        console.warn(
          `[video-resolve-shared] encoding stuck at status=${err.lastStatus} for ${videoId} — resetting for fresh upload`,
        );
        await insertPipelineEvent({
          runId: input.runId,
          leadId: null,
          level: "warn",
          stage: "shared-video",
          message: `Bunny-Encoding stallte bei status=${err.lastStatus} nach ${Math.round(SHARED_ENCODING_TIMEOUT_MS / 1000)}s — Video wird gelöscht, Upload wird beim nächsten Versuch frisch gemacht`,
        });
        try {
          await deleteVideo(videoId);
        } catch (delErr) {
          console.warn(
            `[video-resolve-shared] deleteVideo(${videoId}) failed (ignored): ${(delErr as Error).message}`,
          );
        }
        await clearSharedVideoUploadRecord(input.runId);
      }
      throw err;
    }
    if (ready.width > 0 && ready.height > 0) {
      width = ready.width;
      height = ready.height;
    }
    if (parsed) {
      try {
        const downloads = await getVideoDownloadUrls(
          videoId,
          parsed.cdnHostname,
        );
        mp4Url = downloads[0]?.url ?? null;
      } catch (err) {
        // Sollte nach ready-state selten passieren; wir akzeptieren null und
        // lassen die public-LP lazy nachsuchen.
        console.warn(
          `[video-resolve-shared] getVideoDownloadUrls failed for ${videoId}: ${(err as Error).message}`,
        );
      }
    }
    const orientation: VideoOrientation =
      width != null && height != null
        ? orientationFromDims(width, height)
        : fallbackOrientation;

    await setSharedVideoReady(input.runId, {
      bunnyVideoId: videoId,
      videoUrl: hlsUrl,
      thumbnailUrl,
      mp4Url,
      width,
      height,
    });

    const bunnyAssetId = await trackAndRefAsset({
      trackInput: {
        userId: input.userId,
        kind: "stream",
        bunnyId: videoId,
        cdnUrl: hlsUrl,
        width,
        height,
        bytes: bytesOut,
      },
      ownerType: "run",
      ownerId: input.runId,
    });

    return {
      bunnyVideoId: videoId,
      hlsUrl,
      thumbnailUrl,
      mp4Url,
      width,
      height,
      orientation,
      bunnyAssetId,
    };
  } catch (err) {
    await setSharedVideoFailed(input.runId, err);
    // Fehler auch ins UI-sichtbare Log — sonst sieht der User auf der
    // Run-Seite nur „Fehler" ohne Kontext (Screenshot-Report 2026-08-05).
    const message = err instanceof Error ? err.message : String(err);
    await insertPipelineEvent({
      runId: input.runId,
      leadId: null,
      level: "error",
      stage: "shared-video",
      message: `Video-Upload zu Bunny fehlgeschlagen: ${message.slice(0, 240)}`,
    }).catch(() => undefined);
    throw err;
  } finally {
    // Heartbeat zuerst killen — wir wollen keinen Tick mehr feuern nachdem
    // setSharedVideoFailed/Ready bereits geschrieben hat (sonst no-op-Warnung
    // in den Logs, kein funktionaler Bug).
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
    // Workdir aufräumen (best-effort). Falls noch ein Sub-File offen ist,
    // wirft das, was wir verschlucken.
    if (workDir) {
      try {
        const { rm } = await import("node:fs/promises");
        await rm(workDir, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
  }
}

/**
 * Defensive Width-Schätzung aus der Orientation, wenn Bunny noch keine
 * Meta-Daten liefert (Async-Encoding nicht fertig). Wir nehmen die
 * Compress-Output-Caps — das ist nahe an der Wahrheit für 99 % der Cases.
 */
function compressWidthFromOrientation(o: VideoOrientation): number {
  if (o === "portrait") return 720;
  if (o === "square") return 720;
  return 1280;
}
function compressHeightFromOrientation(o: VideoOrientation): number {
  if (o === "portrait") return 1280;
  if (o === "square") return 720;
  return 720;
}

/**
 * Public entrypoint. Wird in `pipeline.ts` für den webcam-only-Pfad statt
 * der alten `runVideoRender`+`runVideoUpload` aufgerufen.
 */
export async function runVideoResolveShared(
  input: VideoResolveSharedInput,
): Promise<VideoResolveSharedOutput> {
  const t0 = Date.now();
  await insertPipelineEvent({
    runId: input.runId,
    leadId: null,
    level: "info",
    stage: "shared-video",
    message: `resolveSharedVideo started (source=${truncateUrl(input.webcamMediaUrl)})`,
  });

  // 1. Bereits ready?
  const cur = await getSharedRunVideoState(input.runId);
  if (cur?.state === "ready" && cur.bunnyVideoId && cur.videoUrl) {
    const out = await finalizeReadyState(input.runId, cur);
    await insertPipelineEvent({
      runId: input.runId,
      leadId: null,
      level: "info",
      stage: "shared-video",
      message: `resolveSharedVideo cache-hit (${out.bunnyVideoId.slice(0, 8)}…)`,
      durationMs: Date.now() - t0,
    });
    return out;
  }

  // 2. Bunny-Stream-HLS → Reuse, kein Upload.
  const parsed = parseStreamHlsUrl(input.webcamMediaUrl);
  let out: VideoResolveSharedOutput;
  if (parsed) {
    out = await resolveExistingStream(input, parsed);
  } else {
    out = await resolveByUpload(input);
  }
  await insertPipelineEvent({
    runId: input.runId,
    leadId: null,
    level: "info",
    stage: "shared-video",
    message: `resolveSharedVideo done (${out.bunnyVideoId.slice(0, 8)}…, ${out.orientation}, mp4=${out.mp4Url ? "yes" : "no"})`,
    durationMs: Date.now() - t0,
  });
  return out;
}

function truncateUrl(u: string): string {
  return u.length > 80 ? `${u.slice(0, 60)}…${u.slice(-15)}` : u;
}

// Re-export type so the pipeline can use the orientation literal.
export type { SharedVideoState };
// Touch unused-import guard.
void runs;
void db;
void eq;
