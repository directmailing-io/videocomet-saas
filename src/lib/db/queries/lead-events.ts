/**
 * Lead-Event Tracking Queries
 *
 * Persistent event-log per Lead (page_view, video_play, video_progress,
 * video_ended, cta_click) fed by the public `/api/track/event` endpoint.
 *
 * To keep the UI fast (filter/sort leads by view-count or watch-time without
 * a sub-query), this module also writes denormalized aggregate columns onto
 * the `leads` row on every event insert. The update is a small UPDATE with
 * a handful of correlated sub-selects — ~5ms, acceptable for tracking-rate
 * traffic and far simpler than running a periodic cron.
 */

import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { leadEvents, leads, runs } from "@/lib/db/schema";
import { enqueueCrmSync, mapEventKindToCrm } from "@/lib/crm/enqueue";
import { enqueueWebhooksForLeadEvent } from "@/lib/webhooks/lead-event-hook";

export type LeadEventKind =
  | "page_view"
  | "video_play"
  | "video_progress"
  | "video_ended"
  | "cta_click"
  // ── Activity-Center (additive, alle fire-and-forget aus der Bridge) ────
  | "scroll_depth"
  | "time_on_page"
  | "video_mute"
  | "video_unmute"
  | "link_click"
  | "cta_hover"
  // ── Section-Visibility (Bridge feuert das schon, war historisch nicht
  //    in der Whitelist). Additive Aufnahme, damit der track-Endpoint
  //    nicht weiterhin 400 zurückgibt.
  | "section_view";

export const LEAD_EVENT_KINDS: readonly LeadEventKind[] = [
  "page_view",
  "video_play",
  "video_progress",
  "video_ended",
  "cta_click",
  "scroll_depth",
  "time_on_page",
  "video_mute",
  "video_unmute",
  "link_click",
  "cta_hover",
  "section_view",
] as const;

export function isLeadEventKind(value: unknown): value is LeadEventKind {
  return (
    typeof value === "string" &&
    (LEAD_EVENT_KINDS as readonly string[]).includes(value)
  );
}

export interface InsertLeadEventInput {
  leadId: string;
  kind: LeadEventKind;
  payload?: Record<string, unknown>;
  sessionId?: string;
  ipHash?: string;
}

/**
 * Insert one event AND update the denormalized aggregates on the lead row
 * in the same code path. Both steps are wrapped in a try/catch so a
 * tracking-write error never bubbles up to the public endpoint.
 *
 * Implementation note: the UPDATE uses correlated sub-selects against
 * `lead_events` (rather than incrementing counters) so the aggregates remain
 * consistent even if events arrive out of order, get re-played, or the
 * lead's events are partially deleted. Idempotent by construction.
 */
export async function insertLeadEvent(input: InsertLeadEventInput): Promise<void> {
  try {
    await db.insert(leadEvents).values({
      leadId: input.leadId,
      kind: input.kind,
      payload: input.payload ?? null,
      sessionId: input.sessionId ?? null,
      ipHash: input.ipHash ?? null,
    });
    await aggregateLeadStats(input.leadId);
    // CRM-Sync-Hook: after the event row + aggregate update commit, kick
    // off a debounced CRM push for the 3 kinds we sync (page_view /
    // video_play / cta_click). `enqueueCrmSync` is fire-and-forget and
    // never throws — failures are swallowed there with a console.error.
    const crmKind = mapEventKindToCrm(input.kind);
    if (crmKind) {
      void enqueueCrmSync({ leadId: input.leadId, kind: crmKind });
    }
    // Outgoing-Webhook-Hook: feuert pro Lead-Event den passenden
    // `WebhookEventKind` (lead.opened / lead.video_played /
    // lead.video_progress / lead.cta_clicked) an alle aktiven Endpoints
    // des Users. Fire-and-forget; Quartile-Dedup macht die Bridge
    // intern, damit `video_progress` nur EINMAL pro Quartile feuert.
    void enqueueWebhooksForLeadEvent({
      leadId: input.leadId,
      kind: input.kind,
      payload: input.payload ?? null,
      sessionId: input.sessionId ?? null,
    });
  } catch (err) {
    console.warn(
      `[lead-events] insert failed for lead=${input.leadId} kind=${input.kind}:`,
      err instanceof Error ? err.message : "unknown",
    );
  }
}

