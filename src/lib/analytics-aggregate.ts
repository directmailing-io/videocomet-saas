/**
 * Server-side aggregation helpers for the per-run analytics dashboard.
 *
 * These extend the basic counters from `getRunAnalytics` (see
 * `src/lib/db/queries/analytics.ts`) with the breakdowns the dashboard needs:
 *
 *  - progressDistribution: how many leads reached each 25/50/75/100% bucket
 *  - ctaBreakdown:         counts grouped by CTA label
 *  - timeOfDayHistogram:   24-bucket histogram of event timestamps (hour 0..23)
 *
 * All queries are scoped via an INNER JOIN on `runs` and `runs.userId`, so a
 * caller can only ever see data for their own runs (multi-tenant safety).
 */

import { and, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { analyticsEvents, leads, runs } from "@/lib/db/schema";

export interface ProgressBucket {
  bucket: 25 | 50 | 75 | 100;
  count: number;
}

export interface CtaBreakdownRow {
  label: string;
  count: number;
}

export interface HourBucket {
  hour: number; // 0..23
  count: number;
}

/**
 * For each lead, count it as having "reached 25%" if any video_progress event
 * for that lead has progress >= 25, etc. Then bucket counts.
 */
export async function getProgressDistribution(
  runId: string,
  userId: string,
): Promise<ProgressBucket[]> {
  // Per lead: max progress reached.
  const rows = await db
    .select({
      leadId: leads.id,
      maxProgress: sql<number | null>`max(
        case when ${analyticsEvents.eventType} = 'video_progress'
             then (${analyticsEvents.eventData} ->> 'progress')::float
        end
      )`,
    })
    .from(leads)
    .innerJoin(runs, eq(runs.id, leads.runId))
    .leftJoin(analyticsEvents, eq(analyticsEvents.leadId, leads.id))
    .where(and(eq(leads.runId, runId), eq(runs.userId, userId)))
    .groupBy(leads.id);

  let b25 = 0;
  let b50 = 0;
  let b75 = 0;
  let b100 = 0;
  for (const r of rows) {
    const p = r.maxProgress == null ? null : Number(r.maxProgress);
    if (p == null) continue;
    if (p >= 25) b25++;
    if (p >= 50) b50++;
    if (p >= 75) b75++;
    if (p >= 100) b100++;
  }
  return [
    { bucket: 25, count: b25 },
    { bucket: 50, count: b50 },
    { bucket: 75, count: b75 },
    { bucket: 100, count: b100 },
  ];
}

/**
 * Count `cta_click` events grouped by the `label` field in eventData
 * (e.g. "Termin buchen", "Mehr erfahren"). Falls back to "(unbenannt)" when
 * the event has no label. Returns sorted descending by count.
 */
export async function getCtaBreakdown(
  runId: string,
  userId: string,
): Promise<CtaBreakdownRow[]> {
  const rows = await db
    .select({
      label: sql<string | null>`${analyticsEvents.eventData} ->> 'label'`,
      count: sql<number>`count(*)::int`,
    })
    .from(analyticsEvents)
    .innerJoin(leads, eq(leads.id, analyticsEvents.leadId))
    .innerJoin(runs, eq(runs.id, leads.runId))
    .where(
      and(
        eq(leads.runId, runId),
        eq(runs.userId, userId),
        eq(analyticsEvents.eventType, "cta_click"),
      ),
    )
    .groupBy(sql`${analyticsEvents.eventData} ->> 'label'`);

  return rows
    .map((r) => ({
      label: r.label && r.label.trim() ? r.label : "(unbenannt)",
      count: r.count ?? 0,
    }))
    .sort((a, b) => b.count - a.count);
}

/**
 * 24-bucket histogram of analyticsEvents over a run. Always returns 24 entries
 * (hours 0..23) even if some are zero, so the chart can render a stable layout.
 */
export async function getTimeOfDayHistogram(
  runId: string,
  userId: string,
): Promise<HourBucket[]> {
  const rows = await db
    .select({
      hour: sql<number>`extract(hour from ${analyticsEvents.createdAt})::int`,
      count: sql<number>`count(*)::int`,
    })
    .from(analyticsEvents)
    .innerJoin(leads, eq(leads.id, analyticsEvents.leadId))
    .innerJoin(runs, eq(runs.id, leads.runId))
    .where(and(eq(leads.runId, runId), eq(runs.userId, userId)))
    .groupBy(sql`extract(hour from ${analyticsEvents.createdAt})`);

  const buckets: HourBucket[] = Array.from({ length: 24 }, (_, h) => ({
    hour: h,
    count: 0,
  }));
  for (const r of rows) {
    const h = r.hour;
    if (typeof h === "number" && h >= 0 && h <= 23) {
      buckets[h].count = r.count ?? 0;
    }
  }
  return buckets;
}
