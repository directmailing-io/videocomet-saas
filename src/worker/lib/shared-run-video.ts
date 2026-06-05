/**
 * Pro-Run-Video-Cache fuer Webcam-only-Kampagnen.
 *
 * Im `webcam-only`-Mode ist das Lead-Video fuer ALLE Leads identisch.
 * Statt N×Re-Upload nach Bunny Stream wird das Video EINMAL pro Run
 * aufgeloest:
 *
 *  1. Wenn der Source bereits eine Bunny-Stream-HLS-URL ist
 *     (`vz-*.b-cdn.net/<guid>/playlist.m3u8`), extrahieren wir den GUID
 *     direkt — kein Upload, sofort fertig.
 *  2. Sonst (Bunny-Storage-URL, z.B. Webcam-Recording im Storage-Bucket):
 *     erster Worker, der reinrennt, holt sich einen Optimistic-Lock via
 *     `runs.shared_video_upload_started_at`, lädt hoch, schreibt das
 *     Ergebnis in die runs-Tabelle. Andere Worker pollen `shared_*`,
 *     bis es gefuellt ist.
 *
 * Failure-Modi:
 *  - Lock-Owner crasht waehrend des Uploads: nach 5 min wird der Lock
 *    als stale behandelt, der naechste Worker kann es nochmal versuchen.
 *  - Polling timeoutet nach 2 min (`POLL_TIMEOUT_MS`): wir werfen, der
 *    Pipeline-Job-Retry-Mechanismus von BullMQ greift.
 *  - Upload schlaegt fehl: Lock wird zurueckgesetzt, Caller bekommt den
 *    Fehler.
 *
 * Konkurrenz-Sicherheit: Die `claim`-Query nutzt ein partielles WHERE-
 * Praedikat (`shared_bunny_video_id IS NULL AND (started_at IS NULL OR
 * started_at < now() - 5min)`) zusammen mit `RETURNING id`. Postgres
 * sequentialisiert das atomar — nur EIN Worker bekommt eine Row zurueck.
 */

import { and, eq, isNull, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { runs } from "@/lib/db/schema";
import { uploadVideo } from "@/lib/bunny/stream";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

export interface SharedRunVideo {
  bunnyVideoId: string;
  videoUrl: string;
  thumbnailUrl: string;
}

const STALE_LOCK_MINUTES = 5;
const POLL_INTERVAL_MS = 1500;
const POLL_TIMEOUT_MS = 120_000; // 2 min

/**
 * Parses a Bunny-Stream HLS-URL and returns `{ cdnHostname, guid }`, or
 * `null` if the URL doesn't match the known Stream-CDN pattern.
 */
function parseStreamHlsUrl(
  rawUrl: string,
): { cdnHostname: string; guid: string } | null {
  if (!rawUrl) return null;
  const m = rawUrl.match(
    /^https?:\/\/([^/]+)\/([0-9a-f-]{36})\/playlist\.m3u8(?:\?.*)?$/i,
  );
  if (!m) return null;
  return { cdnHostname: m[1], guid: m[2] };
}

/**
 * Wartet bis `runs.shared_bunny_video_id` gefuellt ist (anderer Worker
 * macht gerade den Upload) und liefert das Result.
 */
async function pollForReady(runId: string): Promise<SharedRunVideo> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < POLL_TIMEOUT_MS) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    const [row] = await db
      .select({
        id: runs.sharedBunnyVideoId,
        url: runs.sharedVideoUrl,
        thumb: runs.sharedThumbnailUrl,
      })
      .from(runs)
      .where(eq(runs.id, runId))
      .limit(1);
    if (row?.id && row.url) {
      return {
        bunnyVideoId: row.id,
        videoUrl: row.url,
        thumbnailUrl: row.thumb ?? "",
      };
    }
  }
  throw new Error(
    `[shared-run-video] timeout waiting for upload owner (runId=${runId}, ${POLL_TIMEOUT_MS / 1000}s)`,
  );
}

/**
 * Bunny Stream Thumbnail-URL aus dem Pattern `vz-<hash>.b-cdn.net/<guid>/thumbnail.jpg`.
 */
function buildThumbnailUrl(cdnHostname: string, guid: string): string {
  return `https://${cdnHostname}/${guid}/thumbnail.jpg`;
}

/**
 * Faellt Source-Video → Stream-MP4-Download zurueck, lädt zu Bunny.
 * Wird nur aufgerufen wenn die Source NICHT bereits in Stream ist.
 */
async function uploadSourceToStream(
  sourceUrl: string,
  runId: string,
): Promise<SharedRunVideo> {
  // Webcam-Source nach lokaler Datei (Bunny Storage liefert MP4 direkt).
  const referer = process.env.APP_URL ?? "https://app.videocomet.de";
  const res = await fetch(sourceUrl, {
    headers: {
      Referer: referer,
      Origin: referer,
      "User-Agent": "videocomet-worker/1.0",
    },
  });
  if (!res.ok) {
    throw new Error(
      `[shared-run-video] source fetch ${res.status} ${sourceUrl}`,
    );
  }
  const buf = Buffer.from(await res.arrayBuffer());

  const workDir = join(tmpdir(), `shared-${runId}-${randomUUID()}`);
  await mkdir(workDir, { recursive: true });
  const filePath = join(workDir, "source.mp4");
  await writeFile(filePath, buf);

  const uploaded = await uploadVideo({
    filePath,
    title: `Shared run video ${runId}`,
  });
  return {
    bunnyVideoId: uploaded.videoId,
    videoUrl: uploaded.hlsUrl,
    thumbnailUrl: uploaded.thumbnailUrl,
  };
}

