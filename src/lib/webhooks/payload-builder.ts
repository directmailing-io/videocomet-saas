/**
 * Payload-Builder für Outgoing-Webhooks.
 *
 * Diese Datei kapselt die Konstruktion der `WebhookPayload<TData>`-
 * Strukturen für die 7 unterstützten `WebhookEventKind`s. Aufrufer
 * liefern *rohe* Lead/Run/Campaign-Rows (Drizzle-`$inferSelect`-Typen)
 * plus optionale Event-Detail-Felder; der Builder kombiniert das zu
 * dem flachen, dokumentierten Payload-Shape.
 *
 * STUB: Foundation-Agent ersetzt diese Datei durch eine vollständige
 * Implementierung. Die Funktionssignaturen sind frozen und werden vom
 * Backend-Worker hier importiert.
 */

import { generateEventId } from "./event-id";
import { extractLeadShortcuts } from "./lead-shortcuts";
import type {
  LeadEventData,
  RunEventData,
  WebhookEventDetails,
  WebhookEventKind,
  WebhookLead,
  WebhookPayload,
} from "./types";

export interface LeadEventBuildCtx {
  lead: {
    id: string;
    slug: string | null;
    data: Record<string, string> | null;
  };
  run: { id: string; name: string };
  campaign: { id: string; name: string };
  pageUrl: string;
  event: WebhookEventDetails;
}

export interface RunEventBuildCtx {
  run: {
    id: string;
    name: string;
    totalLeads: number;
    completedLeads: number;
    failedLeads: number;
    startedAt: Date | null;
    completedAt: Date | null;
  };
  campaign: { id: string; name: string };
}

function nowIso(): string {
  return new Date().toISOString();
}

function buildLead(ctx: LeadEventBuildCtx): WebhookLead {
  const data = ctx.lead.data ?? {};
  const shortcuts = extractLeadShortcuts(data);
  return {
    id: ctx.lead.id,
    slug: ctx.lead.slug ?? "",
    firstName: shortcuts.firstName,
    lastName: shortcuts.lastName,
    email: shortcuts.email,
    phone: shortcuts.phone,
    address: shortcuts.address,
    pageUrl: ctx.pageUrl,
    data,
  };
}

export function buildLeadEventPayload(
  kind: Extract<
    WebhookEventKind,
    "lead.opened" | "lead.video_played" | "lead.video_progress" | "lead.cta_clicked"
  >,
  ctx: LeadEventBuildCtx,
): WebhookPayload<LeadEventData> {
  return {
    id: generateEventId(),
    kind,
    ts: nowIso(),
    version: "1",
    data: {
      lead: buildLead(ctx),
      run: { id: ctx.run.id, name: ctx.run.name },
      campaign: { id: ctx.campaign.id, name: ctx.campaign.name },
      event: ctx.event,
    },
  };
}

export function buildLeadCreatedPayload(
  ctx: LeadEventBuildCtx,
): WebhookPayload<LeadEventData> {
  return {
    id: generateEventId(),
    kind: "lead.created",
    ts: nowIso(),
    version: "1",
    data: {
      lead: buildLead(ctx),
      run: { id: ctx.run.id, name: ctx.run.name },
      campaign: { id: ctx.campaign.id, name: ctx.campaign.name },
      event: ctx.event,
    },
  };
}

export function buildRunEventPayload(
  kind: Extract<WebhookEventKind, "run.completed" | "run.failed">,
  ctx: RunEventBuildCtx,
): WebhookPayload<RunEventData> {
  return {
    id: generateEventId(),
    kind,
    ts: nowIso(),
    version: "1",
    data: {
      run: {
        id: ctx.run.id,
        name: ctx.run.name,
        totalLeads: ctx.run.totalLeads,
        completedLeads: ctx.run.completedLeads,
        failedLeads: ctx.run.failedLeads,
        startedAt: ctx.run.startedAt ? ctx.run.startedAt.toISOString() : null,
        completedAt: ctx.run.completedAt
          ? ctx.run.completedAt.toISOString()
          : null,
      },
      campaign: { id: ctx.campaign.id, name: ctx.campaign.name },
    },
  };
}
