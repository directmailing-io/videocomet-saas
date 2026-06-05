/**
 * Bunny-Asset-Purge-Worker (Paket B).
 *
 * Aufgaben pro Tick:
 *  1. `markOrphanedAssetsForPurge()` — Live-Assets ohne Refs → purge_pending.
 *  2. `getAssetsReadyForPurge(limit=20)` — älteste/wenigst-failed pending zuerst.
 *  3. Pro Asset:
 *       kind='stream'  → `deleteVideo(bunnyId)` aus `lib/bunny/stream.ts`
 *       kind='storage' → `deleteFile(bunnyId)`  aus `lib/bunny/storage.ts`
 *     404 wird als Erfolg behandelt (Asset war schon weg).
 *  4. Erfolg → `markAssetPurged`. Fehler → `markAssetPurgeFailed`.
 *
 * Rate-Limit:
 *  - max 4 parallele Bunny-API-Calls (Promise.allSettled-Batches).
 *  - 250ms Pause zwischen Batches — gibt Bunny Luft + verhindert dass ein
 *    Tick zu lange läuft.
 *
 * Stale-Asset-Alert (siehe Spec / Paket G):
 *  - Wenn `purge_attempts >= 10` UND der Asset >7 Tage alt ist → warn-log.
 *    KEIN E-Mail-Versand hier; Paket G übernimmt das.
 *
 * Integriert via `startBunnyPurger()` in `worker/index.ts` als 60s-Tick.
 * API-Trigger (Paket G's Admin-Endpoint) kann `runBunnyPurgeTick()` direkt
 * aufrufen.
 */

import {
  getAssetsReadyForPurge,
  markAssetPurgeFailed,
  markAssetPurged,
  markOrphanedAssetsForPurge,
  type PurgeReadyAsset,
} from "@/lib/db/queries/bunny-assets";
import { BunnyApiError } from "@/lib/bunny/_fetch";
import { deleteFile } from "@/lib/bunny/storage";
import { deleteVideo } from "@/lib/bunny/stream";
import { db } from "@/lib/db";
import { bunnyAssets } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

const BATCH_SIZE = 20;
const PARALLELISM = 4;
const INTER_BATCH_DELAY_MS = 250;
const STALE_ATTEMPT_THRESHOLD = 10;
const STALE_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export interface BunnyPurgeTickResult {
  /** Anzahl Assets, die in diesem Tick verarbeitet (gelesen) wurden. */
  scanned: number;
  /** Erfolgreich physisch gelöscht (incl. 404 = bereits weg). */
  purged: number;
  /** Bei Bunny gescheitert (4xx ≠ 404 oder 5xx nach Retries). */
  failed: number;
  /** In diesem Tick neu in `purge_pending` markierte Orphans. */
  orphansSwept: number;
}

