export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/analytics/events
 *
 * Authenticated, tenant-scoped filterable event list.
 *
 * Query params:
 *  - kinds       Comma-separated event kinds (page_view,video_play,
 *                video_progress,video_ended,cta_click). Multiple allowed.
 *  - campaignId  Restrict to one campaign.
 *  - from / to   ISO timestamps. Server side compares against lead_events.ts.
 *  - q           Free-text match against lead first/last/company name.
 *  - limit       1..200, default 50.
 *  - offset      0..N, default 0.
 *
 * Response shape:
 *   {
 *     events: Array<{
 *       id, ts, kind, payload,
 *       leadId, leadName, companyName,
 *       campaignId, campaignName, runId
 *     }>,
 *     total: number   // total matching events, ignoring limit/offset
 *   }
 */

import { NextRequest, NextResponse } from "next/server";
import { requireUserApi } from "@/lib/auth-guard";
import {
  listAnalyticsEvents,
  type EventListFilters,
} from "@/lib/db/queries/analytics-summary";
import { LEAD_EVENT_KINDS } from "@/lib/db/queries/lead-events";

const ALLOWED_KINDS = new Set<string>(LEAD_EVENT_KINDS);
const UUID_RE = /^[0-9a-fA-F-]{20,40}$/;

function parseDate(s: string | null): Date | undefined {
  if (!s) return undefined;
  const t = Date.parse(s);
  if (!Number.isFinite(t)) return undefined;
  return new Date(t);
}

function parseIntClamped(
  s: string | null,
  min: number,
  max: number,
  fallback: number,
): number {
  if (!s) return fallback;
  const n = Number.parseInt(s, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await requireUserApi();
  if (!auth.ok) return auth.response;

  const url = req.nextUrl;

  // kinds → CSV → validated list
  const rawKinds = url.searchParams.get("kinds");
  let kinds: string[] | undefined;
  if (rawKinds) {
    kinds = rawKinds
      .split(",")
      .map((s) => s.trim())
      .filter((s) => ALLOWED_KINDS.has(s));
    if (kinds.length === 0) kinds = undefined;
  }

  const campaignId = url.searchParams.get("campaignId") ?? undefined;
  if (campaignId && !UUID_RE.test(campaignId)) {
    return NextResponse.json(
      { error: "Ungueltige Kampagnen-ID." },
      { status: 400 },
    );
  }

  const from = parseDate(url.searchParams.get("from"));
  const to = parseDate(url.searchParams.get("to"));
  const q = url.searchParams.get("q")?.trim() || undefined;

  const limit = parseIntClamped(url.searchParams.get("limit"), 1, 200, 50);
  const offset = parseIntClamped(
    url.searchParams.get("offset"),
    0,
    100_000,
    0,
  );

  const filters: EventListFilters = {
    userId: auth.user.id,
    kinds,
    campaignId,
    from,
    to,
    q,
    limit,
    offset,
  };

  try {
    const data = await listAnalyticsEvents(filters);
    return NextResponse.json(data);
  } catch (err) {
    console.error("[/api/analytics/events] failed:", err);
    return NextResponse.json(
      { error: "Interner Fehler." },
      { status: 500 },
    );
  }
}
