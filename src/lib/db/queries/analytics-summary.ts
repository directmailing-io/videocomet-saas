/**
 * Analytics-Summary Queries
 *
 * Tenant-scoped aggregation helpers that power the top-level Analytics area
 * (Overview, Per-Kampagne, Event-Log). All queries take a `userId` and JOIN
 * through `runs -> campaigns` so a caller can only ever read events that
 * belong to their own runs.
 *
 * Design notes:
 *  - Per-campaign aggregates read from the denormalized columns on `leads`
 *    (viewCount, playCount, watchTimeSec, ctaClickCount) — populated by the
 *    public `/api/track/event` endpoint inline with every event insert.
 *    This avoids a per-lead sub-query against `lead_events` for the most
 *    common dashboard reads.
 *  - Time-series queries (daily counts, 30-day series) go through `lead_events`
 *    directly because the leads-table aggregates do not carry per-day buckets.
 *  - Event-log uses one filterable list query against `lead_events` with
 *    INNER JOINs onto leads/runs/campaigns for the lookup columns the UI
 *    renders. Returns `total` separately for pagination.
 */

import { and, asc, desc, eq, gte, inArray, isNull, lte, sql, ilike, or } from "drizzle-orm";
import { db } from "@/lib/db";
import { campaigns, leadEvents, leads, runs } from "@/lib/db/schema";

// ── Types ───────────────────────────────────────────────────────────────────

export interface CampaignAggregate {
  id: string;
  name: string;
  createdAt: Date;
  runsCount: number;
  leadsCount: number;
  viewCount: number;
  playCount: number;
  ctaClickCount: number;
  watchTimeSec: number;
  /** Last 14 days of per-day event counts. Length is always 14 (oldest first),
   *  with zeros for days that had no events. */
  dailyCounts: DailyEventCount[];
}

export interface DailyEventCount {
  /** ISO date (YYYY-MM-DD) at UTC */
  date: string;
  views: number;
  plays: number;
  ctas: number;
}

export interface CampaignDeepDive {
  campaign: { id: string; name: string; createdAt: Date };
  summary: {
    viewCount: number;
    playCount: number;
    ctaClickCount: number;
    watchTimeSec: number;
    leadsCount: number;
  };
  /** Last `days` of per-day events. Length always equals `days` (oldest first). */
  timeSeries: DailyEventCount[];
  runs: Array<{
    id: string;
    name: string;
    startedAt: Date | null;
    createdAt: Date;
    status: string;
    leadsCount: number;
    viewCount: number;
    playCount: number;
    ctaClickCount: number;
  }>;
  topLeads: Array<{
    id: string;
    firstName: string;
    lastName: string;
    companyName: string;
    watchTimeSec: number;
    viewCount: number;
    ctaClickCount: number;
  }>;
}

export interface EventListFilters {
  userId: string;
  kinds?: string[];
  campaignId?: string;
  /** Inclusive lower bound (UTC). */
  from?: Date;
  /** Exclusive upper bound (UTC). */
  to?: Date;
  /** Free-text match against lead first/last name. */
  q?: string;
  limit: number;
  offset: number;
}

export interface EventListItem {
  id: string;
  ts: Date;
  kind: string;
  payload: unknown;
  leadId: string;
  leadName: string;
  companyName: string;
  campaignId: string;
  campaignName: string;
  runId: string;
}

