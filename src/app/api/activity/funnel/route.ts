/**
 * GET /api/activity/funnel — Funnel-Sicht für eine Kampagne oder eine Runde.
 *
 * `scope=global` ist hier nicht sinnvoll (kein einheitlicher Funnel) und liefert
 * 400. Der scope wird via parseFilters validiert; die Query selbst bekommt nur
 * den passenden Scope (campaign | run).
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { requireUserApi } from "@/lib/auth-guard";
import { parseFilters } from "@/lib/activity/filter-parser";
import { getFunnel } from "@/lib/db/queries/activity";

export async function GET(req: NextRequest) {
  const auth = await requireUserApi();
  if (!auth.ok) return auth.response;

  const parsed = parseFilters(req.nextUrl.searchParams, auth.user.id);
  if ("error" in parsed) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  if (parsed.scope.kind !== "campaign" && parsed.scope.kind !== "run") {
    return NextResponse.json(
      { error: "Funnel-Scope nicht unterstützt." },
      { status: 400 },
    );
  }

  const result = await getFunnel(auth.user.id, parsed.scope);

  return NextResponse.json(result, {
    headers: { "Cache-Control": "no-store" },
  });
}
