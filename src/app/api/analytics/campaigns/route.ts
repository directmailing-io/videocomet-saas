export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/analytics/campaigns
 *
 * Authenticated, tenant-scoped. Returns one entry per campaign owned by the
 * caller with denormalized lead-aggregates and the last 14d of per-day event
 * counts (for sparkline rendering on the Overview page).
 *
 * Response shape:
 *   {
 *     campaigns: Array<{
 *       id, name, createdAt,
 *       runsCount, leadsCount,
 *       viewCount, playCount, ctaClickCount, watchTimeSec,
 *       dailyCounts: Array<{ date, views, plays, ctas }>  // exactly 14
 *     }>
 *   }
 */

import { NextResponse } from "next/server";
import { requireUserApi } from "@/lib/auth-guard";
import { listCampaignAggregates } from "@/lib/db/queries/analytics-summary";

export async function GET(): Promise<NextResponse> {
  const auth = await requireUserApi();
  if (!auth.ok) return auth.response;

  try {
    const campaigns = await listCampaignAggregates(auth.user.id);
    return NextResponse.json({ campaigns });
  } catch (err) {
    console.error("[/api/analytics/campaigns] failed:", err);
    return NextResponse.json(
      { error: "Interner Fehler." },
      { status: 500 },
    );
  }
}
