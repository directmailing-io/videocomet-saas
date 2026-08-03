/**
 * Abo-Ende-Cleanup: loescht 30 Tage nach Abo-Ende ALLE Inhalte eines Users.
 *
 * Was geloescht wird:
 *  - Leads (DSGVO-Hard-Delete via hardDeleteLeads, inkl. Audit-Log)
 *  - Bunny-Videos/-Assets (ref-basiert: Refs weg → Purge-Worker loescht)
 *  - Mediathek-Items (DB-Rows + Refs)
 *  - Kampagnen (Soft-Delete, deletedAt)
 *  - Custom-Landingpages (Storage-Dateien + Soft-Delete der Versionen)
 *
 * Was NICHT angetastet wird:
 *  - users-Row (Login bleibt), Credits/credit_transactions (verfallen nie),
 *  - Stripe-/Rechnungsdaten (Aufbewahrungspflicht),
 *  - runs-/campaigns-Rows selbst (nur Soft-Delete, keine Medien mehr dahinter).
 *
 * Idempotent: jeder Schritt ist re-runnable (Refs-Delete, Soft-Delete-Filter,
 * deleteVersion behandelt 404 als Erfolg). Bei Teilausfall kann der naechste
 * Sweep-Tick einfach nochmal aufrufen.
 */

import { and, eq, isNull, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  campaigns,
  runs,
  leads,
  mediaItems,
  customLpTemplates,
  customLpVersions,
} from "@/lib/db/schema";
import { hardDeleteLeads } from "@/lib/leads/hard-delete";
import { removeBunnyAssetRefsForOwner } from "@/lib/db/queries/bunny-assets";
import { deleteVersion } from "@/lib/custom-lp/storage";
import { triggerBunnyPurgeTick } from "@/lib/bunny/purge-trigger";

export interface AccountCleanupResult {
  leadsDeleted: number;
  runsCleared: number;
  mediaItemsDeleted: number;
  campaignsSoftDeleted: number;
  lpVersionsDeleted: number;
  lpFilesDeleted: number;
  lpFilesFailed: number;
}

export async function deleteUserContent(
  userId: string,
): Promise<AccountCleanupResult> {
  // Snapshot VOR den Deletes (Soft-Delete cascaded nicht).
  const campaignRows = await db
    .select({ id: campaigns.id })
    .from(campaigns)
    .where(eq(campaigns.userId, userId));
  const campaignIds = campaignRows.map((c) => c.id);

  const runRows = await db
    .select({ id: runs.id })
    .from(runs)
    .where(eq(runs.userId, userId));
  const runIds = runRows.map((r) => r.id);

  const leadRows = await db
    .select({ id: leads.id })
    .from(leads)
    .innerJoin(campaigns, eq(campaigns.id, leads.campaignId))
    .where(eq(campaigns.userId, userId));
  const leadIds = leadRows.map((l) => l.id);

  // 1) Leads DSGVO-hart loeschen (entfernt auch deren Bunny-Refs + killt
  //    alle /v/[slug]-Seiten). Batches, damit der Sweep-Tick bei grossen
  //    Bestaenden nicht ewig in einem Call haengt.
  let leadsDeleted = 0;
  const BATCH = 200;
  for (let i = 0; i < leadIds.length; i += BATCH) {
    const res = await hardDeleteLeads({
      userId,
      leadIds: leadIds.slice(i, i + BATCH),
      reason: "account_cleanup",
      requestedBy: "system:account-cleanup",
    });
    leadsDeleted += res.deleted;
  }

  // 2) Bunny-Refs der restlichen Owner entfernen — Purge-Worker loescht
  //    die Assets danach physisch aus Bunny Stream/Storage.
  const mediaRows = await db
    .select({ id: mediaItems.id })
    .from(mediaItems)
    .where(eq(mediaItems.userId, userId));

  await Promise.all([
    ...runIds.map((id) => removeBunnyAssetRefsForOwner("run", id)),
    ...mediaRows.map((m) => removeBunnyAssetRefsForOwner("media_item", m.id)),
    ...campaignIds.map((id) =>
      removeBunnyAssetRefsForOwner("campaign_webcam", id),
    ),
  ]);

  // 3) Mediathek-Rows loeschen.
  let mediaItemsDeleted = 0;
  if (mediaRows.length > 0) {
    const deleted = await db
      .delete(mediaItems)
      .where(eq(mediaItems.userId, userId))
      .returning({ id: mediaItems.id });
    mediaItemsDeleted = deleted.length;
  }

  // 4) Kampagnen soft-deleten (Listen-Queries blenden sie aus).
  const softDeleted = await db
    .update(campaigns)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(campaigns.userId, userId), isNull(campaigns.deletedAt)))
    .returning({ id: campaigns.id });

  // 5) Custom-LPs: Storage-Dateien loeschen (killt /cv/[slug]-Serving),
  //    dann Versionen soft-deleten. Eigene Storage-Zone, NICHT ref-getrackt.
  const versionRows = await db
    .select({
      id: customLpVersions.id,
      storagePath: customLpVersions.storagePath,
    })
    .from(customLpVersions)
    .innerJoin(
      customLpTemplates,
      eq(customLpTemplates.id, customLpVersions.templateId),
    )
    .where(eq(customLpTemplates.userId, userId));

  let lpFilesDeleted = 0;
  let lpFilesFailed = 0;
  for (const v of versionRows) {
    const res = await deleteVersion(v.storagePath);
    lpFilesDeleted += res.deleted;
    lpFilesFailed += res.failed;
  }
  if (versionRows.length > 0) {
    await db
      .update(customLpVersions)
      .set({ deletedAt: new Date() })
      .where(
        and(
          inArray(
            customLpVersions.id,
            versionRows.map((v) => v.id),
          ),
          isNull(customLpVersions.deletedAt),
        ),
      );
  }

  // 6) Purge sofort anstossen (fire-and-forget, 60s-Cron ist Fallback).
  void triggerBunnyPurgeTick("account-cleanup");

  return {
    leadsDeleted,
    runsCleared: runIds.length,
    mediaItemsDeleted,
    campaignsSoftDeleted: softDeleted.length,
    lpVersionsDeleted: versionRows.length,
    lpFilesDeleted,
    lpFilesFailed,
  };
}
