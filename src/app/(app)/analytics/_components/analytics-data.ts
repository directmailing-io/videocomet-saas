/**
 * Server-only data layer for the Analytics-Dashboard.
 *
 * Why this lives in the page-folder and not in `src/lib/db/queries/`:
 * the page brief explicitly carves the queries-folder out of our write
 * scope. This module wraps the existing read-side query layer
 * (`listCampaignAggregates`, `getCampaignDeepDive`, `getFunnel`) AND adds
 * thin range-scoped aggregations that the dashboard needs (hero stats with
 * prev-period delta, time-series with day/hour buckets, top-leads by
 * activity). All raw SQL is tenant-guarded through the
 * `campaigns.userId = userId` predicate.
 *
 * Everything here is `import "server-only"` — never bundle into the client.
 */

import "server-only";

import { and, desc, eq, gte, inArray, isNull, lt, lte, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { campaigns, leadEvents, leads, runs } from "@/lib/db/schema";

// ── Range / Filter Types ────────────────────────────────────────────────────

export type RangeKey = "today" | "7d" | "30d" | "90d" | "custom";

export interface AnalyticsRange {
  /** UTC start (inclusive). */
  from: Date;
  /** UTC end (exclusive). */
  to: Date;
  /** Same length as [from, to), one window directly before. Used for delta. */
  prevFrom: Date;
  prevTo: Date;
  key: RangeKey;
  /** Bucket size for time-series. Day for >= 2 day ranges, hour for "today". */
  bucket: "day" | "hour";
  /** Human label. */
  label: string;
}

export interface RangeInput {
  key?: string | null;
  from?: string | null;
  to?: string | null;
  bucket?: string | null;
}

/**
 * Parse `?range=` (today|7d|30d|90d|custom) + optional from/to + bucket.
 * Always returns a valid window plus the matching prev-period for delta calc.
 */
export function resolveRange(input: RangeInput): AnalyticsRange {
  const now = new Date();
  const todayUtc = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  const tomorrowUtc = new Date(todayUtc.getTime() + 24 * 3600 * 1000);

  const key = (input.key as RangeKey) || "30d";
  let from: Date;
  let to: Date;
  let bucket: "day" | "hour";
  let label: string;

  switch (key) {
    case "today":
      from = todayUtc;
      to = tomorrowUtc;
      bucket = "hour";
      label = "Heute";
      break;
    case "7d":
      from = new Date(tomorrowUtc.getTime() - 7 * 24 * 3600 * 1000);
      to = tomorrowUtc;
      bucket = "day";
      label = "Letzte 7 Tage";
      break;
    case "90d":
      from = new Date(tomorrowUtc.getTime() - 90 * 24 * 3600 * 1000);
      to = tomorrowUtc;
      bucket = "day";
      label = "Letzte 90 Tage";
      break;
    case "custom": {
      const f = input.from ? new Date(input.from) : null;
      const t = input.to ? new Date(input.to) : null;
      if (f && Number.isFinite(f.getTime()) && t && Number.isFinite(t.getTime())) {
        from = f;
        to = t;
        const days = Math.max(
          1,
          Math.round((to.getTime() - from.getTime()) / (24 * 3600 * 1000)),
        );
        bucket = days <= 2 ? "hour" : "day";
        label = `${from.toISOString().slice(0, 10)} – ${to.toISOString().slice(0, 10)}`;
      } else {
        // Bad custom → fall back to 30d.
        from = new Date(tomorrowUtc.getTime() - 30 * 24 * 3600 * 1000);
        to = tomorrowUtc;
        bucket = "day";
        label = "Letzte 30 Tage";
      }
      break;
    }
    case "30d":
    default:
      from = new Date(tomorrowUtc.getTime() - 30 * 24 * 3600 * 1000);
      to = tomorrowUtc;
      bucket = "day";
      label = "Letzte 30 Tage";
      break;
  }

  // Allow caller to override bucket (e.g. user toggled to hour for 7d).
  if (input.bucket === "hour" || input.bucket === "day") {
    bucket = input.bucket;
  }

  const span = to.getTime() - from.getTime();
  const prevTo = from;
  const prevFrom = new Date(from.getTime() - span);

  return { from, to, prevFrom, prevTo, key, bucket, label };
}

// ── Hero stats (range-scoped, with prev-period delta) ──────────────────────

export interface HeroStats {
  pageViews: number;
  videoPlays: number;
  ctaClicks: number;
  hotLeads: number;
  watchTimeSec: number;
  ctaRatePct: number;
  /** Previous-period absolute values for delta rendering. */
  prev: {
    pageViews: number;
    videoPlays: number;
    ctaClicks: number;
    hotLeads: number;
    watchTimeSec: number;
    ctaRatePct: number;
  };
}

/**
 * Range-scoped sums of `lead_events` per kind, plus active hot-lead count
 * (leads that crossed the 75 % progress threshold or fired a cta_click in
 * the same window). One query per period, joined back in JS.
 */
async function readKindCounts(
  userId: string,
  from: Date,
  to: Date,
  campaignId: string | null,
): Promise<{
  pageViews: number;
  videoPlays: number;
  ctaClicks: number;
  watchTimeSec: number;
  hotLeads: number;
}> {
  const baseConds = [
    eq(campaigns.userId, userId),
    isNull(leads.removedAt),
    gte(leadEvents.ts, from),
    lt(leadEvents.ts, to),
  ];
  if (campaignId) baseConds.push(eq(campaigns.id, campaignId));

  // Sum per kind + watch-time (atSec progress payload).
  const [agg] = await db
    .select({
      pageViews: sql<number>`COUNT(*) FILTER (WHERE ${leadEvents.kind} = 'page_view')::int`,
      videoPlays: sql<number>`COUNT(*) FILTER (WHERE ${leadEvents.kind} = 'video_play')::int`,
      ctaClicks: sql<number>`COUNT(*) FILTER (WHERE ${leadEvents.kind} = 'cta_click')::int`,
      // Watch-time from video_progress/ended atSec (max per lead approximated by sum of deltas)
      // Simpler: count distinct play-events × naive constant — instead reuse leads.watchTimeSec
      // outside the window when no window — but for window we approximate from progress events.
      // We pick the SUM of atSec floors per session-window — practical proxy.
      watchProxy: sql<number>`COALESCE(SUM(CASE
        WHEN ${leadEvents.kind} IN ('video_progress','video_ended')
          AND (${leadEvents.payload} ? 'atSec')
          AND (${leadEvents.payload} -> 'atSec')::text ~ '^-?[0-9]+(\\.[0-9]+)?$'
        THEN GREATEST(0, LEAST(7200, (${leadEvents.payload} ->> 'atSec')::float))
        ELSE 0
      END), 0)::int`,
    })
    .from(leadEvents)
    .innerJoin(leads, eq(leads.id, leadEvents.leadId))
    .innerJoin(runs, eq(runs.id, leads.runId))
    .innerJoin(campaigns, eq(campaigns.id, runs.campaignId))
    .where(and(...baseConds));

  // Hot leads in window: leads that EITHER fired a cta_click within range OR
  // reached >= 75% video progress within range. Computed in a single query.
  const [hotRow] = await db
    .select({
      hot: sql<number>`COUNT(DISTINCT ${leads.id})::int`,
    })
    .from(leadEvents)
    .innerJoin(leads, eq(leads.id, leadEvents.leadId))
    .innerJoin(runs, eq(runs.id, leads.runId))
    .innerJoin(campaigns, eq(campaigns.id, runs.campaignId))
    .where(
      and(
        ...baseConds,
        sql`(
          ${leadEvents.kind} = 'cta_click'
          OR (
            ${leadEvents.kind} IN ('video_progress','video_ended')
            AND (${leadEvents.payload} ? 'atSec')
            AND (${leadEvents.payload} ? 'duration')
            AND COALESCE(NULLIF(${leadEvents.payload} ->> 'duration', '')::float, 0) > 0
            AND (COALESCE(NULLIF(${leadEvents.payload} ->> 'atSec', '')::float, 0)
                 / NULLIF(NULLIF(${leadEvents.payload} ->> 'duration', '')::float, 0)) * 100 >= 75
          )
        )`,
      ),
    );

  return {
    pageViews: agg?.pageViews ?? 0,
    videoPlays: agg?.videoPlays ?? 0,
    ctaClicks: agg?.ctaClicks ?? 0,
    watchTimeSec: agg?.watchProxy ?? 0,
    hotLeads: hotRow?.hot ?? 0,
  };
}

export async function getHeroStats(
  userId: string,
  range: AnalyticsRange,
  campaignId: string | null = null,
): Promise<HeroStats> {
  const [cur, prev] = await Promise.all([
    readKindCounts(userId, range.from, range.to, campaignId),
    readKindCounts(userId, range.prevFrom, range.prevTo, campaignId),
  ]);

  const curRate = cur.videoPlays > 0 ? (cur.ctaClicks / cur.videoPlays) * 100 : 0;
  const prevRate =
    prev.videoPlays > 0 ? (prev.ctaClicks / prev.videoPlays) * 100 : 0;

  return {
    pageViews: cur.pageViews,
    videoPlays: cur.videoPlays,
    ctaClicks: cur.ctaClicks,
    watchTimeSec: cur.watchTimeSec,
    hotLeads: cur.hotLeads,
    ctaRatePct: curRate,
    prev: {
      pageViews: prev.pageViews,
      videoPlays: prev.videoPlays,
      ctaClicks: prev.ctaClicks,
      watchTimeSec: prev.watchTimeSec,
      hotLeads: prev.hotLeads,
      ctaRatePct: prevRate,
    },
  };
}

// ── Time-series (bucketed) ──────────────────────────────────────────────────

export interface TimeBucket {
  /** ISO key — date for "day", date+hour for "hour". */
  bucket: string;
  /** Display label (DD.MM. for day, HH:00 for hour). */
  label: string;
  pageViews: number;
  videoPlays: number;
  ctaClicks: number;
}

export async function getTimeSeries(
  userId: string,
  range: AnalyticsRange,
  campaignId: string | null = null,
): Promise<TimeBucket[]> {
  const baseConds = [
    eq(campaigns.userId, userId),
    isNull(leads.removedAt),
    gte(leadEvents.ts, range.from),
    lt(leadEvents.ts, range.to),
    sql`${leadEvents.kind} IN ('page_view','video_play','cta_click')`,
  ];
  if (campaignId) baseConds.push(eq(campaigns.id, campaignId));

  const bucketExpr =
    range.bucket === "hour"
      ? sql<string>`to_char(date_trunc('hour', ${leadEvents.ts} at time zone 'UTC'), 'YYYY-MM-DD"T"HH24:00:00')`
      : sql<string>`to_char((${leadEvents.ts} at time zone 'UTC')::date, 'YYYY-MM-DD')`;

  const rows = await db
    .select({
      bucket: bucketExpr,
      kind: leadEvents.kind,
      count: sql<number>`COUNT(*)::int`,
    })
    .from(leadEvents)
    .innerJoin(leads, eq(leads.id, leadEvents.leadId))
    .innerJoin(runs, eq(runs.id, leads.runId))
    .innerJoin(campaigns, eq(campaigns.id, runs.campaignId))
    .where(and(...baseConds))
    .groupBy(bucketExpr, leadEvents.kind);

  // Build the full bucket range so the chart never has gaps.
  const buckets = enumerateBuckets(range);
  const map = new Map<string, TimeBucket>();
  for (const b of buckets) map.set(b.bucket, b);
  for (const r of rows) {
    const entry = map.get(r.bucket);
    if (!entry) continue;
    if (r.kind === "page_view") entry.pageViews += r.count;
    else if (r.kind === "video_play") entry.videoPlays += r.count;
    else if (r.kind === "cta_click") entry.ctaClicks += r.count;
  }
  return buckets;
}

function enumerateBuckets(range: AnalyticsRange): TimeBucket[] {
  const buckets: TimeBucket[] = [];
  const stepMs = range.bucket === "hour" ? 3600 * 1000 : 24 * 3600 * 1000;
  const start = new Date(range.from);
  if (range.bucket === "hour") {
    start.setUTCMinutes(0, 0, 0);
  } else {
    start.setUTCHours(0, 0, 0, 0);
  }
  for (let t = start.getTime(); t < range.to.getTime(); t += stepMs) {
    const d = new Date(t);
    if (range.bucket === "hour") {
      const iso = `${d.toISOString().slice(0, 13)}:00:00`;
      const label = `${String(d.getUTCHours()).padStart(2, "0")}:00`;
      buckets.push({ bucket: iso, label, pageViews: 0, videoPlays: 0, ctaClicks: 0 });
    } else {
      const iso = d.toISOString().slice(0, 10);
      const label = `${String(d.getUTCDate()).padStart(2, "0")}.${String(d.getUTCMonth() + 1).padStart(2, "0")}.`;
      buckets.push({ bucket: iso, label, pageViews: 0, videoPlays: 0, ctaClicks: 0 });
    }
  }
  return buckets;
}

// ── Global funnel (range-scoped, owner-wide or campaign-scoped) ─────────────

export interface FunnelStep {
  key: "page_view" | "video_play" | "video_75" | "cta_click";
  label: string;
  count: number;
  pctOfTop: number;
  pctOfPrev: number;
}

export interface FunnelData {
  steps: FunnelStep[];
  /** Largest drop-off step (key + count lost). */
  biggestDropoff: {
    fromLabel: string;
    toLabel: string;
    lostCount: number;
    lostPctOfPrev: number;
  } | null;
  /** Median atSec at which video playback ended (proxy for drop-off-time). */
  medianAbandonSec: number | null;
}

export async function getFunnelData(
  userId: string,
  range: AnalyticsRange,
  campaignId: string | null = null,
): Promise<FunnelData> {
  const baseConds = [
    eq(campaigns.userId, userId),
    isNull(leads.removedAt),
    gte(leadEvents.ts, range.from),
    lt(leadEvents.ts, range.to),
  ];
  if (campaignId) baseConds.push(eq(campaigns.id, campaignId));

  const [row] = await db
    .select({
      pageViewLeads: sql<number>`COUNT(DISTINCT CASE WHEN ${leadEvents.kind} = 'page_view' THEN ${leads.id} END)::int`,
      videoPlayLeads: sql<number>`COUNT(DISTINCT CASE WHEN ${leadEvents.kind} = 'video_play' THEN ${leads.id} END)::int`,
      video75Leads: sql<number>`COUNT(DISTINCT CASE WHEN
        ${leadEvents.kind} IN ('video_progress','video_ended')
        AND (${leadEvents.payload} ? 'atSec')
        AND (${leadEvents.payload} ? 'duration')
        AND COALESCE(NULLIF(${leadEvents.payload} ->> 'duration', '')::float, 0) > 0
        AND (COALESCE(NULLIF(${leadEvents.payload} ->> 'atSec', '')::float, 0)
             / NULLIF(NULLIF(${leadEvents.payload} ->> 'duration', '')::float, 0)) * 100 >= 75
        THEN ${leads.id} END)::int`,
      ctaLeads: sql<number>`COUNT(DISTINCT CASE WHEN ${leadEvents.kind} = 'cta_click' THEN ${leads.id} END)::int`,
      medianAbandon: sql<number | null>`PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY
        CASE WHEN ${leadEvents.kind} = 'video_ended'
          AND (${leadEvents.payload} ? 'atSec')
          AND (${leadEvents.payload} -> 'atSec')::text ~ '^-?[0-9]+(\\.[0-9]+)?$'
          THEN (${leadEvents.payload} ->> 'atSec')::float
          END
        )`,
    })
    .from(leadEvents)
    .innerJoin(leads, eq(leads.id, leadEvents.leadId))
    .innerJoin(runs, eq(runs.id, leads.runId))
    .innerJoin(campaigns, eq(campaigns.id, runs.campaignId))
    .where(and(...baseConds));

  const pv = row?.pageViewLeads ?? 0;
  const vp = row?.videoPlayLeads ?? 0;
  const v75 = row?.video75Leads ?? 0;
  const cta = row?.ctaLeads ?? 0;
  const top = Math.max(pv, 1);
  const pct = (n: number, base: number) =>
    base > 0 ? Math.round((n / base) * 1000) / 10 : 0;

  const steps: FunnelStep[] = [
    {
      key: "page_view",
      label: "Seite aufgerufen",
      count: pv,
      pctOfTop: 100,
      pctOfPrev: 100,
    },
    {
      key: "video_play",
      label: "Video gestartet",
      count: vp,
      pctOfTop: pct(vp, top),
      pctOfPrev: pct(vp, pv),
    },
    {
      key: "video_75",
      label: "Video ≥ 75 %",
      count: v75,
      pctOfTop: pct(v75, top),
      pctOfPrev: pct(v75, vp),
    },
    {
      key: "cta_click",
      label: "CTA geklickt",
      count: cta,
      pctOfTop: pct(cta, top),
      pctOfPrev: pct(cta, v75 || vp),
    },
  ];

  // Find biggest absolute drop-off between consecutive steps.
  let biggestDropoff: FunnelData["biggestDropoff"] = null;
  for (let i = 1; i < steps.length; i++) {
    const prev = steps[i - 1];
    const curr = steps[i];
    const lost = Math.max(0, prev.count - curr.count);
    if (lost === 0) continue;
    if (!biggestDropoff || lost > biggestDropoff.lostCount) {
      biggestDropoff = {
        fromLabel: prev.label,
        toLabel: curr.label,
        lostCount: lost,
        lostPctOfPrev: 100 - curr.pctOfPrev,
      };
    }
  }

  return {
    steps,
    biggestDropoff,
    medianAbandonSec: row?.medianAbandon ?? null,
  };
}

// ── Campaign-Performance (range-scoped) ─────────────────────────────────────

export interface CampaignPerf {
  id: string;
  name: string;
  pageViews: number;
  videoPlays: number;
  ctaClicks: number;
  watchTimeSec: number;
  leadsCount: number;
  runsCount: number;
  ctrPct: number;
  /** Lead-temperature counts in this window (hot/engaged/warm/cold). */
  temperature: { hot: number; engaged: number; warm: number; cold: number };
}

export async function listCampaignPerformance(
  userId: string,
  range: AnalyticsRange,
): Promise<CampaignPerf[]> {
  const camps = await db
    .select({
      id: campaigns.id,
      name: campaigns.name,
    })
    .from(campaigns)
    .where(eq(campaigns.userId, userId))
    .orderBy(desc(campaigns.createdAt));
  if (camps.length === 0) return [];
  const campIds = camps.map((c) => c.id);

  // Lead+run counts per campaign (all time, since "Kampagne XY hat 200 Leads"
  // is a property of the campaign, not the window).
  const leadAgg = await db
    .select({
      campaignId: runs.campaignId,
      leadsCount: sql<number>`COUNT(${leads.id})::int`,
    })
    .from(leads)
    .innerJoin(runs, eq(runs.id, leads.runId))
    .where(
      and(
        eq(runs.userId, userId),
        inArray(runs.campaignId, campIds),
        isNull(leads.removedAt),
      ),
    )
    .groupBy(runs.campaignId);
  const leadsByCampaign = new Map(leadAgg.map((r) => [r.campaignId, r.leadsCount]));

  const runAgg = await db
    .select({
      campaignId: runs.campaignId,
      runsCount: sql<number>`COUNT(*)::int`,
    })
    .from(runs)
    .where(and(eq(runs.userId, userId), inArray(runs.campaignId, campIds)))
    .groupBy(runs.campaignId);
  const runsByCampaign = new Map(runAgg.map((r) => [r.campaignId, r.runsCount]));

  // Events per kind per campaign (window-scoped).
  const eventAgg = await db
    .select({
      campaignId: runs.campaignId,
      pageViews: sql<number>`COUNT(*) FILTER (WHERE ${leadEvents.kind} = 'page_view')::int`,
      videoPlays: sql<number>`COUNT(*) FILTER (WHERE ${leadEvents.kind} = 'video_play')::int`,
      ctaClicks: sql<number>`COUNT(*) FILTER (WHERE ${leadEvents.kind} = 'cta_click')::int`,
      watchTimeSec: sql<number>`COALESCE(SUM(CASE
        WHEN ${leadEvents.kind} IN ('video_progress','video_ended')
          AND (${leadEvents.payload} ? 'atSec')
          AND (${leadEvents.payload} -> 'atSec')::text ~ '^-?[0-9]+(\\.[0-9]+)?$'
        THEN GREATEST(0, LEAST(7200, (${leadEvents.payload} ->> 'atSec')::float))
        ELSE 0
      END), 0)::int`,
    })
    .from(leadEvents)
    .innerJoin(leads, eq(leads.id, leadEvents.leadId))
    .innerJoin(runs, eq(runs.id, leads.runId))
    .where(
      and(
        eq(runs.userId, userId),
        inArray(runs.campaignId, campIds),
        isNull(leads.removedAt),
        gte(leadEvents.ts, range.from),
        lt(leadEvents.ts, range.to),
      ),
    )
    .groupBy(runs.campaignId);
  const eventByCampaign = new Map(eventAgg.map((r) => [r.campaignId, r]));

  // Temperature bucket counts per campaign (window-scoped).
  const tempAgg = await db
    .select({
      campaignId: runs.campaignId,
      leadId: leads.id,
      hasCta: sql<number>`MAX(CASE WHEN ${leadEvents.kind} = 'cta_click' THEN 1 ELSE 0 END)::int`,
      has75: sql<number>`MAX(CASE WHEN
        ${leadEvents.kind} IN ('video_progress','video_ended')
        AND (${leadEvents.payload} ? 'atSec')
        AND (${leadEvents.payload} ? 'duration')
        AND COALESCE(NULLIF(${leadEvents.payload} ->> 'duration', '')::float, 0) > 0
        AND (COALESCE(NULLIF(${leadEvents.payload} ->> 'atSec', '')::float, 0)
             / NULLIF(NULLIF(${leadEvents.payload} ->> 'duration', '')::float, 0)) * 100 >= 75
        THEN 1 ELSE 0 END)::int`,
      has25: sql<number>`MAX(CASE WHEN
        ${leadEvents.kind} IN ('video_progress','video_ended')
        AND (${leadEvents.payload} ? 'atSec')
        AND (${leadEvents.payload} ? 'duration')
        AND COALESCE(NULLIF(${leadEvents.payload} ->> 'duration', '')::float, 0) > 0
        AND (COALESCE(NULLIF(${leadEvents.payload} ->> 'atSec', '')::float, 0)
             / NULLIF(NULLIF(${leadEvents.payload} ->> 'duration', '')::float, 0)) * 100 >= 25
        THEN 1 ELSE 0 END)::int`,
      hasPlay: sql<number>`MAX(CASE WHEN ${leadEvents.kind} = 'video_play' THEN 1 ELSE 0 END)::int`,
      hasPv: sql<number>`MAX(CASE WHEN ${leadEvents.kind} = 'page_view' THEN 1 ELSE 0 END)::int`,
    })
    .from(leadEvents)
    .innerJoin(leads, eq(leads.id, leadEvents.leadId))
    .innerJoin(runs, eq(runs.id, leads.runId))
    .where(
      and(
        eq(runs.userId, userId),
        inArray(runs.campaignId, campIds),
        isNull(leads.removedAt),
        gte(leadEvents.ts, range.from),
        lt(leadEvents.ts, range.to),
      ),
    )
    .groupBy(runs.campaignId, leads.id);

  const tempByCampaign = new Map<
    string,
    { hot: number; engaged: number; warm: number; cold: number }
  >();
  for (const r of tempAgg) {
    const t = tempByCampaign.get(r.campaignId) ?? {
      hot: 0,
      engaged: 0,
      warm: 0,
      cold: 0,
    };
    if ((r.hasCta ?? 0) > 0) t.engaged += 1;
    else if ((r.has75 ?? 0) > 0) t.hot += 1;
    else if ((r.hasPlay ?? 0) > 0 && (r.has25 ?? 0) > 0) t.warm += 1;
    else if ((r.hasPv ?? 0) > 0) t.cold += 1;
    tempByCampaign.set(r.campaignId, t);
  }

  return camps.map((c) => {
    const ev = eventByCampaign.get(c.id);
    const pv = ev?.pageViews ?? 0;
    const plays = ev?.videoPlays ?? 0;
    const cta = ev?.ctaClicks ?? 0;
    const ctr = pv > 0 ? (cta / pv) * 100 : 0;
    return {
      id: c.id,
      name: c.name,
      pageViews: pv,
      videoPlays: plays,
      ctaClicks: cta,
      watchTimeSec: ev?.watchTimeSec ?? 0,
      leadsCount: leadsByCampaign.get(c.id) ?? 0,
      runsCount: runsByCampaign.get(c.id) ?? 0,
      ctrPct: ctr,
      temperature: tempByCampaign.get(c.id) ?? {
        hot: 0,
        engaged: 0,
        warm: 0,
        cold: 0,
      },
    };
  });
}

// ── Top Leads in window (sorted by combined activity score) ─────────────────

export interface TopLead {
  id: string;
  name: string;
  company: string;
  campaignId: string;
  campaignName: string;
  runId: string;
  runName: string;
  pageViews: number;
  videoPlays: number;
  ctaClicks: number;
  watchTimeSec: number;
  lastEventTs: Date | null;
  lastKind: string | null;
  temperature: "engaged" | "hot" | "warm" | "cold";
}

export async function getTopLeads(
  userId: string,
  range: AnalyticsRange,
  campaignId: string | null = null,
  limit = 10,
): Promise<TopLead[]> {
  const baseConds = [
    eq(campaigns.userId, userId),
    isNull(leads.removedAt),
    gte(leadEvents.ts, range.from),
    lt(leadEvents.ts, range.to),
  ];
  if (campaignId) baseConds.push(eq(campaigns.id, campaignId));

  const rows = await db
    .select({
      leadId: leads.id,
      data: leads.data,
      campaignId: campaigns.id,
      campaignName: campaigns.name,
      runId: runs.id,
      runName: runs.name,
      pageViews: sql<number>`COUNT(*) FILTER (WHERE ${leadEvents.kind} = 'page_view')::int`,
      videoPlays: sql<number>`COUNT(*) FILTER (WHERE ${leadEvents.kind} = 'video_play')::int`,
      ctaClicks: sql<number>`COUNT(*) FILTER (WHERE ${leadEvents.kind} = 'cta_click')::int`,
      watchTimeSec: sql<number>`COALESCE(SUM(CASE
        WHEN ${leadEvents.kind} IN ('video_progress','video_ended')
          AND (${leadEvents.payload} ? 'atSec')
          AND (${leadEvents.payload} -> 'atSec')::text ~ '^-?[0-9]+(\\.[0-9]+)?$'
        THEN GREATEST(0, LEAST(7200, (${leadEvents.payload} ->> 'atSec')::float))
        ELSE 0
      END), 0)::int`,
      lastEventTs: sql<Date>`MAX(${leadEvents.ts})`,
      lastKind: sql<string | null>`(
        SELECT le2.kind
        FROM ${leadEvents} le2
        WHERE le2.lead_id = ${leads.id}
          AND le2.ts >= ${range.from.toISOString()}
          AND le2.ts < ${range.to.toISOString()}
        ORDER BY le2.ts DESC
        LIMIT 1
      )`,
      maxProgressPct: sql<number>`COALESCE(MAX(CASE WHEN
        ${leadEvents.kind} IN ('video_progress','video_ended')
        AND (${leadEvents.payload} ? 'atSec')
        AND (${leadEvents.payload} ? 'duration')
        AND COALESCE(NULLIF(${leadEvents.payload} ->> 'duration', '')::float, 0) > 0
        THEN (COALESCE(NULLIF(${leadEvents.payload} ->> 'atSec', '')::float, 0)
              / NULLIF(NULLIF(${leadEvents.payload} ->> 'duration', '')::float, 0)) * 100
        ELSE 0 END), 0)::float`,
      // Activity score for ranking
      score: sql<number>`(
        COUNT(*) FILTER (WHERE ${leadEvents.kind} = 'cta_click')::int * 100
        + COUNT(*) FILTER (WHERE ${leadEvents.kind} = 'video_play')::int * 10
        + COUNT(*) FILTER (WHERE ${leadEvents.kind} = 'page_view')::int * 1
      )::int`,
    })
    .from(leadEvents)
    .innerJoin(leads, eq(leads.id, leadEvents.leadId))
    .innerJoin(runs, eq(runs.id, leads.runId))
    .innerJoin(campaigns, eq(campaigns.id, runs.campaignId))
    .where(and(...baseConds))
    .groupBy(leads.id, leads.data, campaigns.id, campaigns.name, runs.id, runs.name)
    // Postgres erkennt SELECT-Aliase wie `score` in ORDER BY nicht zuverlässig
    // wenn der Alias ein Composite-Ausdruck ist — also den vollen Ausdruck
    // hier wiederholen.
    .orderBy(
      sql`(
        COUNT(*) FILTER (WHERE ${leadEvents.kind} = 'cta_click')::int * 100
        + COUNT(*) FILTER (WHERE ${leadEvents.kind} = 'video_play')::int * 10
        + COUNT(*) FILTER (WHERE ${leadEvents.kind} = 'page_view')::int * 1
      ) DESC, MAX(${leadEvents.ts}) DESC`,
    )
    .limit(limit);

  return rows.map((r) => {
    const d = (r.data ?? {}) as Record<string, string>;
    const first = d.firstName ?? d.Vorname ?? d.first_name ?? "";
    const last = d.lastName ?? d.Nachname ?? d.last_name ?? "";
    const name =
      [first, last].filter(Boolean).join(" ").trim() ||
      d.fullName ||
      d.Name ||
      d.companyName ||
      d.company ||
      d.Firma ||
      "(unbenannt)";
    const company = d.companyName ?? d.company ?? d.Firma ?? "";
    let temperature: "engaged" | "hot" | "warm" | "cold" = "cold";
    if (r.ctaClicks > 0) temperature = "engaged";
    else if ((r.maxProgressPct ?? 0) >= 75) temperature = "hot";
    else if (r.videoPlays > 0 && (r.maxProgressPct ?? 0) >= 25) temperature = "warm";
    return {
      id: r.leadId,
      name,
      company,
      campaignId: r.campaignId,
      campaignName: r.campaignName,
      runId: r.runId,
      runName: r.runName,
      pageViews: r.pageViews ?? 0,
      videoPlays: r.videoPlays ?? 0,
      ctaClicks: r.ctaClicks ?? 0,
      watchTimeSec: r.watchTimeSec ?? 0,
      lastEventTs: r.lastEventTs ?? null,
      lastKind: r.lastKind ?? null,
      temperature,
    };
  });
}

// ── Campaign-Detail: per-run table (window-scoped events) ──────────────────

export interface RunPerf {
  id: string;
  name: string;
  status: string;
  startedAt: Date | null;
  createdAt: Date;
  leadsCount: number;
  pageViews: number;
  videoPlays: number;
  ctaClicks: number;
  ctrPct: number;
}

export async function listRunsForCampaign(
  userId: string,
  campaignId: string,
  range: AnalyticsRange,
): Promise<RunPerf[]> {
  // First check that the campaign belongs to the caller.
  const [c] = await db
    .select({ id: campaigns.id })
    .from(campaigns)
    .where(and(eq(campaigns.id, campaignId), eq(campaigns.userId, userId)))
    .limit(1);
  if (!c) return [];

  const runRows = await db
    .select({
      id: runs.id,
      name: runs.name,
      status: runs.status,
      startedAt: runs.startedAt,
      createdAt: runs.createdAt,
      leadsCount: sql<number>`COUNT(${leads.id})::int`,
    })
    .from(runs)
    .leftJoin(leads, and(eq(leads.runId, runs.id), isNull(leads.removedAt)))
    .where(and(eq(runs.campaignId, campaignId), eq(runs.userId, userId)))
    .groupBy(runs.id)
    .orderBy(desc(runs.createdAt));

  if (runRows.length === 0) return [];
  const runIds = runRows.map((r) => r.id);

  const evRows = await db
    .select({
      runId: leads.runId,
      pageViews: sql<number>`COUNT(*) FILTER (WHERE ${leadEvents.kind} = 'page_view')::int`,
      videoPlays: sql<number>`COUNT(*) FILTER (WHERE ${leadEvents.kind} = 'video_play')::int`,
      ctaClicks: sql<number>`COUNT(*) FILTER (WHERE ${leadEvents.kind} = 'cta_click')::int`,
    })
    .from(leadEvents)
    .innerJoin(leads, eq(leads.id, leadEvents.leadId))
    .where(
      and(
        inArray(leads.runId, runIds),
        isNull(leads.removedAt),
        gte(leadEvents.ts, range.from),
        lt(leadEvents.ts, range.to),
      ),
    )
    .groupBy(leads.runId);
  const evByRun = new Map(evRows.map((r) => [r.runId, r]));

  return runRows.map((r) => {
    const ev = evByRun.get(r.id);
    const pv = ev?.pageViews ?? 0;
    const cta = ev?.ctaClicks ?? 0;
    return {
      id: r.id,
      name: r.name,
      status: r.status,
      startedAt: r.startedAt,
      createdAt: r.createdAt,
      leadsCount: r.leadsCount ?? 0,
      pageViews: pv,
      videoPlays: ev?.videoPlays ?? 0,
      ctaClicks: cta,
      ctrPct: pv > 0 ? (cta / pv) * 100 : 0,
    };
  });
}

// ── Suppress unused-import warning if helper-only export gets removed.
void lte;
