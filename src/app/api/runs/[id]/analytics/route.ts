export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { requireUserApi } from "@/lib/auth-guard";
import { getRunAnalytics } from "@/lib/db/queries/analytics";
import {
  getCtaBreakdown,
  getProgressDistribution,
  getTimeOfDayHistogram,
} from "@/lib/analytics-aggregate";

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await requireUserApi();
  if (!auth.ok) return auth.response;

  try {
    // Tenant-Guard happens inside getRunAnalytics (innerJoin via runId+userId).
    const base = await getRunAnalytics(params.id, auth.user.id);

    const [progressDistribution, ctaBreakdown, timeOfDayHistogram] =
      await Promise.all([
        getProgressDistribution(params.id, auth.user.id),
        getCtaBreakdown(params.id, auth.user.id),
        getTimeOfDayHistogram(params.id, auth.user.id),
      ]);

    // Derived rates the dashboard cards consume directly. `getRunAnalytics`
    // already provides openRate/videoStartRate as 0..1 fractions. We add a
    // ctaRate using distinct leads with any cta_click. To stay cheap we just
    // approximate via totalCtaClicks / totalLeads (clamped to 1). Exact
    // distinct-lead rate would require an extra query and is rarely
    // meaningfully different in practice.
    const ctaRate =
      base.totalLeads > 0 ? Math.min(1, base.ctaClicks / base.totalLeads) : 0;

    return NextResponse.json({
      totalLeads: base.totalLeads,
      opened: base.opened,
      videoStarted: base.videoStarted,
      ctaClicks: base.ctaClicks,
      openRate: base.openRate,
      videoStartRate: base.videoStartRate,
      completedRate: base.completedRate, // 0..100 average video_progress
      ctaRate,
      progressDistribution,
      ctaBreakdown,
      timeOfDayHistogram,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown";
    if (msg === "Not found") {
      return NextResponse.json({ error: "Nicht gefunden." }, { status: 404 });
    }
    return NextResponse.json(
      { error: "Analytics konnten nicht geladen werden." },
      { status: 500 },
    );
  }
}
