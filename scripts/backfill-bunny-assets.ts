/**
 * One-shot Backfill: registriert bestehende Bunny-Objekte in der neuen
 * `bunny_assets`-Tabelle und verbindet sie über `bunny_asset_refs` mit
 * ihren Owner-Rows (leads / runs / media_items).
 *
 * Hintergrund (Paket H):
 *  Vor Migration 0013 wurden Bunny-Stream-GUIDs und Storage-Pfade direkt
 *  auf den Owner-Rows gespeichert (`leads.bunny_video_id`,
 *  `runs.shared_bunny_video_id`, `media_items.public_url`). Mit Paket B
 *  gibt es eine zentrale `bunny_assets`-Registry, die Paket E (Purge-
 *  Worker) zum sauberen Löschen verwendet. Damit der Worker auch ALTE
 *  Daten purgen kann, müssen wir die Registry einmalig befüllen.
 *
 * Idempotent:
 *  - `trackBunnyAsset` nutzt `ON CONFLICT DO NOTHING` auf
 *    `(user_id, kind, bunny_id)` — zweite Ausführung ändert nichts.
 *  - `addBunnyAssetRef` nutzt `ON CONFLICT DO NOTHING` auf
 *    `(asset_id, owner_type, owner_id)` — Refs werden nicht dupliziert.
 *
 * Pragmatik:
 *  Wir holen NICHT für jeden Lead die exakten Dimensionen / Bytes aus
 *  Bunny — bei tausenden Leads ist das untragbar. Width/Height werden
 *  beim ersten Re-Render oder per `backfill-lead-orientation.ts` befüllt.
 *
 * Aufruf:
 *   tsx scripts/backfill-bunny-assets.ts
 * oder im Container:
 *   docker exec videocomet-app sh -lc \
 *     'cd /app && node --experimental-strip-types scripts/backfill-bunny-assets.ts'
 */

import { and, eq, isNotNull } from "drizzle-orm";
import { db } from "../src/lib/db";
import { leads, mediaItems, runs } from "../src/lib/db/schema";
import {
  trackBunnyAsset,
  addBunnyAssetRef,
  type BunnyAssetKind,
} from "../src/lib/db/queries/bunny-assets";

interface BunnyUrlClassification {
  kind: BunnyAssetKind;
  bunnyId: string;
  cdnUrl: string;
}

/**
 * Klassifiziert eine `publicUrl` (aus media_items, runs.shared_video_url
 * oder leads.video_url) als Stream oder Storage. Stream-URLs sind HLS-
 * Playlists `<vz-…>.b-cdn.net/<guid>/playlist.m3u8`. Alles andere ist
 * Storage (Pull-Zone für direkt-GET MP4/PNG/...).
 *
 * Liefert `null` wenn die URL weder als Stream noch als Storage erkennbar
 * ist — typisch bei extern gehosteten Assets, die wir nicht tracken sollen.
 */
function classifyBunnyUrl(rawUrl: string | null): BunnyUrlClassification | null {
  if (!rawUrl) return null;
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  // Stream: <…>.b-cdn.net/<guid>/playlist.m3u8
  if (url.pathname.endsWith("/playlist.m3u8")) {
    const parts = url.pathname.split("/").filter(Boolean);
    const guid = parts[0];
    if (!guid) return null;
    return { kind: "stream", bunnyId: guid, cdnUrl: rawUrl };
  }
  // Storage: Pfad ist der Storage-Key (Bunny Pull-Zone spiegelt direkt).
  // Auch `vz-…`-Domains landen hier wenn es kein Playlist-Path ist —
  // dann ist es z.B. ein Original-MP4 oder Thumbnail, was wir konservativ
  // als Storage tracken (Purge via Storage-API funktioniert trotzdem nicht
  // für Stream-Originale, aber der Purge-Worker prüft `kind` und kann das
  // sauber handlen — er kennt die unterschiedlichen APIs).
  const storagePath = url.pathname.replace(/^\/+/, "");
  if (!storagePath) return null;
  return { kind: "storage", bunnyId: storagePath, cdnUrl: rawUrl };
}

interface BackfillStats {
  scanned: number;
  trackedNew: number;
  trackedExisting: number;
  refsAdded: number;
  skipped: number;
  errors: number;
}

function newStats(): BackfillStats {
  return {
    scanned: 0,
    trackedNew: 0,
    trackedExisting: 0,
    refsAdded: 0,
    skipped: 0,
    errors: 0,
  };
}

function logProgress(label: string, stats: BackfillStats) {
  console.log(
    `[backfill-bunny-assets][${label}] scanned=${stats.scanned} ` +
      `new=${stats.trackedNew} existing=${stats.trackedExisting} ` +
      `refs=${stats.refsAdded} skipped=${stats.skipped} err=${stats.errors}`,
  );
}