export interface EventListResult {
  events: EventListItem[];
  total: number;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Read the company name from a lead's `data` jsonb column. Leads come from
 * arbitrary CSV/Google-Sheets imports, so the column name varies. Mirrors the
 * fallback chain used in `lead-detail-modal.tsx`.
 */
function pickCompanyName(data: Record<string, string> | null | undefined): string {
  if (!data) return "";
  return (
    data.companyName ||
    data.company ||
    data.Firma ||
    data.firma ||
    data.Unternehmen ||
    ""
  );
}

function pickFirstName(data: Record<string, string> | null | undefined): string {
  if (!data) return "";
  return (
    data.firstName ||
    data.Vorname ||
    data.first_name ||
    data.first ||
    ""
  );
}

function pickLastName(data: Record<string, string> | null | undefined): string {
  if (!data) return "";
  return (
    data.lastName ||
    data.Nachname ||
    data.last_name ||
    data.last ||
    ""
  );
}

/** Build an array of `days` consecutive ISO dates ending today (UTC). */
function buildDateRange(days: number): string[] {
  const out: string[] = [];
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setUTCDate(today.getUTCDate() - i);
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

/** Fill missing days with zeros so the chart always renders `days` buckets. */
function zerofillDaily(
  rows: Array<{ date: string; kind: string; count: number }>,
  days: number,
): DailyEventCount[] {
  const range = buildDateRange(days);
  const map = new Map<string, DailyEventCount>();
  for (const date of range) {
    map.set(date, { date, views: 0, plays: 0, ctas: 0 });
  }
  for (const r of rows) {
    const entry = map.get(r.date);
    if (!entry) continue; // out of range (defensive)
    if (r.kind === "page_view") entry.views += r.count;
    else if (r.kind === "video_play") entry.plays += r.count;
    else if (r.kind === "cta_click") entry.ctas += r.count;
  }
  return range.map((d) => map.get(d)!);
}

// ── Queries ─────────────────────────────────────────────────────────────────

/**
 * One row per campaign owned by `userId`, with denormalized lead-aggregates
 * summed across the campaign and the last 14d of per-day event counts.
 *
 * Implementation: three independent grouped queries (campaign-meta + lead-sums
 * + per-day events), stitched in JS. Avoids a six-way JOIN with mixed
 * granularities that postgres would fan out badly.
 */
export async function listCampaignAggregates(
  userId: string,
): Promise<CampaignAggregate[]> {
  // 1) Campaigns owned by user.
  const camps = await db
    .select({
      id: campaigns.id,
      name: campaigns.name,
      createdAt: campaigns.createdAt,
    })
    .from(campaigns)
    .where(and(eq(campaigns.userId, userId), isNull(campaigns.deletedAt)))
    .orderBy(desc(campaigns.createdAt));

  if (camps.length === 0) return [];
  const campIds = camps.map((c) => c.id);

  // 2) Runs-count per campaign.
  const runsRows = await db
    .select({
      campaignId: runs.campaignId,
      runsCount: sql<number>`count(*)::int`,
    })
    .from(runs)
    .where(and(eq(runs.userId, userId), inArray(runs.campaignId, campIds)))
    .groupBy(runs.campaignId);
  const runsByCampaign = new Map(
    runsRows.map((r) => [r.campaignId, r.runsCount ?? 0]),
  );

  // 3) Lead aggregates per campaign (denormalized columns).
  const leadAggRows = await db
    .select({
      campaignId: runs.campaignId,
      leadsCount: sql<number>`count(${leads.id})::int`,
      viewCount: sql<number>`coalesce(sum(${leads.viewCount}), 0)::int`,
      playCount: sql<number>`coalesce(sum(${leads.playCount}), 0)::int`,
      ctaClickCount: sql<number>`coalesce(sum(${leads.ctaClickCount}), 0)::int`,
      watchTimeSec: sql<number>`coalesce(sum(${leads.watchTimeSec}), 0)::int`,
    })
    .from(leads)
    .innerJoin(runs, eq(runs.id, leads.runId))
    .where(and(eq(runs.userId, userId), inArray(runs.campaignId, campIds)))
    .groupBy(runs.campaignId);
  const aggByCampaign = new Map(leadAggRows.map((r) => [r.campaignId, r]));

  // 4) Per-day event counts (last 14d). One query, grouped by
  //    (campaignId, day, kind). 14d * N campaigns * 3 kinds = small result.
  const since = new Date();
  since.setUTCHours(0, 0, 0, 0);
  since.setUTCDate(since.getUTCDate() - 13); // include today => 14 buckets

  const dailyRows = await db
    .select({
      campaignId: runs.campaignId,
      day: sql<string>`to_char((${leadEvents.ts} at time zone 'UTC')::date, 'YYYY-MM-DD')`,
      kind: leadEvents.kind,
      count: sql<number>`count(*)::int`,
    })
    .from(leadEvents)
    .innerJoin(leads, eq(leads.id, leadEvents.leadId))
    .innerJoin(runs, eq(runs.id, leads.runId))
    .where(
      and(
        eq(runs.userId, userId),
        inArray(runs.campaignId, campIds),
        gte(leadEvents.ts, since),
        sql`${leadEvents.kind} IN ('page_view','video_play','cta_click')`,
      ),
    )
    .groupBy(
      runs.campaignId,
      sql`(${leadEvents.ts} at time zone 'UTC')::date`,
      leadEvents.kind,
    );

  const dailyByCampaign = new Map<
    string,
    Array<{ date: string; kind: string; count: number }>
  >();
  for (const r of dailyRows) {
    const arr = dailyByCampaign.get(r.campaignId) ?? [];
    arr.push({ date: r.day, kind: r.kind, count: r.count ?? 0 });
    dailyByCampaign.set(r.campaignId, arr);
  }

  return camps.map((c) => {
    const agg = aggByCampaign.get(c.id);
    const daily = dailyByCampaign.get(c.id) ?? [];
    return {
      id: c.id,
      name: c.name,
      createdAt: c.createdAt,
      runsCount: runsByCampaign.get(c.id) ?? 0,
      leadsCount: agg?.leadsCount ?? 0,
      viewCount: agg?.viewCount ?? 0,
      playCount: agg?.playCount ?? 0,
      ctaClickCount: agg?.ctaClickCount ?? 0,
      watchTimeSec: agg?.watchTimeSec ?? 0,
      dailyCounts: zerofillDaily(daily, 14),
    };
  });
}

/**
 * Single-campaign deep-dive: aggregates, 30-day time-series, runs table, top
 * 5 leads by watch-time. Tenant-guarded via `userId`.
 *
 * Throws "Not found" if the campaign does not exist or is not owned by user.
 */
export async function getCampaignDeepDive(
  campaignId: string,
  userId: string,
  days = 30,
): Promise<CampaignDeepDive> {
  const [camp] = await db
    .select({
      id: campaigns.id,
      name: campaigns.name,
      createdAt: campaigns.createdAt,
    })
    .from(campaigns)
    .where(
      and(
        eq(campaigns.id, campaignId),
        eq(campaigns.userId, userId),
        isNull(campaigns.deletedAt),
      ),
    )
    .limit(1);
  if (!camp) throw new Error("Not found");

  // Lead summary.
  const [leadSum] = await db
    .select({
      leadsCount: sql<number>`count(${leads.id})::int`,
      viewCount: sql<number>`coalesce(sum(${leads.viewCount}), 0)::int`,
      playCount: sql<number>`coalesce(sum(${leads.playCount}), 0)::int`,
      ctaClickCount: sql<number>`coalesce(sum(${leads.ctaClickCount}), 0)::int`,
      watchTimeSec: sql<number>`coalesce(sum(${leads.watchTimeSec}), 0)::int`,
    })
    .from(leads)
    .innerJoin(runs, eq(runs.id, leads.runId))
    .where(and(eq(runs.campaignId, camp.id), eq(runs.userId, userId)));

  // Time-series.
  const since = new Date();
  since.setUTCHours(0, 0, 0, 0);
  since.setUTCDate(since.getUTCDate() - (days - 1));

  const dailyRows = await db
    .select({
      day: sql<string>`to_char((${leadEvents.ts} at time zone 'UTC')::date, 'YYYY-MM-DD')`,
      kind: leadEvents.kind,
      count: sql<number>`count(*)::int`,
    })
    .from(leadEvents)
    .innerJoin(leads, eq(leads.id, leadEvents.leadId))
    .innerJoin(runs, eq(runs.id, leads.runId))
    .where(
      and(
        eq(runs.campaignId, camp.id),
        eq(runs.userId, userId),
        gte(leadEvents.ts, since),
        sql`${leadEvents.kind} IN ('page_view','video_play','cta_click')`,
      ),
    )
    .groupBy(
      sql`(${leadEvents.ts} at time zone 'UTC')::date`,
      leadEvents.kind,
    );

  const timeSeries = zerofillDaily(
    dailyRows.map((r) => ({
      date: r.day,
      kind: r.kind,
      count: r.count ?? 0,
    })),
    days,
  );

  // Runs table — per-run lead aggregates from denormalized columns.
  const runRows = await db
    .select({
      id: runs.id,
      name: runs.name,
      startedAt: runs.startedAt,
      createdAt: runs.createdAt,
      status: runs.status,
      leadsCount: sql<number>`count(${leads.id})::int`,
      viewCount: sql<number>`coalesce(sum(${leads.viewCount}), 0)::int`,
      playCount: sql<number>`coalesce(sum(${leads.playCount}), 0)::int`,
      ctaClickCount: sql<number>`coalesce(sum(${leads.ctaClickCount}), 0)::int`,
    })
    .from(runs)
    .leftJoin(leads, eq(leads.runId, runs.id))
    .where(and(eq(runs.campaignId, camp.id), eq(runs.userId, userId)))
    .groupBy(runs.id)
    .orderBy(desc(runs.createdAt));

  // Top 5 leads by watch-time.
  const topLeadRows = await db
    .select({
      id: leads.id,
      data: leads.data,
      watchTimeSec: leads.watchTimeSec,
      watchPct: leads.watchPct,
      viewCount: leads.viewCount,
      ctaClickCount: leads.ctaClickCount,
    })
    .from(leads)
    .innerJoin(runs, eq(runs.id, leads.runId))
    .where(and(eq(runs.campaignId, camp.id), eq(runs.userId, userId)))
    .orderBy(desc(leads.watchTimeSec))
    .limit(5);

  return {
    campaign: { id: camp.id, name: camp.name, createdAt: camp.createdAt },
    summary: {
      leadsCount: leadSum?.leadsCount ?? 0,
      viewCount: leadSum?.viewCount ?? 0,
      playCount: leadSum?.playCount ?? 0,
      ctaClickCount: leadSum?.ctaClickCount ?? 0,
      watchTimeSec: leadSum?.watchTimeSec ?? 0,
    },
    timeSeries,
    runs: runRows.map((r) => ({
      id: r.id,
      name: r.name,
      startedAt: r.startedAt,
      createdAt: r.createdAt,
      status: r.status,
      leadsCount: r.leadsCount ?? 0,
      viewCount: r.viewCount ?? 0,
      playCount: r.playCount ?? 0,
      ctaClickCount: r.ctaClickCount ?? 0,
    })),
    topLeads: topLeadRows
      .filter((l) => (l.watchTimeSec ?? 0) > 0)
      .map((l) => ({
        id: l.id,
        firstName: pickFirstName(l.data),
        lastName: pickLastName(l.data),
        companyName: pickCompanyName(l.data),
        watchTimeSec: l.watchTimeSec ?? 0,
        viewCount: l.viewCount ?? 0,
        ctaClickCount: l.ctaClickCount ?? 0,
      })),
  };
}

/**
 * Filterable event list. The total count uses the same WHERE clause without
 * pagination so the UI can render "X von Y" reliably.
 */
export async function listAnalyticsEvents(
  filters: EventListFilters,
): Promise<EventListResult> {
  const conds = [eq(runs.userId, filters.userId), isNull(campaigns.deletedAt)];
  if (filters.kinds && filters.kinds.length > 0) {
    conds.push(inArray(leadEvents.kind, filters.kinds));
  }
  if (filters.campaignId) {
    conds.push(eq(runs.campaignId, filters.campaignId));
  }
  if (filters.from) {
    conds.push(gte(leadEvents.ts, filters.from));
  }
  if (filters.to) {
    conds.push(lte(leadEvents.ts, filters.to));
  }
  if (filters.q && filters.q.trim()) {
    const needle = `%${filters.q.trim()}%`;
    // Match against first/last name keys we know about. The data column is
    // jsonb and not indexed for ilike, so this is a sequential scan — fine
    // for the 200-row window we render.
    const match = or(
      ilike(sql`${leads.data} ->> 'firstName'`, needle),
      ilike(sql`${leads.data} ->> 'lastName'`, needle),
      ilike(sql`${leads.data} ->> 'Vorname'`, needle),
      ilike(sql`${leads.data} ->> 'Nachname'`, needle),
      ilike(sql`${leads.data} ->> 'companyName'`, needle),
      ilike(sql`${leads.data} ->> 'Firma'`, needle),
    );
    if (match) conds.push(match);
  }

  const where = and(...conds);

  const rows = await db
    .select({
      id: leadEvents.id,
      ts: leadEvents.ts,
      kind: leadEvents.kind,
      payload: leadEvents.payload,
      leadId: leadEvents.leadId,
      data: leads.data,
      campaignId: runs.campaignId,
      campaignName: campaigns.name,
      runId: runs.id,
    })
    .from(leadEvents)
    .innerJoin(leads, eq(leads.id, leadEvents.leadId))
    .innerJoin(runs, eq(runs.id, leads.runId))
    .innerJoin(campaigns, eq(campaigns.id, runs.campaignId))
    .where(where)
    .orderBy(desc(leadEvents.ts))
    .limit(filters.limit)
    .offset(filters.offset);

  const [totalRow] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(leadEvents)
    .innerJoin(leads, eq(leads.id, leadEvents.leadId))
    .innerJoin(runs, eq(runs.id, leads.runId))
    .innerJoin(campaigns, eq(campaigns.id, runs.campaignId))
    .where(where);

  const events: EventListItem[] = rows.map((r) => {
    const first = pickFirstName(r.data);
    const last = pickLastName(r.data);
    const composed = [first, last].filter(Boolean).join(" ").trim();
    return {
      id: r.id,
      ts: r.ts,
      kind: r.kind,
      payload: r.payload,
      leadId: r.leadId,
      leadName: composed || "(unbenannt)",
      companyName: pickCompanyName(r.data),
      campaignId: r.campaignId,
      campaignName: r.campaignName,
      runId: r.runId,
    };
  });

  return { events, total: totalRow?.total ?? 0 };
}

// ── Flat-Lead-Liste für das Kampagnen-Dashboard ─────────────────────────────

export interface CampaignLeadRow {
  id: string;
  rowIndex: number;
  runId: string;
  runName: string;
  runCreatedAt: Date | null;
  data: Record<string, string>;
  slug: string | null;
  status: string;
  videoUrl: string | null;
  pdfUrl: string | null;
  thumbnailUrl: string | null;
  viewCount: number;
  firstViewedAt: Date | null;
  lastViewedAt: Date | null;
  playCount: number;
  watchTimeSec: number;
  /** Einmalig gesehener Anteil der Zeitleiste, 0–100. */
  watchPct: number;
  ctaClickCount: number;
  lastCtaAt: Date | null;
  errorMessage: string | null;
  abVariant: "A" | "B" | null;
  createdAt: Date;
}

/**
 * Alle Leads einer Kampagne über sämtliche Runden flach gelistet, sortiert
 * nach neuster Runde + Lead-Reihenfolge. Joint nur die Run-Tabelle für den
 * Run-Namen — Aggregate kommen aus den denormalisierten Lead-Spalten.
 */
export async function listAllCampaignLeads(
  campaignId: string,
  userId: string,
): Promise<CampaignLeadRow[]> {
  const rows = await db
    .select({
      id: leads.id,
      rowIndex: leads.rowIndex,
      runId: leads.runId,
      runName: runs.name,
      runCreatedAt: runs.createdAt,
      data: leads.data,
      slug: leads.slug,
      status: leads.status,
      videoUrl: leads.videoUrl,
      pdfUrl: leads.pdfUrl,
      thumbnailUrl: leads.thumbnailUrl,
      viewCount: leads.viewCount,
      firstViewedAt: leads.firstViewedAt,
      lastViewedAt: leads.lastViewedAt,
      playCount: leads.playCount,
      watchTimeSec: leads.watchTimeSec,
      watchPct: leads.watchPct,
      ctaClickCount: leads.ctaClickCount,
      lastCtaAt: leads.lastCtaAt,
      errorMessage: leads.errorMessage,
      abVariant: leads.abVariant,
      createdAt: leads.createdAt,
    })
    .from(leads)
    .innerJoin(runs, eq(runs.id, leads.runId))
    .innerJoin(campaigns, eq(campaigns.id, runs.campaignId))
    .where(
      and(
        eq(runs.campaignId, campaignId),
        eq(runs.userId, userId),
        isNull(campaigns.deletedAt),
      ),
    )
    .orderBy(desc(runs.createdAt), asc(leads.rowIndex));
  return rows.map((r) => ({
    ...r,
    data: (r.data ?? {}) as Record<string, string>,
    viewCount: r.viewCount ?? 0,
    playCount: r.playCount ?? 0,
    watchTimeSec: r.watchTimeSec ?? 0,
    ctaClickCount: r.ctaClickCount ?? 0,
  }));
}

/** Lightweight campaign list (id + name) for the Event-Log filter dropdown. */
export async function listCampaignsForFilter(
  userId: string,
): Promise<Array<{ id: string; name: string }>> {
  return db
    .select({ id: campaigns.id, name: campaigns.name })
    .from(campaigns)
    .where(and(eq(campaigns.userId, userId), isNull(campaigns.deletedAt)))
    .orderBy(asc(campaigns.name));
}
