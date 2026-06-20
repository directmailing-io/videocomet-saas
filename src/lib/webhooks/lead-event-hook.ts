/**
 * Bridge zwischen dem Tracker-Insert-Pfad (`insertLeadEvent`) und der
 * Outgoing-Webhook-Pipeline.
 *
 * Verantwortung:
 *   - Internal-Event-Kind ↔ WebhookEventKind mapping
 *   - Payload bauen (Lead/Run/Campaign laden + URL berechnen)
 *   - Quartile-Dedup für `video_progress` (nur bei neuem Quartile feuern)
 *   - Fire-and-Forget Enqueue
 *
 * Strikter Kontrakt: nie werfen. Alle Fehler in console.error.
 */

import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  campaigns,
  leads,
  runs,
  userDomains,
  webhookDeliveries,
  webhookEndpoints,
} from "@/lib/db/schema";
import { buildLeadEventPayload } from "./payload-builder";
import { progressToQuartile } from "./quartile";
import { enqueueWebhooks } from "./enqueue";
import type { WebhookEventDetails, WebhookEventKind } from "./types";
import { buildLeadPublicUrl } from "@/lib/lead-public-url";

const APP_URL = process.env.APP_URL ?? "https://app.videocomet.de";

/**
 * Map vom internen `LeadEventKind` (siehe `queries/lead-events.ts`) auf
 * den `WebhookEventKind`. Aliase wie `lead_open`, `play`, `video_start`
 * unterstützen Legacy-Tracker-Payloads.
 */
export function mapLeadEventKindToWebhook(
  kind: string,
): Extract<
  WebhookEventKind,
  "lead.opened" | "lead.video_played" | "lead.video_progress" | "lead.cta_clicked"
> | null {
  switch (kind) {
    case "page_view":
    case "lead_open":
    case "landingpage_open":
      return "lead.opened";
    case "video_play":
    case "play":
    case "video_start":
      return "lead.video_played";
    case "video_progress":
      return "lead.video_progress";
    case "cta_click":
      return "lead.cta_clicked";
    default:
      return null;
  }
}

interface LeadEventHookInput {
  leadId: string;
  kind: string;
  payload?: Record<string, unknown> | null;
  sessionId?: string | null;
  /** Optionaler Override für den Country-Hash der IP (Tracker liefert das nicht direkt). */
  ipCountry?: string | null;
}

/**
 * Prüft, ob für dieses Lead bereits ein `lead.video_progress` mit diesem
 * (oder höherem) Quartile gefeuert wurde — verhindert das Re-Pushen
 * desselben Quartiles bei jedem 5-Sekunden-Progress-Event.
 *
 * Wir laden die jüngsten `lead.video_progress`-Deliveries (alle
 * Endpoints) und extrahieren das höchste `quartile` aus dem Payload. Nur
 * wenn das aktuelle Quartile darüber liegt, feuern wir den Hook.
 *
 * Optimistic: false-positives sind harmlos (Empfänger bekommt einmal das
 * gleiche Quartile mit anderer event-id), false-negatives (Quartile
 * mehrfach gefeuert) wollen wir aber vermeiden.
 */
async function hasNewQuartile(
  leadId: string,
  quartile: 25 | 50 | 75 | 100,
): Promise<boolean> {
  try {
    const rows = await db
      .select({ payload: webhookDeliveries.payload })
      .from(webhookDeliveries)
      .innerJoin(
        webhookEndpoints,
        eq(webhookEndpoints.id, webhookDeliveries.endpointId),
      )
      .where(
        and(
          eq(webhookDeliveries.leadId, leadId),
          eq(webhookDeliveries.eventKind, "lead.video_progress"),
        ),
      )
      .orderBy(desc(webhookDeliveries.ts))
      .limit(20);
    let lastQuartile = 0;
    for (const r of rows) {
      const p = r.payload as
        | { data?: { event?: { quartile?: number } } }
        | null
        | undefined;
      const q = p?.data?.event?.quartile;
      if (typeof q === "number" && q > lastQuartile) lastQuartile = q;
    }
    return quartile > lastQuartile;
  } catch {
    // Bei Fehlern lieber feuern (false-positives sind ok).
    return true;
  }
}

async function loadHookContext(leadId: string): Promise<
  | {
      userId: string;
      lead: { id: string; slug: string | null; data: Record<string, string> | null; domainId: string | null };
      run: { id: string; name: string };
      campaign: { id: string; name: string };
    }
  | null