function log(level: "info" | "warn" | "error", msg: string, extra?: unknown): void {
  // eslint-disable-next-line no-console
  const fn = level === "error" ? console.error : level === "warn" ? console.warn : console.log;
  if (extra !== undefined) fn(`[bunny-purge] ${msg}`, extra);
  else fn(`[bunny-purge] ${msg}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Erkennt 404-Responses (Asset war schon weg) als idempotent erfolgreich.
 * Bunny liefert manchmal auch 410 Gone — wir akzeptieren beides.
 */
function isAlreadyGoneError(err: unknown): boolean {
  if (err instanceof BunnyApiError) {
    return err.status === 404 || err.status === 410;
  }
  return false;
}

/**
 * Verarbeitet einen einzelnen Asset: ruft die passende Bunny-Delete-API
 * (Stream oder Storage), behandelt 404 als Erfolg, und schreibt das
 * Ergebnis in die DB.
 */
async function purgeSingleAsset(asset: PurgeReadyAsset): Promise<"purged" | "failed"> {
  try {
    if (asset.kind === "stream") {
      await deleteVideo(asset.bunnyId);
    } else {
      // `bunnyId` ist hier der Storage-Pfad innerhalb der default-Zone.
      // Cross-Zone-Deletes (z.B. videocomet-pdf vs videocomet-custom-lp)
      // sind aktuell nicht supportet — der Tracker (Paket D) ist dafür
      // verantwortlich, nur Default-Zone-Assets als `kind='storage'`
      // einzutragen.
      await deleteFile(asset.bunnyId);
    }
    await markAssetPurged(asset.id);
    return "purged";
  } catch (err) {
    if (isAlreadyGoneError(err)) {
      // 404/410: Asset existiert bei Bunny nicht (mehr) — DB-State sync'en.
      log("info", `asset ${asset.id} (${asset.kind}/${asset.bunnyId}) was already gone, marking purged`);
      await markAssetPurged(asset.id);
      return "purged";
    }
    const message = err instanceof Error ? err.message : String(err);
    log("warn", `purge failed for asset ${asset.id} (${asset.kind}/${asset.bunnyId}): ${message}`);
    await markAssetPurgeFailed(asset.id, message);
    return "failed";
  }
}

/**
 * Stale-Alert-Sweep: prüft nach dem Batch ob Assets mit >=10 attempts +
 * >7d Alter im Pending-Buffer sitzen und loggt Warn-Lines. Paket G ergänzt
 * später den E-Mail-Versand.
 */
async function logStaleAssets(): Promise<void> {
  const cutoff = new Date(Date.now() - STALE_AGE_MS);
  // Eine kleine eigene Query — bewusst nicht im Public-Interface, damit
  // Paket G hier später ein eigenes "alert"-Query hängen kann.
  const stale = await db
    .select({
      id: bunnyAssets.id,
      kind: bunnyAssets.kind,
      bunnyId: bunnyAssets.bunnyId,
      attempts: bunnyAssets.purgeAttempts,
      createdAt: bunnyAssets.createdAt,
      lastError: bunnyAssets.purgeLastError,
    })
    .from(bunnyAssets)
    .where(eq(bunnyAssets.purgeState, "purge_pending"))
    .limit(50);

  for (const a of stale) {
    if (a.attempts >= STALE_ATTEMPT_THRESHOLD && a.createdAt < cutoff) {
      log(
        "warn",
        `STALE: asset ${a.id} (${a.kind}/${a.bunnyId}) — ${a.attempts} attempts, age ${Math.round((Date.now() - a.createdAt.getTime()) / 86_400_000)}d, lastError=${a.lastError ?? "?"}`,
      );
    }
  }
}

/**
 * Public-Entrypoint: ein kompletter Purge-Tick. Idempotent, mehrfaches
 * Aufrufen ist sicher.
 */
export async function runBunnyPurgeTick(): Promise<BunnyPurgeTickResult> {
  // (1) Orphan-Sweep
  let orphansSwept = 0;
  try {
    orphansSwept = await markOrphanedAssetsForPurge();
    if (orphansSwept > 0) {
      log("info", `orphan-sweep: marked ${orphansSwept} asset(s) as purge_pending`);
    }
  } catch (err) {
    log("error", `orphan-sweep failed: ${(err as Error)?.message ?? err}`);
  }

  // (2) Batch holen
  let assets: PurgeReadyAsset[] = [];
  try {
    assets = await getAssetsReadyForPurge(BATCH_SIZE);
  } catch (err) {
    log("error", `getAssetsReadyForPurge failed: ${(err as Error)?.message ?? err}`);
    return { scanned: 0, purged: 0, failed: 0, orphansSwept };
  }

  if (assets.length === 0) {
    return { scanned: 0, purged: 0, failed: 0, orphansSwept };
  }

  log("info", `tick: processing ${assets.length} asset(s)`);

  // (3) Rate-limit via Chunks à PARALLELISM mit 250ms-Pause zwischen Chunks.
  let purged = 0;
  let failed = 0;
  for (let i = 0; i < assets.length; i += PARALLELISM) {
    const chunk = assets.slice(i, i + PARALLELISM);
    const settled = await Promise.allSettled(chunk.map(purgeSingleAsset));
    for (const r of settled) {
      if (r.status === "fulfilled") {
        if (r.value === "purged") purged += 1;
        else failed += 1;
      } else {
        // Nicht-Bunny-Fehler (z.B. DB down) — bubblen wir nicht hoch um den
        // Tick nicht ganz kaputtzumachen, zaehlen sie aber als failed.
        failed += 1;
        log("error", `unhandled purge error: ${(r.reason as Error)?.message ?? r.reason}`);
      }
    }
    if (i + PARALLELISM < assets.length) {
      await sleep(INTER_BATCH_DELAY_MS);
    }
  }

  // (4) Stale-Alert-Log (nur log; Paket G versendet später Mail).
  try {
    await logStaleAssets();
  } catch (err) {
    log("error", `stale-asset scan failed: ${(err as Error)?.message ?? err}`);
  }

  log(
    "info",
    `tick done: scanned=${assets.length} purged=${purged} failed=${failed} orphansSwept=${orphansSwept}`,
  );
  return { scanned: assets.length, purged, failed, orphansSwept };
}

const PURGE_INTERVAL_MS = 60_000;

/**
 * Startet den Purge-Loop. Mirror-API zu `startDomainVerifier()` — wird vom
 * `worker/index.ts` beim Boot aufgerufen und gibt eine `stop()`-Funktion
 * zurueck.
 *
 * Boot-Verhalten: ersten Tick sofort feuern (kein artificial Delay).
 * Subsequente Ticks alle 60s. Ein gescheiterter Tick darf den Timer NICHT
 * kippen — Fehler werden im inneren `runBunnyPurgeTick` bereits gefangen,
 * aber wir sichern den Outer-Catch zusätzlich ab.
 */
export function startBunnyPurger(): () => void {
  void runBunnyPurgeTick().catch((err) => {
    log("error", `initial tick crashed: ${(err as Error)?.message ?? err}`);
  });
  const t = setInterval(() => {
    runBunnyPurgeTick().catch((err) => {
      log("error", `periodic tick crashed: ${(err as Error)?.message ?? err}`);
    });
  }, PURGE_INTERVAL_MS);
  t.unref();
  return () => clearInterval(t);
}
