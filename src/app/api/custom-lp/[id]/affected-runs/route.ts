/**
 * List the runs that currently pin a version of this Custom-LP template.
 *
 * Used by the UI right before showing the "auch alte Runden?" prompt
 * after a new ZIP upload. Returns an array even when empty.
 *
 *   GET /api/custom-lp/[id]/affected-runs
 *     → { affectedRuns: AffectedRunSummary[] }
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { requireUserApi } from "@/lib/auth-guard";
import { listAffectedRuns } from "@/lib/db/queries/custom-lp";

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await requireUserApi();
  if (!auth.ok) return auth.response;
  try {
    const affectedRuns = await listAffectedRuns(params.id, auth.user.id);
    return NextResponse.json({ affectedRuns });
  } catch {
    return NextResponse.json({ error: "Nicht gefunden." }, { status: 404 });
  }
}
