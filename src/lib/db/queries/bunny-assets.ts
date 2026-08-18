/**
 * Queries für das zentrale `bunny_assets`-Register + die `bunny_asset_refs`-
 * Bridge (Paket B des grossen Refactors, Schema aus Migration 0013).
 *
 * Public-API (siehe Interface-Doku unten):
 *  - `trackBunnyAsset`               — idempotenter Insert in `bunny_assets`.
 *  - `addBunnyAssetRef`              — idempotenter Insert in `bunny_asset_refs`.
 *  - `removeBunnyAssetRefsForOwner`  — entfernt alle Refs eines Owners.
 *  - `getBunnyAssetIdsForOwner`      — Convenience für Cascade-Delete.
 *  - `markOrphanedAssetsForPurge`    — sweeped Live-Assets ohne Refs → pending.
 *  - `getAssetsReadyForPurge`        — Worker-Batch (oldest first).
 *  - `markAssetPurged` / `markAssetPurgeFailed` — State-Transitions.
 *
 * Race-Sicherheit:
 *  - `bunny_assets` hat ein UNIQUE-Index auf (user_id, kind, bunny_id);
 *    `trackBunnyAsset` nutzt `ON CONFLICT DO NOTHING` und liest bei Conflict
 *    die existierende Zeile nach. Damit ist der Aufrufer-Pfad idempotent.
 *  - `bunny_asset_refs` hat ein UNIQUE-Index auf (asset_id, owner_type,
 *    owner_id); `addBunnyAssetRef` nutzt ebenfalls `ON CONFLICT DO NOTHING`.
 *  - Orphan-Sweep + State-Updates sind reine SET-WHERE-Statements ohne
 *    Read-Modify-Write — mehrere Worker-Ticks dürfen parallel laufen.
 */

import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { bunnyAssetRefs, bunnyAssets } from "@/lib/db/schema";

export type BunnyAssetKind = "stream" | "storage";
export type OwnerType =
  | "lead"
  | "run"
  | "media_item"
  | "campaign_webcam"
  // Storage-Dateien, die in campaigns.segments referenziert sind (PDF-
  // Segmente, Canva-PPTX, Folien-Thumbnails) — Migration 0062.
  | "campaign_media";
export type BunnyPurgeState = "live" | "purge_pending" | "purged";

export interface TrackBunnyAssetInput {
  userId: string;
  kind: BunnyAssetKind;
  /** Stream-GUID oder Storage-Path (je nach `kind`). */
  bunnyId: string;
  cdnUrl: string;
  width?: number | null;
  height?: number | null;
  bytes?: number | null;
  sourceHash?: string | null;
}

/**
 * Registriert einen Bunny-Asset oder gibt den existierenden zurück. Idempotent
 * über das (user_id, kind, bunny_id)-Unique-Index.
 *
 * Implementation:
 *  1. INSERT ... ON CONFLICT (user_id, kind, bunny_id) DO NOTHING RETURNING id
 *  2. Falls nichts zurückkommt → existing-row per SELECT nachladen.
 *
 * `created` ist `true` wenn ein NEUER Row eingefügt wurde — Caller (z.B.
 * Paket D's Upload-Hook) kann das nutzen um seinen eigenen Side-Effect-Log
 * zu schreiben.
 */
export async function trackBunnyAsset(
  input: TrackBunnyAssetInput,
): Promise<{ assetId: string; created: boolean }> {
  const inserted = await db
    .insert(bunnyAssets)
    .values({
      userId: input.userId,
      kind: input.kind,
      bunnyId: input.bunnyId,
      cdnUrl: input.cdnUrl,
      width: input.width ?? null,
      height: input.height ?? null,
      bytes: input.bytes ?? null,
      sourceHash: input.sourceHash ?? null,
    })
    .onConflictDoNothing({
      target: [bunnyAssets.userId, bunnyAssets.kind, bunnyAssets.bunnyId],
    })
    .returning({ id: bunnyAssets.id });

  if (inserted.length > 0) {
    return { assetId: inserted[0].id, created: true };
  }

  // Race: ein paralleler Caller hat den gleichen Asset zwischen unserem
  // INSERT und jetzt registriert. Hole die existierende Row nach.
  const [existing] = await db
    .select({ id: bunnyAssets.id })
    .from(bunnyAssets)
    .where(
      and(
        eq(bunnyAssets.userId, input.userId),
        eq(bunnyAssets.kind, input.kind),
        eq(bunnyAssets.bunnyId, input.bunnyId),
      ),
    )
    .limit(1);

  if (!existing) {
    // Sollte nie passieren: INSERT DO NOTHING returned leer, SELECT findet
    // auch nichts → vermutlich ein DB-Glitch. Caller bekommt klare Fehlermeldung.
    throw new Error(
      `[bunny-assets] trackBunnyAsset: conflict on (${input.userId}, ${input.kind}, ${input.bunnyId}) but no row found`,
    );
  }
  return { assetId: existing.id, created: false };
}

