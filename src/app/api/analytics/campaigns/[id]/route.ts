export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/analytics/campaigns/[id]
 *
 * Authenticated, tenant-scoped per-campaign deep-dive. Returns 404 (not 403)
 * for not-owned campaigns to avoid leaking existence across tenants.
 *
 * Response shape:
 *   {
 *     campaign: { id, name, createdAt },
 *     summary: { viewCount, playCount, ctaClickCount, watchTimeSec, leadsCount },
 *     timeSeries: Array<{ date, views, plays, ctas }>,  // exactly 30 buckets
 *     runs: Array<{ id, startedAt, createdAt, status, leadsCount, viewCount,
 *                   playCount, ctaClickCount }>,
 *     topLeads: Array<{ id, firstName, lastName, companyName, watchTimeSec,
 *                       viewCount, ctaClickCount }>          // up to 5
 *   }
 */

import { NextRequest, NextResponse } from "next/server";
import { requireUserApi } from "@/lib/auth-guard";
import { getCampaignDeepDive } from "@/lib/db/queries/analytics-summary";

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const auth = await requireUserApi();
  if (!auth.ok) return auth.response;

  const id = params.id;
  if (!id || !/^[0-9a-fA-F-]{20,40}$/.test(id)) {
    return NextResponse.json(
      { error: "Ungueltige Kampagnen-ID." },
      { status: 400 },
    );
  }

  try {
    const data = await getCampaignDeepDive(id, auth.user.id);
    return NextResponse.json(data);
  } catch (err) {
    if (err instanceof Error && err.message === "Not found") {
      return NextResponse.json({ error: "Nicht gefunden." }, { status: 404 });
    }
    console.error("[/api/analytics/campaigns/:id] failed:", err);
    return NextResponse.json(
      { error: "Interner Fehler." },
      { status: 500 },
    );
  }
}