/**
 * Recompute the denormalized aggregate columns on `leads` from the full
 * `lead_events` history. Idempotent. Safe to call from a cron OR inline after
 * each insert.
 *
 * Watch-time strategy: for each (leadId, sessionId) group, take MAX(playedSec)
 * from video_progress + video_ended events. Sum those per-session maxima.
 * This handles the common case where the player sends progress every 5s — we
 * only count the highest progress per session.
 */
export async function aggregateLeadStats(leadId: string): Promise<void> {
  await db.execute(sql`
    UPDATE leads
    SET
      view_count = COALESCE((
        SELECT COUNT(*)::int FROM lead_events
        WHERE lead_id = ${leadId} AND kind = 'page_view'
      ), 0),
      first_viewed_at = (
        SELECT MIN(ts) FROM lead_events
        WHERE lead_id = ${leadId} AND kind = 'page_view'
      ),
      last_viewed_at = (
        SELECT MAX(ts) FROM lead_events
        WHERE lead_id = ${leadId} AND kind = 'page_view'
      ),
      play_count = COALESCE((
        SELECT COUNT(*)::int FROM lead_events
        WHERE lead_id = ${leadId} AND kind = 'video_play'
      ), 0),
      watch_time_sec = COALESCE((
        SELECT SUM(max_played)::int FROM (
          SELECT MAX(
            COALESCE(NULLIF(payload ->> 'playedSec', '')::float, 0)
          ) AS max_played
          FROM lead_events
          WHERE lead_id = ${leadId}
            AND kind IN ('video_progress', 'video_ended')
            AND session_id IS NOT NULL
          GROUP BY session_id
        ) per_session
      ), 0),
      cta_click_count = COALESCE((
        SELECT COUNT(*)::int FROM lead_events
        WHERE lead_id = ${leadId} AND kind = 'cta_click'
      ), 0),
      last_cta_at = (
        SELECT MAX(ts) FROM lead_events
        WHERE lead_id = ${leadId} AND kind = 'cta_click'
      )
    WHERE id = ${leadId}
  `);
}

export interface LeadAnalyticsSummary {
  viewCount: number;
  firstViewedAt: Date | null;
  lastViewedAt: Date | null;
  playCount: number;
  watchTimeSec: number;
  ctaClickCount: number;
  lastCtaAt: Date | null;
}

export interface LeadAnalyticsEvent {
  id: string;
  kind: string;
  ts: Date;
  payload: unknown;
}

export interface LeadAnalyticsBucket {
  sec: number;
  count: number;
}

export interface LeadAnalytics {
  summary: LeadAnalyticsSummary;
  events: LeadAnalyticsEvent[];
  watchTimeBuckets: LeadAnalyticsBucket[];
  /** Video length in seconds — derived from payload.durationSec across
   *  video_play / progress / ended events. Null if no video event captured
   *  the duration yet. Used to render the heatmap axis. */
  videoDurationSec: number | null;
}

const EVENT_LIST_LIMIT = 500;

/**
 * Lookup the lead's id by slug, **tenant-scoped via Domain**. Returns null
 * if no lead matches.
 *
 * SICHERHEIT: NIE ohne `domainId`-Filter abfragen, sonst leakt die
 * Tracking-Pipeline Events zwischen Tenants (User A's Slug `franz-mustermann`
 * würde sich nicht von User B's auf einer anderen Domain unterscheiden).
 *
 *   - `domainId = null`  → Lead muss auf der App-Default-Domain laufen
 *     (`leads.domain_id IS NULL`).
 *   - `domainId = "<uuid>"` → Lead muss exakt zu dieser Custom-Domain
 *     gehören.
 *
 * Cached in-memory für 60s in der Route-Layer mit zusammengesetztem Key.
 */
export async function getLeadIdBySlug(
  slug: string,
  domainId: string | null,
): Promise<string | null> {
  const [row] = await db
    .select({ id: leads.id })
    .from(leads)
    .where(
      domainId === null
        ? and(eq(leads.slug, slug), isNull(leads.domainId))
        : and(eq(leads.slug, slug), eq(leads.domainId, domainId)),
    )
    .limit(1);
  return row?.id ?? null;
}

