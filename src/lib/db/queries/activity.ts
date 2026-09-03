/**
 * Activity-Center Query Layer.
 *
 * Three public read functions:
 *   - getActivityFeed   keyset-paginated event feed across scopes
 *   - getActivityCounts aggregate counters over the same set
 *   - getFunnel         4-step lead funnel (view → play → 75 % → cta_click)
 *
 * Design notes:
 *   - All queries are tenant-guarded through `campaigns.userId`. We always
 *     join `leads → runs → campaigns` so the guard is enforced at the SQL
 *     level — no leaking lead-event rows from a foreign tenant.
 *   - Keyset-pagination only (no OFFSET). Cursor encodes `(ts, eventId)`.
 *   - Aggregates use `FILTER (WHERE …)` clauses so we count everything in
 *     one round-trip.
 *   - We DON'T fetch event-history-per-lead for the feed temperature; we
 *     classify from the denormalised counters on `leads` for O(1) per row.
 *     The exact classification (with sessions + cta_hover) lives in
 *     `getLeadsForExport` because it can afford the extra GROUP BY.
 *
 * Index expectations (see Report):
 *   - `lead_events_lead_ts_idx (lead_id, ts)`         — exists
 *   - `lead_events_lead_kind_idx (lead_id, kind)`     — exists
 *   - `lead_events (ts DESC, id DESC)`                — MISSING for global
 *      feed; recommended for sub-200ms feed at 100k+ events.
 *   - `leads_run_idx (run_id)`, `runs_campaign_idx`, `campaigns_user_idx`  — exist
 */

