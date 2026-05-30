export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/leads/[id]/analytics
 *
 * Authenticated, tenant-scoped per-lead analytics. The lead must belong to
 * a run owned by the calling user; otherwise the endpoint returns 404 (not
 * 403, to avoid leaking lead existence across tenants).
 *
 * Response shape:
 *   {
 *     summary: {
 *       viewCount, firstViewedAt, lastViewedAt,
 *       playCount, watchTimeSec, ctaClickCount, lastCtaAt
 *     },
 *     events: [{ id, kind, ts, payload }, …]  // most-recent first, up to 500
 *     watchTimeBuckets: [{ sec, count }, …]   // 5s-wide buckets for heatmap
 *   }
 */

import { NextRequest, NextResponse } from "next/server";
import { requireUserApi } from "@/lib/auth-guard";
import { getLeadAnalytics } from "@/lib/db/queries/lead-events";

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const auth = await requireUserApi();
  if (!auth.ok) return auth.response;

  const leadId = params.id;
  if (!leadId || !/^[0-9a-fA-F-]{20,40}$/.test(leadId)) {
    return NextResponse.json({ error: "Ungueltige Lead-ID." }, { status: 400 });
  }

  try {
    const analytics = await getLeadAnalytics(leadId, auth.user.id);
    return NextResponse.json(analytics);
  } catch (err) {
    if (err instanceof Error && err.message === "Not found") {
      return NextResponse.json({ error: "Nicht gefunden." }, { status: 404 });
    }
    console.error("[/api/leads/:id/analytics] failed:", err);
    return NextResponse.json(
      { error: "Interner Fehler." },
      { status: 500 },
    );
  }
}