async function backfillLeads(): Promise<BackfillStats> {
  const stats = newStats();
  const rows = await db
    .select({
      id: leads.id,
      bunnyVideoId: leads.bunnyVideoId,
      videoUrl: leads.videoUrl,
      userId: runs.userId,
    })
    .from(leads)
    .innerJoin(runs, eq(runs.id, leads.runId))
    .where(isNotNull(leads.bunnyVideoId));

  console.log(`[backfill-bunny-assets][leads] ${rows.length} candidates`);
  for (const row of rows) {
    stats.scanned += 1;
    if (!row.bunnyVideoId) {
      stats.skipped += 1;
      continue;
    }
    try {
      const tracked = await trackBunnyAsset({
        userId: row.userId,
        kind: "stream",
        bunnyId: row.bunnyVideoId,
        // Bei NULL videoUrl bauen wir einen Marker-CDN-Wert — der Purge-
        // Worker nutzt nur `kind` + `bunnyId`, deswegen reicht das.
        cdnUrl: row.videoUrl ?? `stream://${row.bunnyVideoId}`,
      });
      if (tracked.created) stats.trackedNew += 1;
      else stats.trackedExisting += 1;
      await addBunnyAssetRef(tracked.assetId, "lead", row.id);
      stats.refsAdded += 1;
    } catch (err) {
      stats.errors += 1;
      console.error(
        `[backfill-bunny-assets][leads] err id=${row.id}:`,
        err instanceof Error ? err.message : err,
      );
    }
    if (stats.scanned % 50 === 0) logProgress("leads", stats);
  }
  logProgress("leads", stats);
  return stats;
}

async function backfillRuns(): Promise<BackfillStats> {
  const stats = newStats();
  const rows = await db
    .select({
      id: runs.id,
      sharedBunnyVideoId: runs.sharedBunnyVideoId,
      sharedVideoUrl: runs.sharedVideoUrl,
      userId: runs.userId,
    })
    .from(runs)
    .where(isNotNull(runs.sharedBunnyVideoId));

  console.log(`[backfill-bunny-assets][runs] ${rows.length} candidates`);
  for (const row of rows) {
    stats.scanned += 1;
    if (!row.sharedBunnyVideoId) {
      stats.skipped += 1;
      continue;
    }
    try {
      const tracked = await trackBunnyAsset({
        userId: row.userId,
        kind: "stream",
        bunnyId: row.sharedBunnyVideoId,
        cdnUrl: row.sharedVideoUrl ?? `stream://${row.sharedBunnyVideoId}`,
      });
      if (tracked.created) stats.trackedNew += 1;
      else stats.trackedExisting += 1;
      await addBunnyAssetRef(tracked.assetId, "run", row.id);
      stats.refsAdded += 1;
    } catch (err) {
      stats.errors += 1;
      console.error(
        `[backfill-bunny-assets][runs] err id=${row.id}:`,
        err instanceof Error ? err.message : err,
      );
    }
    if (stats.scanned % 50 === 0) logProgress("runs", stats);
  }
  logProgress("runs", stats);
  return stats;
}

async function backfillMediaItems(): Promise<BackfillStats> {
  const stats = newStats();
  const rows = await db
    .select({
      id: mediaItems.id,
      userId: mediaItems.userId,
      type: mediaItems.type,
      publicUrl: mediaItems.publicUrl,
      width: mediaItems.width,
      height: mediaItems.height,
      bytes: mediaItems.bytes,
    })
    .from(mediaItems);

  console.log(`[backfill-bunny-assets][media_items] ${rows.length} candidates`);
  for (const row of rows) {
    stats.scanned += 1;
    const cls = classifyBunnyUrl(row.publicUrl);
    if (!cls) {
      // Nicht-Bunny-URL (z.B. extern gehostetes Logo); kein Tracking.
      stats.skipped += 1;
      continue;
    }
    try {
      const tracked = await trackBunnyAsset({
        userId: row.userId,
        kind: cls.kind,
        bunnyId: cls.bunnyId,
        cdnUrl: cls.cdnUrl,
        width: row.width,
        height: row.height,
        bytes: row.bytes,
      });
      if (tracked.created) stats.trackedNew += 1;
      else stats.trackedExisting += 1;
      await addBunnyAssetRef(tracked.assetId, "media_item", row.id);
      stats.refsAdded += 1;
    } catch (err) {
      stats.errors += 1;
      console.error(
        `[backfill-bunny-assets][media_items] err id=${row.id}:`,
        err instanceof Error ? err.message : err,
      );
    }
    if (stats.scanned % 50 === 0) logProgress("media_items", stats);
  }
  logProgress("media_items", stats);
  return stats;
}

async function main() {
  const t0 = Date.now();
  console.log("[backfill-bunny-assets] start");
  const leadStats = await backfillLeads();
  const runStats = await backfillRuns();
  const mediaStats = await backfillMediaItems();
  const elapsedMs = Date.now() - t0;
  console.log(
    `[backfill-bunny-assets] done in ${elapsedMs}ms — ` +
      `leads(scanned=${leadStats.scanned} new=${leadStats.trackedNew} err=${leadStats.errors}) ` +
      `runs(scanned=${runStats.scanned} new=${runStats.trackedNew} err=${runStats.errors}) ` +
      `media(scanned=${mediaStats.scanned} new=${mediaStats.trackedNew} err=${mediaStats.errors})`,
  );
  // suppress lint warning about unused destructure
  void and;
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[backfill-bunny-assets] FATAL:", err);
    process.exit(1);
  });
