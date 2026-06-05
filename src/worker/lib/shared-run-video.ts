/**
 * Shared-Run-Video state machine + DB-helpers.
 *
 * Paket D: Diese Datei ist NUR noch DB-State-Management — Lock claim,
 * Status-Übergänge, Read-Helpers. Der eigentliche Upload + Compress läuft
 * im Processor `video-resolve-shared.ts`.
 *
 * Lifecycle (CHECK-Constraint in DB):
 *
 *     pending → compressing → uploading → ready
 *                    ↓             ↓
 *                  failed       failed
 *
 * `claimSharedVideoUpload(runId)` versucht ATOMAR den Lock zu holen:
 *   - state in ('pending','failed')                                    OK
 *   - state='compressing'/'uploading' UND stale > 5min                  OK
 *   - state='ready'                                                    NICHT (fertig)
 *   - state='compressing'/'uploading' UND fresh                         NICHT (anderer Worker arbeitet)
 *
 * Nur EIN Worker kommt durch — Postgres serialisiert das partial WHERE
 * über die Row. Andere Worker pollen via `getSharedRunVideoState` bis
 * `state='ready'` oder Timeout.
 *
 * Bei Erfolg → `setSharedVideoReady(runId, {...})` (atomarer Schreib aller
 * Felder + state='ready'). Bei Fehler → `setSharedVideoFailed(runId, err)`
 * (state='failed', anderer Worker kann nachher erneut claimen).
 */

import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { runs } from "@/lib/db/schema";

export type SharedVideoState =
  | "pending"
  | "compressing"
  | "uploading"
  | "ready"
  | "failed";

const STALE_LOCK_MINUTES = 5;

/**
 * Liefert den aktuellen Shared-Video-Zustand für einen Run. NULL wenn der
 * Run nicht existiert (sollte in der Pipeline nie passieren).
 */
export interface SharedRunVideoState {
  state: SharedVideoState;
  bunnyVideoId: string | null;
  videoUrl: string | null;
  thumbnailUrl: string | null;
  mp4Url: string | null;
  width: number | null;
  height: number | null;
}

export async function getSharedRunVideoState(
  runId: string,
): Promise<SharedRunVideoState | null> {
  const [row] = await db
    .select({
      state: runs.sharedVideoState,
      bunnyVideoId: runs.sharedBunnyVideoId,
      videoUrl: runs.sharedVideoUrl,
      thumbnailUrl: runs.sharedThumbnailUrl,
    })
    .from(runs)
    .where(eq(runs.id, runId))
    .limit(1);
  if (!row) return null;
  // Paket A liefert `sharedVideoState` als text mit CHECK; wir trauen dem.
  return {
    state: (row.state ?? "pending") as SharedVideoState,
    bunnyVideoId: row.bunnyVideoId,
    videoUrl: row.videoUrl,
    thumbnailUrl: row.thumbnailUrl,
    // Spalten `mp4Url` / `width` / `height` leben aktuell auf den Lead-Rows
    // (Paket A hat `leads.video_mp4_url` etc. eingeführt). Der Shared-Cache
    // an `runs.*` enthält sie noch NICHT — wenn Paket A das ergänzt,
    // tauschen wir hier auf die Run-Spalten. Bis dahin: null, der Resolver
    // berechnet das beim ersten Treffer ohnehin neu.
    mp4Url: null,
    width: null,
    height: null,
  };
}

/**
 * Atomic Lock-Claim für den Upload. Liefert `true` wenn DIESER Worker den
 * Lock geholt hat, `false` wenn anderer Worker bereits arbeitet oder das
 * Video schon `ready` ist.
 *
 * Implementierung: UPDATE … SET state='compressing', started_at=now() WHERE
 * id=$1 AND (state IN ('pending','failed') OR (state IN ('compressing',
 * 'uploading') AND started_at < now() - 5min)) RETURNING id.
 *
 * Postgres serialisiert das pro Row — höchstens ein Worker bekommt eine
 * Row zurück.
 */
export async function claimSharedVideoUpload(
  runId: string,
): Promise<boolean> {
  const now = new Date();
  const staleBoundary = sql`now() - interval '${sql.raw(String(STALE_LOCK_MINUTES))} minutes'`;
  const result = await db
    .update(runs)
    .set({
      sharedVideoState: "compressing",
      sharedVideoUploadStartedAt: now,
    })
    .where(
      and(
        eq(runs.id, runId),
        or(
          inArray(runs.sharedVideoState, ["pending", "failed"]),
          and(
            inArray(runs.sharedVideoState, ["compressing", "uploading"]),
            or(
              isNull(runs.sharedVideoUploadStartedAt),
              sql`${runs.sharedVideoUploadStartedAt} < ${staleBoundary}`,
            ),
          ),
        ),
      ),
    )
    .returning({ id: runs.id });
  return result.length > 0;
}