import { and, eq, inArray, sql, type SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import { campaigns, leadEvents, leads, runs } from "@/lib/db/schema";
import { classifyLeadFromAggregates } from "@/lib/activity/classify";
import {
  LEAD_TEMPERATURES,
  type ActivityCounts,
  type ActivityFeedRow,
  type ActivityFilters,
  type ActivityScope,
  type FunnelResult,
  type FunnelStep,
  type LeadTemperature,
} from "@/lib/activity/types";

// ── Constants ───────────────────────────────────────────────────────────────

const FEED_LIMIT_DEFAULT = 50;
const FEED_LIMIT_MAX = 200;
const VIDEO_75_THRESHOLD = 75;

// ── Cursor ──────────────────────────────────────────────────────────────────

interface ActivityCursor {
  ts: string; // ISO
  eventId: string;
}

export function encodeCursor(c: ActivityCursor): string {
  return Buffer.from(`${c.ts}:${c.eventId}`, "utf8").toString("base64url");
}

export function decodeCursor(raw: string): ActivityCursor | null {
  try {
    const decoded = Buffer.from(raw, "base64url").toString("utf8");
    // Cursor format: `<ISO-with-Z>:<uuid>`. We split on the LAST colon
    // because the ISO timestamp contains its own colons.
    const idx = decoded.lastIndexOf(":");
    if (idx <= 0) return null;
    const ts = decoded.slice(0, idx);
    const eventId = decoded.slice(idx + 1);
    if (!ts || !eventId) return null;
    return { ts, eventId };
  } catch {
    return null;
  }
}

// ── Shared filter SQL ──────────────────────────────────────────────────────

/**
 * Compose the WHERE-clauses common to all three queries. Always includes the
 * tenant-guard on campaigns.userId. Returns a list of SQL fragments the
 * caller AND-combines via `and(...)`.
 */
function buildBaseFilters(
  userId: string,
  filters: ActivityFilters,
): SQL[] {
  const parts: SQL[] = [];
  parts.push(sql`${campaigns.userId} = ${userId}`);
  parts.push(sql`${campaigns.deletedAt} IS NULL`);
  parts.push(sql`${leads.removedAt} IS NULL`);

  const scope = filters.scope;
  switch (scope.kind) {
    case "campaign":
      parts.push(sql`${campaigns.id} = ${scope.campaignId}`);
      break;
    case "run":
      parts.push(sql`${runs.id} = ${scope.runId}`);
      break;
    case "lead":
      parts.push(sql`${leads.id} = ${scope.leadId}`);
      break;
    case "global":
    default:
      break;
  }

  if (filters.campaignIds && filters.campaignIds.length > 0) {
    parts.push(inArray(campaigns.id, filters.campaignIds));
  }
  if (filters.runIds && filters.runIds.length > 0) {
    parts.push(inArray(runs.id, filters.runIds));
  }
  if (filters.from) {
    // postgres.js akzeptiert keine Date-Instanzen in raw-SQL — explizit
    // auf ISO-String casten (gleicher Workaround wie im Preflight-Recovery).
    parts.push(sql`${leadEvents.ts} >= ${filters.from.toISOString()}`);
  }
  if (filters.to) {
    parts.push(sql`${leadEvents.ts} <= ${filters.to.toISOString()}`);
  }
  if (filters.kinds && filters.kinds.length > 0) {
    parts.push(inArray(leadEvents.kind, filters.kinds));
  }
  if (filters.search && filters.search.trim().length > 0) {
    const term = `%${filters.search.trim().toLowerCase()}%`;
    parts.push(sql`(
      LOWER(COALESCE(${leads.slug}, '')) LIKE ${term}
      OR LOWER(COALESCE(${leads.data}::text, '')) LIKE ${term}
    )`);
  }

  return parts;
}

// ── Lead name extraction (pure, SQL-side) ──────────────────────────────────

/**
 * SQL expression that flattens the JSONB `leads.data` into a display name —
 * tries `firstName`/`Vorname` + `lastName`/`Nachname`, then `fullName`/`Name`,
 * then `companyName`, then the slug, then "Lead #<rowIndex>". Used as the
 * `lead.name` column in the feed result.
 */
const LEAD_NAME_SQL = sql<string>`
  TRIM(BOTH ' ' FROM
    COALESCE(
      NULLIF(
        TRIM(
          COALESCE(${leads.data} ->> 'firstName', ${leads.data} ->> 'Vorname', '')
          || ' '
          || COALESCE(${leads.data} ->> 'lastName', ${leads.data} ->> 'Nachname', '')
        ),
        ''
      ),
      ${leads.data} ->> 'fullName',
      ${leads.data} ->> 'Name',
      ${leads.data} ->> 'companyName',
      ${leads.data} ->> 'company',
      ${leads.data} ->> 'Firma',
      ${leads.slug},
      -- Defensive Fallback: rowIndex koennte in alten Daten NULL sein.
      -- "Lead # || NULL" waere NULL und die ganze COALESCE-Chain
      -- liefert NULL. Client rendert row.lead.name als undefined und
      -- crashed mit "Hoppla...". Mit COALESCE(rowIndex::text, ?)
      -- bleibt der String immer gueltig.
      'Lead #' || COALESCE(${leads.rowIndex}::text, '?')
    )
  )
`;

const LEAD_COMPANY_SQL = sql<string | null>`
  COALESCE(
    NULLIF(${leads.data} ->> 'companyName', ''),
    NULLIF(${leads.data} ->> 'company', ''),
    NULLIF(${leads.data} ->> 'Firma', '')
  )
`;

// ── getActivityFeed ─────────────────────────────────────────────────────────

interface FeedSqlRow {
  eventId: string;
  ts: Date;
  kind: string;
  payload: Record<string, unknown> | null;
  sessionId: string | null;
  leadId: string;
  leadName: string;
  leadCompany: string | null;
  leadSlug: string | null;
  leadViewCount: number;
  leadPlayCount: number;
  leadWatchTimeSec: number;
  leadCtaClickCount: number;
  runId: string;
  runName: string;
  campaignId: string;
  campaignName: string;
}

export async function getActivityFeed(
  userId: string,
  filters: ActivityFilters,
): Promise<{ rows: ActivityFeedRow[]; nextCursor: string | null }> {
  const limit = Math.min(
    Math.max(1, filters.limit ?? FEED_LIMIT_DEFAULT),
    FEED_LIMIT_MAX,
  );

  const whereParts = buildBaseFilters(userId, filters);

  if (filters.cursor) {
    const cur = decodeCursor(filters.cursor);
    if (cur) {
      // Keyset condition: (ts, eventId) strictly LESS than the cursor.
      // ISO-String statt Date — siehe buildBaseFilters-Workaround oben.
      whereParts.push(sql`(
        ${leadEvents.ts} < ${cur.ts}
        OR (${leadEvents.ts} = ${cur.ts} AND ${leadEvents.id} < ${cur.eventId})
      )`);
    }
  }

  // Fetch limit+1 so we can compute hasNext without a second roundtrip.
  const sqlRows = (await db
    .select({
      eventId: leadEvents.id,
      ts: leadEvents.ts,
      kind: leadEvents.kind,
      payload: leadEvents.payload,
      sessionId: leadEvents.sessionId,
      leadId: leads.id,
      leadName: LEAD_NAME_SQL.as("lead_name"),
      leadCompany: LEAD_COMPANY_SQL.as("lead_company"),
      leadSlug: leads.slug,
      leadViewCount: leads.viewCount,
      leadPlayCount: leads.playCount,
      leadWatchTimeSec: leads.watchTimeSec,
      leadCtaClickCount: leads.ctaClickCount,
      runId: runs.id,
      runName: runs.name,
      campaignId: campaigns.id,
      campaignName: campaigns.name,
    })
    .from(leadEvents)
    .innerJoin(leads, eq(leads.id, leadEvents.leadId))
    .innerJoin(runs, eq(runs.id, leads.runId))
    .innerJoin(campaigns, eq(campaigns.id, runs.campaignId))
    .where(and(...whereParts))
    .orderBy(sql`${leadEvents.ts} DESC, ${leadEvents.id} DESC`)
    .limit(limit + 1)) as unknown as FeedSqlRow[];

  const hasNext = sqlRows.length > limit;
  const pageRows = hasNext ? sqlRows.slice(0, limit) : sqlRows;

  // Filter on temperature in JS — the classification depends on aggregates
  // we already pulled, so this stays O(N) over the page.
  const filteredRows = pageRows.filter((r) => {
    if (!filters.temperature || filters.temperature.length === 0) return true;
    const t = classifyLeadFromAggregates({
      pageViewCount: r.leadViewCount ?? 0,
      playCount: r.leadPlayCount ?? 0,
      watchTimeSec: r.leadWatchTimeSec ?? 0,
      ctaClickCount: r.leadCtaClickCount ?? 0,
    });
    return filters.temperature.includes(t);
  });

  const rows: ActivityFeedRow[] = filteredRows.map((r) => ({
    eventId: r.eventId,
    ts: r.ts.toISOString(),
    kind: r.kind,
    payload: r.payload,
    sessionId: r.sessionId,
    lead: {
      id: r.leadId,
      name: r.leadName,
      companyName: r.leadCompany,
      slug: r.leadSlug,
      temperature: classifyLeadFromAggregates({
        pageViewCount: r.leadViewCount ?? 0,
        playCount: r.leadPlayCount ?? 0,
        watchTimeSec: r.leadWatchTimeSec ?? 0,
        ctaClickCount: r.leadCtaClickCount ?? 0,
      }),
    },
    run: { id: r.runId, name: r.runName },
    campaign: { id: r.campaignId, name: r.campaignName },
  }));

  const nextCursor =
    hasNext && pageRows.length > 0
      ? encodeCursor({
          ts: pageRows[pageRows.length - 1].ts.toISOString(),
          eventId: pageRows[pageRows.length - 1].eventId,
        })
      : null;

  return { rows, nextCursor };
}

// ── getActivityCounts ───────────────────────────────────────────────────────

interface CountSqlRow {
  total: number;
  uniqueLeads: number;
  uniqueSessions: number;
  // byKind comes back as a JSON object built server-side.
  byKindJson: Record<string, number> | null;
}

export async function getActivityCounts(
  userId: string,
  filters: ActivityFilters,
): Promise<ActivityCounts> {
  const whereParts = buildBaseFilters(userId, filters);

  // Single aggregate query — total / unique-leads / unique-sessions and a
  // JSONB rollup of (kind → count) all in one pass.
  const [row] = (await db
    .select({
      total: sql<number>`COUNT(*)::int`,
      uniqueLeads: sql<number>`COUNT(DISTINCT ${leads.id})::int`,
      uniqueSessions: sql<number>`COUNT(DISTINCT ${leadEvents.sessionId})::int`,
      byKindJson: sql<Record<string, number> | null>`(
        SELECT COALESCE(jsonb_object_agg(k, c), '{}'::jsonb)
        FROM (
          SELECT ${leadEvents.kind} AS k,
            CASE
              -- Fortschritts-Ticks (alle 5 s) nicht als Einzel-Events zaehlen,
              -- sondern als Ansehen-Sitzungen (ein Eintrag je Sitzung).
              WHEN ${leadEvents.kind} IN ('video_progress', 'video_ended')
                THEN COUNT(DISTINCT COALESCE(${leadEvents.sessionId}, ${leadEvents.id}::text))::int
              ELSE COUNT(*)::int
            END AS c
          FROM ${leadEvents}
          INNER JOIN ${leads} ON ${leads.id} = ${leadEvents.leadId}
          INNER JOIN ${runs} ON ${runs.id} = ${leads.runId}
          INNER JOIN ${campaigns} ON ${campaigns.id} = ${runs.campaignId}
          WHERE ${and(...whereParts)}
          GROUP BY ${leadEvents.kind}
        ) per_kind
      )`,
    })
    .from(leadEvents)
    .innerJoin(leads, eq(leads.id, leadEvents.leadId))
    .innerJoin(runs, eq(runs.id, leads.runId))
    .innerJoin(campaigns, eq(campaigns.id, runs.campaignId))
    .where(and(...whereParts))) as unknown as CountSqlRow[];

  const byKind: Record<string, number> = {};
  if (row?.byKindJson && typeof row.byKindJson === "object") {
    for (const [k, v] of Object.entries(row.byKindJson)) {
      byKind[k] = Number(v) || 0;
    }
  }
  // Gesamt = Summe der (verdichteten) Chip-Zaehler, damit „Alle“ zur Liste passt.
  const totalCollapsed = Object.values(byKind).reduce((a, b) => a + b, 0);

  // Temperature breakdown across the unique leads in the filtered set.
  // Pull only the per-lead aggregates needed for the classifier.
  const tempWhere = buildBaseFilters(userId, filters);
  const tempRows = (await db
    .selectDistinct({
      id: leads.id,
      viewCount: leads.viewCount,
      playCount: leads.playCount,
      watchTimeSec: leads.watchTimeSec,
      ctaClickCount: leads.ctaClickCount,
    })
    .from(leadEvents)
    .innerJoin(leads, eq(leads.id, leadEvents.leadId))
    .innerJoin(runs, eq(runs.id, leads.runId))
    .innerJoin(campaigns, eq(campaigns.id, runs.campaignId))
    .where(and(...tempWhere))) as Array<{
      id: string;
      viewCount: number;
      playCount: number;
      watchTimeSec: number;
      ctaClickCount: number;
    }>;

  const byTemperature = LEAD_TEMPERATURES.reduce(
    (acc, t) => {
      acc[t] = 0;
      return acc;
    },
    {} as Record<LeadTemperature, number>,
  );
  for (const l of tempRows) {
    const t = classifyLeadFromAggregates({
      pageViewCount: l.viewCount ?? 0,
      playCount: l.playCount ?? 0,
      watchTimeSec: l.watchTimeSec ?? 0,
      ctaClickCount: l.ctaClickCount ?? 0,
    });
    byTemperature[t] += 1;
  }

  return {
    total: totalCollapsed || (row?.total ?? 0),
    byKind,
    byTemperature,
    uniqueLeads: row?.uniqueLeads ?? 0,
    uniqueSessions: row?.uniqueSessions ?? 0,
  };
}

// ── getFunnel ───────────────────────────────────────────────────────────────

interface FunnelSqlRow {
  totalLeads: number;
  pageViewLeads: number;
  videoPlayLeads: number;
  video75Leads: number;
  ctaClickLeads: number;
}

/**
 * Build the WHERE-clauses for the funnel which DOESN'T sit on lead_events
 * at the top of the join — it counts unique leads. We scope on
 * `campaigns.userId` and on the scope-id at the lead-tree level. Date /
 * kind / temperature filters from `ActivityFilters` are intentionally
 * NOT applied here — funnels are always full-history scoped.
 */
function buildFunnelScopeFilters(userId: string, scope: ActivityScope): SQL[] {
  const parts: SQL[] = [];
  parts.push(sql`${campaigns.userId} = ${userId}`);
  parts.push(sql`${campaigns.deletedAt} IS NULL`);
  parts.push(sql`${leads.removedAt} IS NULL`);
  switch (scope.kind) {
    case "campaign":
      parts.push(sql`${campaigns.id} = ${scope.campaignId}`);
      break;
    case "run":
      parts.push(sql`${runs.id} = ${scope.runId}`);
      break;
    case "lead":
      parts.push(sql`${leads.id} = ${scope.leadId}`);
      break;
    case "global":
    default:
      break;
  }
  return parts;
}

export async function getFunnel(
  userId: string,
  scope: ActivityScope,
): Promise<FunnelResult> {
  const whereParts = buildFunnelScopeFilters(userId, scope);

  // Sub-correlated exists-checks: per lead we check whether at least one
  // event of each step's kind exists. `video_75` needs the progress payload
  // check; the others are pure kind matches.
  const [row] = (await db
    .select({
      totalLeads: sql<number>`COUNT(*)::int`,
      pageViewLeads: sql<number>`COUNT(*) FILTER (WHERE EXISTS (
        SELECT 1 FROM ${leadEvents} le
        WHERE le.lead_id = ${leads.id} AND le.kind = 'page_view'
      ))::int`,
      videoPlayLeads: sql<number>`COUNT(*) FILTER (WHERE EXISTS (
        SELECT 1 FROM ${leadEvents} le
        WHERE le.lead_id = ${leads.id} AND le.kind = 'video_play'
      ))::int`,
      video75Leads: sql<number>`COUNT(*) FILTER (WHERE EXISTS (
        SELECT 1 FROM ${leadEvents} le
        WHERE le.lead_id = ${leads.id}
          AND le.kind IN ('video_progress', 'video_ended')
          AND (le.payload ? 'atSec')
          AND (le.payload ? 'duration')
          AND COALESCE(NULLIF(le.payload ->> 'duration', '')::float, 0) > 0
          AND (
            COALESCE(NULLIF(le.payload ->> 'atSec', '')::float, 0)
            / NULLIF(NULLIF(le.payload ->> 'duration', '')::float, 0)
          ) * 100 >= ${VIDEO_75_THRESHOLD}
      ))::int`,
      ctaClickLeads: sql<number>`COUNT(*) FILTER (WHERE EXISTS (
        SELECT 1 FROM ${leadEvents} le
        WHERE le.lead_id = ${leads.id} AND le.kind = 'cta_click'
      ))::int`,
    })
    .from(leads)
    .innerJoin(runs, eq(runs.id, leads.runId))
    .innerJoin(campaigns, eq(campaigns.id, runs.campaignId))
    .where(and(...whereParts))) as unknown as FunnelSqlRow[];

  const totalLeads = row?.totalLeads ?? 0;
  const denominator = totalLeads > 0 ? totalLeads : 1;
  const mkStep = (label: string, kind: string, count: number): FunnelStep => ({
    label,
    kind,
    count,
    pct: Math.round((count / denominator) * 1000) / 10,
  });

  const steps: FunnelStep[] = [
    mkStep("Seitenaufruf", "page_view", row?.pageViewLeads ?? 0),
    mkStep("Video gestartet", "video_play", row?.videoPlayLeads ?? 0),
    mkStep("Video ≥ 75 %", "video_progress", row?.video75Leads ?? 0),
    mkStep("CTA geklickt", "cta_click", row?.ctaClickLeads ?? 0),
  ];

  return { scope, totalLeads, steps };
}

// ── Helper: lead-IDs for a scope (used by export endpoint hooks) ────────────

/**
 * Returns the lead-IDs visible to `userId` under `filters.scope`. Convenience
 * for the API layer when it needs to scope a non-event resource (e.g. PDF
 * regenerate) by the same activity-filter.
 */
export async function getScopedLeadIds(
  userId: string,
  filters: ActivityFilters,
): Promise<string[]> {
  const whereParts: SQL[] = [];
  whereParts.push(sql`${campaigns.userId} = ${userId}`);
  whereParts.push(sql`${campaigns.deletedAt} IS NULL`);
  whereParts.push(sql`${leads.removedAt} IS NULL`);
  const scope = filters.scope;
  switch (scope.kind) {
    case "campaign":
      whereParts.push(sql`${campaigns.id} = ${scope.campaignId}`);
      break;
    case "run":
      whereParts.push(sql`${runs.id} = ${scope.runId}`);
      break;
    case "lead":
      whereParts.push(sql`${leads.id} = ${scope.leadId}`);
      break;
    case "global":
    default:
      break;
  }
  if (filters.campaignIds && filters.campaignIds.length > 0) {
    whereParts.push(inArray(campaigns.id, filters.campaignIds));
  }
  if (filters.runIds && filters.runIds.length > 0) {
    whereParts.push(inArray(runs.id, filters.runIds));
  }
  const rows = await db
    .select({ id: leads.id })
    .from(leads)
    .innerJoin(runs, eq(runs.id, leads.runId))
    .innerJoin(campaigns, eq(campaigns.id, runs.campaignId))
    .where(and(...whereParts));
  return rows.map((r) => r.id);
}

// Re-export for caller convenience.
export { LEAD_TEMPERATURES };
export type {
  ActivityCounts,
  ActivityFeedRow,
  ActivityFilters,
  ActivityScope,
  FunnelResult,
  FunnelStep,
  LeadTemperature,
};
// Keep an explicit re-export of `inArray` to suppress "unused import" if a
// future refactor removes the inline use — Drizzle's typed-list helpers
// still want it on the public surface.
void inArray;


// ── Lead-Drawer-Kennzahlen ──────────────────────────────────────────────────

export interface LeadDrawerStats {
  pageViews: number;
  watchTimeSec: number;
  /** Einmalig gesehener Anteil der Zeitleiste, 0–100. */
  watchPct: number;
  ctaClicks: number;
  sessions: number;
}

/**
 * Kennzahlen fuer den Lead-Drawer im Aktivitaets-Center, tenant-sicher.
 * Vorher berechnete der Client einen Ersatzwert aus `time_on_page`-Events
 * (Seitenzeit, nicht Videozeit) → „Watch-Time 0 s“. Jetzt kommen die
 * Aggregatspalten des Leads plus die Zahl der Sitzungen.
 */
export async function getLeadDrawerStats(
  userId: string,
  leadId: string,
): Promise<{ stats: LeadDrawerStats; email: string | null } | null> {
  const [row] = await db
    .select({
      viewCount: leads.viewCount,
      watchTimeSec: leads.watchTimeSec,
      watchPct: leads.watchPct,
      ctaClickCount: leads.ctaClickCount,
      data: leads.data,
      sessions: sql<number>`(
        SELECT COUNT(DISTINCT session_id)::int FROM lead_events le
        WHERE le.lead_id = ${leads.id} AND le.session_id IS NOT NULL
      )`,
    })
    .from(leads)
    .innerJoin(runs, eq(runs.id, leads.runId))
    .innerJoin(campaigns, eq(campaigns.id, runs.campaignId))
    .where(and(eq(leads.id, leadId), eq(campaigns.userId, userId)))
    .limit(1);
  if (!row) return null;
  const data = (row.data ?? {}) as Record<string, unknown>;
  const emailRaw = Object.entries(data).find(([k, v]) => /mail/i.test(k) && typeof v === "string" && (v as string).includes("@"))?.[1];
  return {
    stats: {
      pageViews: row.viewCount ?? 0,
      watchTimeSec: row.watchTimeSec ?? 0,
      watchPct: row.watchPct ?? 0,
      ctaClicks: row.ctaClickCount ?? 0,
      sessions: row.sessions ?? 0,
    },
    email: typeof emailRaw === "string" ? emailRaw : null,
  };
}