> {
  const [row] = await db
    .select({
      leadId: leads.id,
      leadSlug: leads.slug,
      leadData: leads.data,
      leadDomainId: leads.domainId,
      runId: runs.id,
      runName: runs.name,
      runUserId: runs.userId,
      campaignId: campaigns.id,
      campaignName: campaigns.name,
    })
    .from(leads)
    .innerJoin(runs, eq(runs.id, leads.runId))
    .innerJoin(campaigns, eq(campaigns.id, leads.campaignId))
    .where(eq(leads.id, leadId))
    .limit(1);

  if (!row) return null;
  return {
    userId: row.runUserId,
    lead: {
      id: row.leadId,
      slug: row.leadSlug,
      data: (row.leadData as Record<string, string> | null) ?? {},
      domainId: row.leadDomainId,
    },
    run: { id: row.runId, name: row.runName },
    campaign: { id: row.campaignId, name: row.campaignName },
  };
}

async function resolvePageUrl(
  leadSlug: string | null,
  domainId: string | null,
): Promise<string> {
  let customHostname: string | null = null;
  if (domainId) {
    try {
      const [d] = await db
        .select({ hostname: userDomains.hostname })
        .from(userDomains)
        .where(
          and(
            eq(userDomains.id, domainId),
            eq(userDomains.status, "active"),
          ),
        )
        .limit(1);
      if (d) customHostname = d.hostname;
    } catch {
      /* ignored */
    }
  }
  return (
    buildLeadPublicUrl(
      { slug: leadSlug ?? "", customHostname, defaultAppUrl: APP_URL },
      { absolute: true },
    ) ?? `${APP_URL}/v/${leadSlug ?? ""}`
  );
}

function eventDetails(
  kind: Extract<
    WebhookEventKind,
    "lead.opened" | "lead.video_played" | "lead.video_progress" | "lead.cta_clicked"
  >,
  input: LeadEventHookInput,
): WebhookEventDetails {
  const p = (input.payload ?? {}) as Record<string, unknown>;
  const occurredAt = new Date().toISOString();
  const details: WebhookEventDetails = { occurredAt };
  if (input.sessionId) details.sessionId = input.sessionId;
  if (input.ipCountry) details.ipCountry = input.ipCountry;

  if (kind === "lead.video_played" || kind === "lead.video_progress") {
    const playedSec = typeof p.playedSec === "number" ? p.playedSec : undefined;
    const durationSec =
      typeof p.durationSec === "number" ? p.durationSec : undefined;
    if (typeof playedSec === "number") details.playedSec = playedSec;
    if (typeof durationSec === "number") details.durationSec = durationSec;
    if (kind === "lead.video_progress" && typeof playedSec === "number") {
      const q = progressToQuartile(playedSec, durationSec ?? 0);
      if (q !== null) details.quartile = q;
    }
  } else if (kind === "lead.cta_clicked") {
    if (typeof p.ctaLabel === "string") details.ctaLabel = p.ctaLabel;
    if (typeof p.ctaUrl === "string") details.ctaUrl = p.ctaUrl;
    else if (typeof p.url === "string") details.ctaUrl = p.url;
  }

  return details;
}

/**
 * Hot-Path-Hook. Nie werfen.
 */
