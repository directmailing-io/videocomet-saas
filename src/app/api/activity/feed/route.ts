/**
 * GET /api/activity/feed — tenant-scoped Aktivitäts-Feed
 *
 * Query-DSL: see `src/lib/activity/filter-parser.ts`.
 * Response: { rows: ActivityFeedRow[]; nextCursor: string | null }
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { requireUserApi } from "@/lib/auth-guard";
import { parseFilters } from "@/lib/activity/filter-parser";
import { getActivityFeed, getLeadDrawerStats } from "@/lib/db/queries/activity";

export async function GET(req: NextRequest) {
  const auth = await requireUserApi();
  if (!auth.ok) return auth.response;

  const parsed = parseFilters(req.nextUrl.searchParams, auth.user.id);
  if ("error" in parsed) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const result = await getActivityFeed(auth.user.id, parsed);

  // Lead-Scope (Drawer): Kennzahlen + E-Mail mitliefern, damit der Client
  // keinen Ersatzwert aus Seitenzeit-Events bilden muss.
  if (parsed.scope.kind === "lead") {
    const extra = await getLeadDrawerStats(auth.user.id, parsed.scope.leadId);
    if (extra) {
      return NextResponse.json({ ...result, stats: extra.stats, email: extra.email }, {
        headers: { "Cache-Control": "no-store" },
      });
    }
  }

  return NextResponse.json(result, {
    headers: { "Cache-Control": "no-store" },
  });
}