/**
 * Heartbeat-Refresh für den Lock während eines langen Compress/Upload.
 *
 * Hintergrund (Bug E2, Stale-Lock):
 *
 *   `STALE_LOCK_MINUTES=5` ist die Schwelle, ab der `claimSharedVideoUpload`
 *   einen aktiven Lock als verlassen behandelt. Ein 1080p-Portrait-Compress
 *   kann auf langsamen Workern aber gut über 5 min dauern → ein zweiter Worker
 *   würde dann den Lock kapern, parallel komprimieren UND parallel zu Bunny
 *   hochladen (doppelter Cost + Doubled-Race auf setSharedVideoReady).
 *
 *   Lösung: der ACTIVE Lock-Holder ruft alle 30 s `touchSharedVideoLock(runId)`
 *   auf — wir setzen `sharedVideoUploadStartedAt = now()`. Dadurch sieht der
 *   Stale-Check (`started_at < now() - 5min`) den Lock immer als frisch.
 *
 * Idempotenz / Safety:
 *   - WHERE state IN ('compressing','uploading') — wenn wir den Lock zwischen-
 *     zeitlich verloren haben (state='ready' weil ein anderer Worker Schluss
 *     gemacht hat) oder fehlgeschlagen sind (state='failed'), matched die
 *     UPDATE 0 Rows → no-op, kein Throw, kein Side-Effect.
 *   - Wir TOUCHEN nur das Timestamp-Feld — der State bleibt unverändert.
 *
 * Diese Funktion darf nie throwen — der Caller fired sie aus einem setInterval-
 * Callback. Ein Throw aus einem Timer-Callback würde unhandled durchschlagen
 * und ggf. den Node-Prozess crashen. Wir loggen DB-Fehler und schlucken sie.
 */
export async function touchSharedVideoLock(runId: string): Promise<void> {
  try {
    await db
      .update(runs)
      .set({ sharedVideoUploadStartedAt: new Date() })
      .where(
        and(
          eq(runs.id, runId),
          inArray(runs.sharedVideoState, ["compressing", "uploading"]),
        ),
      );
  } catch (err) {
    console.warn(
      `[shared-run-video] heartbeat touch failed (run=${runId}): ${(err as Error).message}`,
    );
  }
}

/**
 * Markiert die Upload-Phase explizit (von compressing → uploading).
 * Pure-Soft-Update; nicht-kritisch (wir nutzen den State hauptsächlich
 * für Debug-Visibility). Wenn niemand sonst arbeitet, sollte das durch-
 * gehen; ansonsten ignorieren wir das Ergebnis.
 */
export async function markSharedVideoUploading(runId: string): Promise<void> {
  await db
    .update(runs)
    .set({ sharedVideoState: "uploading" })
    .where(
      and(eq(runs.id, runId), eq(runs.sharedVideoState, "compressing")),
    );
}

export interface SharedVideoReadyFields {
  bunnyVideoId: string;
  videoUrl: string;
  thumbnailUrl: string;
  /** Optional — wird in Lead-Spalten gespiegelt; runs.* hat (noch) keine MP4-Spalte. */
  mp4Url?: string | null;
  width?: number | null;
  height?: number | null;
}

/**
 * Atomic-Commit nach Upload-Erfolg: state='ready' + alle Result-Felder in
 * EINEM UPDATE. Wenn der Caller das in zwei Schritten machen würde, könnte
 * ein Polling-Worker zwischen den UPDATEs `state='ready' + bunnyId=null`
 * sehen → die Pipeline würde dann mit NULL-Videos weitermachen.
 */
export async function setSharedVideoReady(
  runId: string,
  fields: SharedVideoReadyFields,
): Promise<void> {
  await db
    .update(runs)
    .set({
      sharedVideoState: "ready",
      sharedBunnyVideoId: fields.bunnyVideoId,
      sharedVideoUrl: fields.videoUrl,
      sharedThumbnailUrl: fields.thumbnailUrl,
      // sharedVideoUploadStartedAt absichtlich NICHT genullt — das Audit-
      // Feld zeigt wann der Upload abgeschlossen war.
    })
    .where(eq(runs.id, runId));
  // mp4Url/width/height landen aktuell pro-Lead, nicht pro-Run (siehe Schema
  // Kommentar in getSharedRunVideoState). Wenn Paket A diese Spalten auf
  // runs.* ergänzt, hier dranklemmen.
  void fields.mp4Url;
  void fields.width;
  void fields.height;
}

/**
 * Setzt den State auf `failed` und protokolliert die Error-Message im Audit-
 * Spaltenkonzept (falls Paket A eine `shared_video_error`-Spalte einführt).
 * Aktuell loggen wir nur und resetten started_at, damit ein nachfolgender
 * Worker den Lock claimen kann.
 */
export async function setSharedVideoFailed(
  runId: string,
  err: unknown,
): Promise<void> {
  const message =
    err instanceof Error ? err.message : String(err ?? "unknown");
  console.warn(`[shared-run-video] failed for run=${runId}: ${message}`);
  await db
    .update(runs)
    .set({
      sharedVideoState: "failed",
      sharedVideoUploadStartedAt: null,
    })
    .where(eq(runs.id, runId));
}

/**
 * Wenn der User eine Kampagne re-runt (regenerate) und dabei das Webcam-
 * Video geändert hat, sollte der alte Shared-Cache invalidiert werden, sonst
 * zeigen alle Leads des neuen Runs aufs alte Video.
 *
 * Pragmatisch: bei jedem `regenerate` mit `mode in ("all", "video")` reset.
 */
export async function resetSharedRunVideo(runId: string): Promise<void> {
  await db
    .update(runs)
    .set({
      sharedVideoState: "pending",
      sharedBunnyVideoId: null,
      sharedVideoUrl: null,
      sharedThumbnailUrl: null,
      sharedVideoUploadStartedAt: null,
    })
    .where(eq(runs.id, runId));
}