/**
 * Fügt eine Verwendung (Ref) für einen Bunny-Asset hinzu. Idempotent über
 * (asset_id, owner_type, owner_id)-Unique-Index.
 */
export async function addBunnyAssetRef(
  assetId: string,
  ownerType: OwnerType,
  ownerId: string,
): Promise<void> {
  await db
    .insert(bunnyAssetRefs)
    .values({ assetId, ownerType, ownerId })
    .onConflictDoNothing({
      target: [
        bunnyAssetRefs.assetId,
        bunnyAssetRefs.ownerType,
        bunnyAssetRefs.ownerId,
      ],
    });
}

/**
 * Entfernt alle Refs eines Owners (z.B. wenn ein Lead/Run gelöscht wird).
 * Die eigentliche Decrement-Logik (Live → purge_pending) macht der Purge-
 * Worker im nächsten Tick via `markOrphanedAssetsForPurge()`.
 */
export async function removeBunnyAssetRefsForOwner(
  ownerType: OwnerType,
  ownerId: string,
): Promise<void> {
  await db
    .delete(bunnyAssetRefs)
    .where(
      and(
        eq(bunnyAssetRefs.ownerType, ownerType),
        eq(bunnyAssetRefs.ownerId, ownerId),
      ),
    );
}

/**
 * Entfernt gezielt die Refs bestimmter Owner auf bestimmte Stream-GUIDs.
 *
 * Anwendungsfall: ein Video wird ERSETZT (Regenerate all/video, Resume-
 * Content-Mismatch, Bunny status=5). Der Owner (Lead/Run) bekommt gleich
 * eine NEUE GUID — die Ref auf die ALTE GUID muss weg, sonst hält sie das
 * alte Bunny-Video für immer am Leben und der Purge-Worker sieht nie einen
 * Orphan. Wichtig: es werden NUR Refs der übergebenen Owner gelöscht —
 * Mediathek-Items (`owner_type='media_item'`) oder fremde Leads, die
 * dieselbe GUID teilen (Shared-Run-Video), bleiben unangetastet.
 */
export async function removeStreamAssetRefsForGuids(
  userId: string,
  guids: string[],
  owners: Array<{ ownerType: OwnerType; ownerId: string }>,
): Promise<void> {
  if (guids.length === 0 || owners.length === 0) return;
  const assetRows = await db
    .select({ id: bunnyAssets.id })
    .from(bunnyAssets)
    .where(
      and(
        eq(bunnyAssets.userId, userId),
        eq(bunnyAssets.kind, "stream"),
        inArray(bunnyAssets.bunnyId, guids),
      ),
    );
  if (assetRows.length === 0) return;
  const assetIds = assetRows.map((r) => r.id);
  for (const owner of owners) {
    await db
      .delete(bunnyAssetRefs)
      .where(
        and(
          inArray(bunnyAssetRefs.assetId, assetIds),
          eq(bunnyAssetRefs.ownerType, owner.ownerType),
          eq(bunnyAssetRefs.ownerId, owner.ownerId),
        ),
      );
  }
}

/**
 * Entfernt die Refs EINES Owners auf BESTIMMTE Assets (statt alle). Für den
 * campaign_media-Sync: ersetzte Segment-Dateien verlieren nur ihre eigene
 * Ref, die weiterhin referenzierten Dateien bleiben unangetastet.
 */
export async function removeBunnyAssetRefsByAssetIds(
  assetIds: string[],
  ownerType: OwnerType,
  ownerId: string,
): Promise<void> {
  if (assetIds.length === 0) return;
  await db
    .delete(bunnyAssetRefs)
    .where(
      and(
        inArray(bunnyAssetRefs.assetId, assetIds),
        eq(bunnyAssetRefs.ownerType, ownerType),
        eq(bunnyAssetRefs.ownerId, ownerId),
      ),
    );
}

/**
 * Listet alle Asset-IDs, die ein Owner referenziert. Convenience für Cascade-
 * Delete-Flows in Paket D/G/H, die den Asset selbst nicht anfassen wollen,
 * aber den Owner aus dem Logs/UI rauswerfen.
 */
export async function getBunnyAssetIdsForOwner(
  ownerType: OwnerType,
  ownerId: string,
): Promise<string[]> {
  const rows = await db
    .select({ assetId: bunnyAssetRefs.assetId })
    .from(bunnyAssetRefs)
    .where(
      and(
        eq(bunnyAssetRefs.ownerType, ownerType),
        eq(bunnyAssetRefs.ownerId, ownerId),
      ),
    );
  return rows.map((r) => r.assetId);
}

