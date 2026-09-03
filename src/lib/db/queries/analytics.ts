import { and, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { analyticsEvents, leads, runs } from "@/lib/db/schema";

export type AnalyticsEvent = typeof analyticsEvents.$inferSelect;
export type NewAnalyticsEvent = typeof analyticsEvents.$inferInsert;

export type EventType =
  | "page_view"
  | "video_start"
  | "video_progress"
  | "cta_click";

export interface RecordEventInput {
  leadId: string;
  eventType: EventType | string;
  eventData?: Record<string, unknown> | null;
  userAgent?: string | null;
  ipHash?: string | null;
}

export interface RunAnalytics {
  totalLeads: number;
  opened: number;
  videoStarted: number;
  ctaClicks: number;
  completedRate: number; // 0..100, avg % video_progress reached
  openRate: number; // 0..1
  videoStartRate: number; // 0..1
}

export async function recordEvent(input: RecordEventInput): Promise<AnalyticsEvent> {
  const [row] = await db
    .insert(analyticsEvents)
    .values({
      leadId: input.leadId,
      eventType: input.eventType,
      eventData: input.eventData ?? null,
      userAgent: input.userAgent ?? null,
      ipHash: input.ipHash ?? null,
    })
    .returning();
  if (!row) throw new Error("Failed to record analytics event");
  return row;
}

export async function getRunAnalytics(
  runId: string,
  userId: string,
): Promise<RunAnalytics> {
  // Tenant-Guard: Run muss dem User gehören
  const [runRow] = await db
    .select({ id: runs.id, totalLeads: runs.totalLeads })
    .from(runs)
    .where(and(eq(runs.id, runId), eq(runs.userId, userId)))
    .limit(1);
  if (!runRow) throw new Error("Not found");

  // Distinct leads pro Event-Typ + Aggregate
  const [stats] = await db
    .select({
      opened: sql<number>`count(distinct case when ${analyticsEvents.eventType} = 'page_view' then ${analyticsEvents.leadId} end)::int`,
      videoStarted: sql<number>`count(distinct case when ${analyticsEvents.eventType} = 'video_start' then ${analyticsEvents.leadId} end)::int`,
      ctaClicks: sql<number>`count(case when ${analyticsEvents.eventType} = 'cta_click' then 1 end)::int`,
      avgProgress: sql<number | null>`avg(case when ${analyticsEvents.eventType} = 'video_progress' then (${analyticsEvents.eventData} ->> 'progress')::float end)`,
    })
    .from(analyticsEvents)
    .innerJoin(leads, eq(leads.id, analyticsEvents.leadId))
    .where(eq(leads.runId, runId));

  // totalLeads aus runs (oder zur Sicherheit über leads-table re-counted)
  const [{ leadCount }] = await db
    .select({ leadCount: sql<number>`count(*)::int` })
    .from(leads)
    .where(eq(leads.runId, runId));

  const totalLeads = leadCount ?? runRow.totalLeads ?? 0;
  const opened = stats?.opened ?? 0;
  const videoStarted = stats?.videoStarted ?? 0;
  const ctaClicks = stats?.ctaClicks ?? 0;

  // Ø gesehener Anteil der Zeitleiste (leads.watch_pct, einmalige Abdeckung)
  // ueber alle Leads mit mindestens einem Play. Fallback auf die alten
  // Meilenstein-Events, falls noch keine Abdeckungsdaten vorliegen.
  const [cov] = await db
    .select({
      avgPct: sql<number | null>`avg(${leads.watchPct}) filter (where ${leads.playCount} > 0)`,
      withPlays: sql<number>`count(*) filter (where ${leads.playCount} > 0)::int`,
    })
    .from(leads)
    .where(eq(leads.runId, runId));
  const avgProgressRaw = stats?.avgProgress ?? null;
  const completedRate =
    cov?.avgPct != null && (cov.withPlays ?? 0) > 0
      ? Number(cov.avgPct)
      : avgProgressRaw == null
        ? 0
        : Number(avgProgressRaw);

  const openRate = totalLeads > 0 ? opened / totalLeads : 0;
  const videoStartRate = totalLeads > 0 ? videoStarted / totalLeads : 0;

  return {
    totalLeads,
    opened,
    videoStarted,
    ctaClicks,
    completedRate,
    openRate,
    videoStartRate,
  };
}
