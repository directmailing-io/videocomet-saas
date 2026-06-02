/**
 * GET /api/activity/counts — aggregierte Stat-Counter im aktuellen Filter-Window.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { requireUserApi } from "@/lib/auth-guard";
import { parseFilters } from "@/lib/activity/filter-parser";
import { getActivityCounts } from "@/lib/db/queries/activity";

export async function GET(req: NextRequest) {
  const auth = await requireUserApi();
  if (!auth.ok) return auth.response;

  const parsed = parseFilters(req.nextUrl.searchParams, auth.user.id);
  if ("error" in parsed) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const result = await getActivityCounts(auth.user.id, parsed);

  return NextResponse.json(result, {
    headers: { "Cache-Control": "no-store" },
  });
}
