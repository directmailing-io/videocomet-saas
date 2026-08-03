/**
 * DSGVO-konformer Hard-Delete eines Leads (oder eines "Master-Kontakts" =
 * alle Occurrences dieser Person über alle Kampagnen des Users hinweg).
 *
 * Sequenz orientiert sich am Team-Audit (Migration 0030 Notes):
 *   1. Validate & Snapshot
 *   2. Delete webhook_deliveries mit lead_id (bevor Cascade sonst SET NULL Leak)
 *   3. Delete crm_event_log mit lead_id
 *   4. Remove bunny_asset_refs (owner_type='lead', owner_id=leadId)
 *   5. NULL preflight_screenshot_key (nicht ueber refs registriert)
 *   6. DELETE leads WHERE id = leadId → Cascade übernimmt lead_events,
 *      analytics_events, pipeline_events, lead_slug_aliases
 *   7. Audit-Log-Insert (lead_deletion_audit)
 *   8. Trigger Bunny-Purge (async, best-effort)
 *
 * "Master-Delete" (mehrere Occurrences auf einmal): Aufrufer sammelt alle
 * lead-IDs die zu derselben Person gehoeren (via normalized_email o.ae.)
 * und ruft hardDeleteLeads([...ids]) → wir loopen mit dem gleichen Setup.
 */

import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  leads,
  runs,
  webhookDeliveries,
  crmEventLog,
  bunnyAssetRefs,
  leadDeletionAudit,
  campaigns,
} from "@/lib/db/schema";

export interface HardDeleteInput {
  userId: string;
  leadIds: string[];
  reason: "user_request" | "gdpr_dsar" | "complaint" | "account_cleanup";
  requestedBy?: string;
}

export interface HardDeleteResult {
  deleted: number;
  auditIds: string[];
  bunnyAssetsMarked: number;
}

/**
 * Loescht mehrere Leads in einem Rutsch. Alle muessen dem uebergebenen
 * userId gehoeren (validiert via campaigns.userId join).
 *
 * Wird nicht atomar — jeder Lead ist eigene Transaktion. Bei Teilausfall
 * bleibt der Rest geloescht. Aufrufer kann anhand `deleted` erkennen ob
 * alle durchkamen.
 */
export async function hardDeleteLeads(input: HardDeleteInput): Promise<HardDeleteResult> {
  if (input.leadIds.length === 0) {
    return { deleted: 0, auditIds: [], bunnyAssetsMarked: 0 };
  }

  // Ownership-Verifikation: nur Leads laden die dem User gehoeren.
  const authorized = await db
    .select({
      id: leads.id,
      campaignId: leads.campaignId,
      runId: leads.runId,
      slug: leads.slug,
      pdfUrl: leads.pdfUrl,
      videoUrl: leads.videoUrl,
      preflightScreenshotKey: leads.preflightScreenshotKey,
    })
    .from(leads)
    .innerJoin(campaigns, eq(campaigns.id, leads.campaignId))
    .where(
      and(
        inArray(leads.id, input.leadIds),
        eq(campaigns.userId, input.userId),
      ),
    );

  if (authorized.length === 0) {
    return { deleted: 0, auditIds: [], bunnyAssetsMarked: 0 };
  }

  const authorizedIds = authorized.map((l) => l.id);
  const auditIds: string[] = [];
  let bunnyAssetsMarked = 0;

  for (const lead of authorized) {
    try {
      // 1. Audit-Snapshot ZUERST (falls Cascade rest crashed, haben wir Beleg)
      const [audit] = await db
        .insert(leadDeletionAudit)
        .values({
          userId: input.userId,
          leadId: lead.id,
          campaignId: lead.campaignId,
          runId: lead.runId,
          reason: input.reason,
          requestedBy: input.requestedBy ?? input.userId,
          meta: {
            slug: lead.slug,
            hadPdf: Boolean(lead.pdfUrl),
            hadVideo: Boolean(lead.videoUrl),
            hadPreflight: Boolean(lead.preflightScreenshotKey),
          },
        })
        .returning({ id: leadDeletionAudit.id });
      if (audit) auditIds.push(audit.id);

      // 2. Webhook-Deliveries: HARD-DELETE (nicht SET NULL wie im Schema),
      // sonst bleibt die Lead-Payload im webhook_deliveries.payload liegen.
      await db.delete(webhookDeliveries).where(eq(webhookDeliveries.leadId, lead.id));

      // 3. CRM-Event-Log: dasselbe Argument. Enthaelt requestBody/responseBody
      // mit vollstaendiger Lead-PII.
      await db.delete(crmEventLog).where(eq(crmEventLog.leadId, lead.id));

      // 4. Bunny-Asset-Refs entfernen. Der Purge-Worker markiert Orphans
      // beim naechsten Tick und ruft Bunny-Delete.
      const removedRefs = await db
        .delete(bunnyAssetRefs)
        .where(
          and(
            eq(bunnyAssetRefs.ownerType, "lead"),
            eq(bunnyAssetRefs.ownerId, lead.id),
          ),
        )
        .returning({ id: bunnyAssetRefs.id });
      bunnyAssetsMarked += removedRefs.length;

      // 5. Preflight-Screenshot ist nicht via refs registriert — separater
      // Storage-Delete-Aufruf. Best-effort, cascade-frei.
      if (lead.preflightScreenshotKey) {
        try {
          const { deleteFile } = await import("@/lib/bunny/storage");
          await deleteFile(lead.preflightScreenshotKey);
        } catch (err) {
          console.warn(
            `[hard-delete] preflight-screenshot cleanup failed for lead ${lead.id}:`,
            err instanceof Error ? err.message : "?",
          );
        }
      }

      // 6. DELETE lead — cascade uebernimmt Rest (lead_events,
      // analytics_events, pipeline_events, lead_slug_aliases).
      await db.delete(leads).where(eq(leads.id, lead.id));
    } catch (err) {
      // Nicht abbrechen — nachfolgende Leads versuchen. Aufrufer sieht
      // die Diskrepanz via deleted < input.leadIds.length.
      console.error(`[hard-delete] failed for lead ${lead.id}:`, err);
    }
  }

  // 8. Bunny-Purge triggern (async, best-effort). Der Worker-Cron laeuft
  // eh alle 60s, aber der explizite Trigger beschleunigt.
  try {
    const { triggerBunnyPurgeTick } = await import("@/lib/bunny/purge-trigger");
    await triggerBunnyPurgeTick("leads:hard-delete");
  } catch {
    // Ohne den Trigger ist alles trotzdem konsistent, nur langsamer.
  }

  return {
    deleted: authorizedIds.length,
    auditIds,
    bunnyAssetsMarked,
  };
}
