export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { requireUserApi } from "@/lib/auth-guard";
import { getPreflightCounts } from "@/lib/db/queries/leads";
import { getRunForPreflight } from "@/lib/db/queries/runs";

/**
 * GET /api/runs/[id]/preflight/status
 *
 * Lightweight Polling-Endpoint für das UI. Liefert in einer Response
 * sowohl den Run-Lifecycle (started/completed) als auch die aggregierten
 * Lead-Counter. Progress-Percent basiert auf "alle nicht mehr in
 * pending/running" geteilt durch "total" — damit kommt 100% an, sobald
 * jeder Lead terminal ist (egal ob ok oder problematic).
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await requireUserApi();
  if (!auth.ok) return auth.response;

  let run;
  try {
    run = await getRunForPreflight(params.id, auth.user.id);
  } catch {
    return NextResponse.json(
      { error: "Run nicht gefunden.", details: null },
      { status: 404 },
    );
  }

  const counts = await getPreflightCounts(params.id, auth.user.id);

  const inFlight = counts.pending + counts.running;
  const progressPercent =
    counts.total === 0
      ? 0
      : Math.round(((counts.total - inFlight) / counts.total) * 100);

  return NextResponse.json({
    runStatus: run.status,
    counts,
    startedAt: run.preflightStartedAt ? run.preflightStartedAt.toISOString() : null,
    completedAt: run.preflightCompletedAt
      ? run.preflightCompletedAt.toISOString()
      : null,
    progressPercent,
  });
}