export async function enqueueWebhooksForLeadEvent(
  input: LeadEventHookInput,
): Promise<void> {
  try {
    const webhookKind = mapLeadEventKindToWebhook(input.kind);
    if (!webhookKind) return;

    const ctx = await loadHookContext(input.leadId);
    if (!ctx) return;

    const details = eventDetails(webhookKind, input);

    // Quartile-Dedup: nur fire bei NEUEM Quartile pro Lead.
    if (webhookKind === "lead.video_progress") {
      const q = details.quartile;
      if (!q) return; // kein Quartile überschritten → kein Push.
      const isNew = await hasNewQuartile(input.leadId, q);
      if (!isNew) return;
    }

    const pageUrl = await resolvePageUrl(ctx.lead.slug, ctx.lead.domainId);

    const payload = buildLeadEventPayload(webhookKind, {
      lead: { id: ctx.lead.id, slug: ctx.lead.slug, data: ctx.lead.data ?? {} },
      run: ctx.run,
      campaign: ctx.campaign,
      pageUrl,
      event: details,
    });

    await enqueueWebhooks({
      userId: ctx.userId,
      campaignId: ctx.campaign.id,
      kind: webhookKind,
      payload,
      leadId: ctx.lead.id,
      runId: ctx.run.id,
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(
      `[webhooks:lead-event-hook] failed for lead=${input.leadId} kind=${input.kind}:`,
      err instanceof Error ? err.message : err,
    );
  }
}

/**
 * Helper für den `bulkInsertLeads`-Hook: feuert `lead.created` für jeden
 * neu eingefügten Lead.
 */
export async function enqueueWebhooksForLeadCreated(args: {
  leadIds: string[];
}): Promise<void> {
  if (args.leadIds.length === 0) return;
  for (const id of args.leadIds) {
    try {
      const ctx = await loadHookContext(id);
      if (!ctx) continue;
      const pageUrl = await resolvePageUrl(ctx.lead.slug, ctx.lead.domainId);
      const occurredAt = new Date().toISOString();
      const { buildLeadCreatedPayload } = await import("./payload-builder");
      const payload = buildLeadCreatedPayload({
        lead: { id: ctx.lead.id, slug: ctx.lead.slug, data: ctx.lead.data ?? {} },
        run: ctx.run,
        campaign: ctx.campaign,
        pageUrl,
        event: { occurredAt },
      });
      await enqueueWebhooks({
        userId: ctx.userId,
        campaignId: ctx.campaign.id,
        kind: "lead.created",
        payload,
        leadId: ctx.lead.id,
        runId: ctx.run.id,
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(
        `[webhooks:lead-created-hook] failed for lead=${id}:`,
        err instanceof Error ? err.message : err,
      );
    }
  }
}

/**
 * Helper für den Run-Finalizer-Hook. Lädt run + campaign + aggregate
 * Zähler und feuert genau einen Webhook (`run.completed` oder
 * `run.failed`).
 */
export async function enqueueWebhooksForRunFinalized(args: {
  runId: string;
  kind: "run.completed" | "run.failed";
}): Promise<void> {
  try {
    const [row] = await db
      .select({
        runId: runs.id,
        runName: runs.name,
        runUserId: runs.userId,
        startedAt: runs.startedAt,
        completedAt: runs.completedAt,
        totalLeads: runs.totalLeads,
        completedLeads: runs.completedLeads,
        failedLeads: runs.failedLeads,
        campaignId: campaigns.id,
        campaignName: campaigns.name,
      })
      .from(runs)
      .innerJoin(campaigns, eq(campaigns.id, runs.campaignId))
      .where(eq(runs.id, args.runId))
      .limit(1);
    if (!row) return;

    // totals aktualisieren falls sie nicht denormalisiert sind — wir
    // verlassen uns aber primär auf die runs.*Leads-Spalten.
    const totalLeads = row.totalLeads ?? 0;
    let completedLeads = row.completedLeads ?? 0;
    let failedLeads = row.failedLeads ?? 0;

    if (totalLeads === 0 || (completedLeads === 0 && failedLeads === 0)) {
      // Fallback: schnelles GROUP-BY auf leads.status.
      try {
        const rows = (await db.execute(sql`
          SELECT
            COUNT(*) FILTER (WHERE ${leads.status} = 'completed')::int AS completed,
            COUNT(*) FILTER (WHERE ${leads.status} = 'failed')::int AS failed
          FROM ${leads}
          WHERE ${leads.runId} = ${args.runId}
            AND ${leads.removedAt} IS NULL
        `)) as unknown as Array<{ completed: number; failed: number }>;
        const r = Array.isArray(rows)
          ? rows[0]
          : (rows as { rows?: Array<{ completed: number; failed: number }> }).rows?.[0];
        completedLeads = Number(r?.completed ?? 0);
        failedLeads = Number(r?.failed ?? 0);
      } catch {
        /* ignored — wir feuern mit den existing Werten */
      }
    }

    const { buildRunEventPayload } = await import("./payload-builder");
    const payload = buildRunEventPayload(args.kind, {
      run: {
        id: row.runId,
        name: row.runName,
        totalLeads,
        completedLeads,
        failedLeads,
        startedAt: row.startedAt,
        completedAt: row.completedAt,
      },
      campaign: { id: row.campaignId, name: row.campaignName },
    });

    await enqueueWebhooks({
      userId: row.runUserId,
      campaignId: row.campaignId,
      kind: args.kind,
      payload,
      runId: row.runId,
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(
      `[webhooks:run-finalize-hook] failed for run=${args.runId} kind=${args.kind}:`,
      err instanceof Error ? err.message : err,
    );
  }
}
