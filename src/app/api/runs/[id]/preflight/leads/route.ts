export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { requireUserApi } from "@/lib/auth-guard";
import { listPreflightLeads } from "@/lib/db/queries/leads";
import { getRunForPreflight } from "@/lib/db/queries/runs";

/**
 * GET /api/runs/[id]/preflight/leads
 *
 * Gibt ALLE Leads eines Runs zurück (nicht-paginiert). Bei 500 Leads ergibt
 * das ~500 KB JSON — akzeptabel für den initialen Grid-Load. Spätere
 * Diff-Updates laufen über den SSE-Stream.
 *
 * Sort: problematische Stati zuerst, dann ok, beides nach rowIndex.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await requireUserApi();
  if (!auth.ok) return auth.response;

  try {
    await getRunForPreflight(params.id, auth.user.id);
  } catch {
    return NextResponse.json(
      { error: "Run nicht gefunden.", details: null },
      { status: 404 },
    );
  }

  const leads = await listPreflightLeads(params.id, auth.user.id);
  return NextResponse.json({ leads });
}