/**
 * Tenant-aware analytics for a single lead. The lead must belong to a run
 * owned by `userId`. Returns:
 *  - summary: the denormalized aggregate columns directly off `leads`
 *  - events: up to 500 most-recent events (DESC by ts) for an event-log UI
 *  - watchTimeBuckets: 5s-wide buckets of `atSec` across all video_progress
 *    events — feeds a re-watch heatmap
 */
export async function getLeadAnalytics(
  leadId: string,
  userId: string,
): Promise<LeadAnalytics> {
  const [leadRow] = await db
    .select({
      viewCount: leads.viewCount,
      firstViewedAt: leads.firstViewedAt,
      lastViewedAt: leads.lastViewedAt,
      playCount: leads.playCount,
      watchTimeSec: leads.watchTimeSec,
      ctaClickCount: leads.ctaClickCount,
      lastCtaAt: leads.lastCtaAt,
    })
    .from(leads)
    .innerJoin(runs, eq(runs.id, leads.runId))
    .where(and(eq(leads.id, leadId), eq(runs.userId, userId)))
    .limit(1);

  if (!leadRow) {
    throw new Error("Not found");
  }

  const eventRows = await db
    .select({
      id: leadEvents.id,
      kind: leadEvents.kind,
      ts: leadEvents.ts,
      payload: leadEvents.payload,
    })
    .from(leadEvents)
    .where(eq(leadEvents.leadId, leadId))
    .orderBy(desc(leadEvents.ts))
    .limit(EVENT_LIST_LIMIT);

  // Buckets aggregate every video event that carries atSec — including
  // video_play (just started here) and video_ended (reached end). With short
  // videos (<5s) we'd otherwise never see a video_progress and the heatmap
  // would be empty even after a complete view.
  const bucketRows = await db
    .select({
      bucket: sql<number>`floor(
        COALESCE(NULLIF(${leadEvents.payload} ->> 'atSec', '')::float, 0) / 5
      )::int`,
      count: sql<number>`count(*)::int`,
    })
    .from(leadEvents)
    .where(
      and(
        eq(leadEvents.leadId, leadId),
        sql`${leadEvents.kind} IN ('video_play', 'video_progress', 'video_ended')`,
        sql`${leadEvents.payload} ? 'atSec'`,
      ),
    )
    .groupBy(sql`floor(
      COALESCE(NULLIF(${leadEvents.payload} ->> 'atSec', '')::float, 0) / 5
    )::int`)
    .orderBy(asc(sql`1`));

  const watchTimeBuckets: LeadAnalyticsBucket[] = bucketRows.map((r) => ({
    sec: Number(r.bucket ?? 0) * 5,
    count: Number(r.count ?? 0),
  }));

  // Derive video duration from any event that captured durationSec.
  const [durationRow] = await db
    .select({
      dur: sql<number | null>`MAX(
        COALESCE(NULLIF(${leadEvents.payload} ->> 'durationSec', '')::float, 0)
      )::float`,
    })
    .from(leadEvents)
    .where(
      and(
        eq(leadEvents.leadId, leadId),
        sql`${leadEvents.payload} ? 'durationSec'`,
      ),
    );
  const videoDurationSec =
    durationRow?.dur && durationRow.dur > 0
      ? Math.round(durationRow.dur)
      : null;

  return {
    summary: {
      viewCount: leadRow.viewCount ?? 0,
      firstViewedAt: leadRow.firstViewedAt,
      lastViewedAt: leadRow.lastViewedAt,
      playCount: leadRow.playCount ?? 0,
      watchTimeSec: leadRow.watchTimeSec ?? 0,
      ctaClickCount: leadRow.ctaClickCount ?? 0,
      lastCtaAt: leadRow.lastCtaAt,
    },
    events: eventRows.map((r) => ({
      id: r.id,
      kind: r.kind,
      ts: r.ts,
      payload: r.payload,
    })),
    watchTimeBuckets,
    videoDurationSec,
  };
}