/**
 * Sweepe alle `purge_state='live'`-Assets, die keine `bunny_asset_refs`-
 * Einträge (mehr) haben, in den Zustand `purge_pending`. Returnt die Anzahl
 * der so markierten Assets.
 *
 * Idempotent: WHERE-Filter auf `purge_state='live'` schließt re-tickende
 * Worker aus. Mehrere Worker dürfen parallel sweepen.
 */
export async function markOrphanedAssetsForPurge(): Promise<number> {
  const result = await db.execute(sql`
    UPDATE ${bunnyAssets} AS a
    SET purge_state = 'purge_pending'
    WHERE a.purge_state = 'live'
      AND NOT EXISTS (
        SELECT 1 FROM ${bunnyAssetRefs} AS r WHERE r.asset_id = a.id
      )
  `);
  // postgres-js liefert `RowList` mit `.count`; wir liefern eine sichere
  // Zahl zurück (0 wenn der Treiber den Count nicht setzt).
  const count = (result as unknown as { count?: number })?.count;
  return typeof count === "number" ? count : 0;
}

export interface PurgeReadyAsset {
  id: string;
  kind: BunnyAssetKind;
  bunnyId: string;
  userId: string;
  purgeAttempts: number;
}

/**
 * Liefert die nächsten N Assets, die der Purge-Worker physisch löschen soll.
 * Sortiert nach (purge_attempts asc, created_at asc) — neuere Assets zuerst
 * abgearbeitet wenn alles gleich aufgeschoben war, aber kaputte Assets
 * (hohe attempts) rutschen ans Ende der Schlange.
 */
export async function getAssetsReadyForPurge(
  limit: number,
): Promise<PurgeReadyAsset[]> {
  const rows = await db
    .select({
      id: bunnyAssets.id,
      kind: bunnyAssets.kind,
      bunnyId: bunnyAssets.bunnyId,
      userId: bunnyAssets.userId,
      purgeAttempts: bunnyAssets.purgeAttempts,
    })
    .from(bunnyAssets)
    .where(eq(bunnyAssets.purgeState, "purge_pending"))
    .orderBy(asc(bunnyAssets.purgeAttempts), asc(bunnyAssets.createdAt))
    .limit(Math.max(1, limit));

  return rows.map((r) => ({
    id: r.id,
    kind: r.kind as BunnyAssetKind,
    bunnyId: r.bunnyId,
    userId: r.userId,
    purgeAttempts: r.purgeAttempts,
  }));
}

/**
 * State-Transition: Asset wurde erfolgreich aus Bunny gelöscht. Setzt
 * `purge_state='purged'` und stempelt `purged_at`. `purge_last_error` wird
 * zurückgesetzt, falls vorher ein Fehler hing.
 */
export async function markAssetPurged(assetId: string): Promise<void> {
  await db
    .update(bunnyAssets)
    .set({
      purgeState: "purged",
      purgedAt: new Date(),
      purgeLastError: null,
    })
    .where(eq(bunnyAssets.id, assetId));
}

/**
 * State-Transition: Purge fehlgeschlagen. Inkrementiert `purge_attempts` und
 * speichert die Fehlermeldung. State bleibt `purge_pending` — der nächste
 * Tick versucht es erneut.
 *
 * Stale-Asset-Detection (Paket G) liest später `purge_attempts >= 10` +
 * Asset-Alter > 7 Tage und alarmiert; hier kein E-Mail-Side-Effect.
 */
export async function markAssetPurgeFailed(
  assetId: string,
  error: string,
): Promise<void> {
  // Truncate Error auf 2000 Zeichen — Bunny-Bodies können lang sein, die
  // DB-Spalte ist `text` (unlimitiert) aber Logs/UI bevorzugen Bounded.
  const truncated = error.length > 2000 ? error.slice(0, 2000) + "…" : error;
  await db
    .update(bunnyAssets)
    .set({
      purgeAttempts: sql`${bunnyAssets.purgeAttempts} + 1`,
      purgeLastError: truncated,
    })
    .where(eq(bunnyAssets.id, assetId));
}

/**
 * Internal helper: bulk-fetcht Assets nach IDs (für Tests / Paket G). Nicht
 * im Public-Interface dokumentiert, aber harmlos exportiert.
 */
export async function getBunnyAssetsByIds(ids: string[]) {
  if (ids.length === 0) return [];
  return db.select().from(bunnyAssets).where(inArray(bunnyAssets.id, ids));
}