/**
 * Loest das gemeinsam genutzte Video fuer einen Webcam-only-Run auf.
 *
 * Ablauf:
 *   1. Quick-Check: `runs.shared_bunny_video_id` schon gesetzt? → return.
 *   2. Source ist Bunny-Stream-URL? → GUID extrahieren + atomar claimen
 *      (`UPDATE … WHERE shared_bunny_video_id IS NULL`). Kein Upload.
 *   3. Source ist Storage-URL? → Lock-claim (gleicher partial WHERE),
 *      Upload, schreibe `shared_*`. Bei Verlust des Claims → pollen.
 */
export async function resolveSharedRunVideo(
  runId: string,
  webcamPublicUrl: string,
): Promise<SharedRunVideo> {
  // 1. Quick read
  const [existing] = await db
    .select({
      id: runs.sharedBunnyVideoId,
      url: runs.sharedVideoUrl,
      thumb: runs.sharedThumbnailUrl,
    })
    .from(runs)
    .where(eq(runs.id, runId))
    .limit(1);
  if (existing?.id && existing.url) {
    return {
      bunnyVideoId: existing.id,
      videoUrl: existing.url,
      thumbnailUrl: existing.thumb ?? "",
    };
  }

  // 2. Pfad A: Source ist bereits Bunny-Stream-HLS → GUID reuse, kein Upload.
  const streamRef = parseStreamHlsUrl(webcamPublicUrl);
  if (streamRef) {
    const thumb = buildThumbnailUrl(streamRef.cdnHostname, streamRef.guid);
    // Atomic claim: nur wenn shared_bunny_video_id noch NULL ist. Wenn
    // jemand zwischen unserem Read (#1) und dem UPDATE den Wert gesetzt
    // hat, schreiben wir nichts ueber — Postgres-WHERE bewahrt uns.
    const claim = await db
      .update(runs)
      .set({
        sharedBunnyVideoId: streamRef.guid,
        sharedVideoUrl: webcamPublicUrl,
        sharedThumbnailUrl: thumb,
      })
      .where(and(eq(runs.id, runId), isNull(runs.sharedBunnyVideoId)))
      .returning({ id: runs.id });
    if (claim.length > 0) {
      // Wir haben geschrieben.
      return {
        bunnyVideoId: streamRef.guid,
        videoUrl: webcamPublicUrl,
        thumbnailUrl: thumb,
      };
    }
    // Race: jemand anders war schneller — lesen wir was er geschrieben hat.
    const [now] = await db
      .select({
        id: runs.sharedBunnyVideoId,
        url: runs.sharedVideoUrl,
        thumb: runs.sharedThumbnailUrl,
      })
      .from(runs)
      .where(eq(runs.id, runId))
      .limit(1);
    if (now?.id && now.url) {
      return {
        bunnyVideoId: now.id,
        videoUrl: now.url,
        thumbnailUrl: now.thumb ?? "",
      };
    }
    // Sehr selten: Wert zwischen Race und Re-Read wieder null gesetzt
    // worden (UI-Reset?) — fall through zur Upload-Variante.
  }

  // 3. Pfad B: Storage-Source → Upload-Lock claimen.
  const now = new Date();
  const staleBoundary = sql`now() - interval '${sql.raw(String(STALE_LOCK_MINUTES))} minutes'`;
  const claim = await db
    .update(runs)
    .set({ sharedVideoUploadStartedAt: now })
    .where(
      and(
        eq(runs.id, runId),
        isNull(runs.sharedBunnyVideoId),
        or(
          isNull(runs.sharedVideoUploadStartedAt),
          sql`${runs.sharedVideoUploadStartedAt} < ${staleBoundary}`,
        ),
      ),
    )
    .returning({ id: runs.id });

  if (claim.length === 0) {
    // Anderer Worker hat den Lock — pollen.
    return pollForReady(runId);
  }

  // Wir haben den Lock — upload + persist.
  try {
    const result = await uploadSourceToStream(webcamPublicUrl, runId);
    await db
      .update(runs)
      .set({
        sharedBunnyVideoId: result.bunnyVideoId,
        sharedVideoUrl: result.videoUrl,
        sharedThumbnailUrl: result.thumbnailUrl,
      })
      .where(eq(runs.id, runId));
    return result;
  } catch (err) {
    // Lock-Reset, damit der naechste Job es erneut versuchen kann.
    await db
      .update(runs)
      .set({ sharedVideoUploadStartedAt: null })
      .where(
        and(eq(runs.id, runId), isNull(runs.sharedBunnyVideoId)),
      );
    throw err;
  }
}

/**
 * Wenn der User eine Kampagne re-runt (regenerate) und dabei das Webcam-
 * Video geändert hat, sollte der alte Shared-Cache invalidiert werden,
 * sonst zeigen alle Leads des neuen Runs aufs alte Video.
 *
 * Pragmatisch: bei jedem `regenerate` mit `mode in ("all", "video")`
 * (= Video soll neu generiert werden) reset.
 */
export async function resetSharedRunVideo(runId: string): Promise<void> {
  await db
    .update(runs)
    .set({
      sharedBunnyVideoId: null,
      sharedVideoUrl: null,
      sharedThumbnailUrl: null,
      sharedVideoUploadStartedAt: null,
    })
    .where(eq(runs.id, runId));
}
