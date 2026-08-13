export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { requireUserApi } from "@/lib/auth-guard";
import { getLeadDataColumns } from "@/lib/db/queries/leads";

/**
 * GET /api/runs/bundle-columns?runIds=<uuid>,<uuid>,…
 *
 * Liefert die tatsächlich vorhandenen Spaltennamen der Leadlisten der
 * angegebenen Runs (Union, alphabetisch) — die Bundle-Dialoge bauen daraus
 * die Sortier-Auswahl. Tenant-Guard in der Query (nur eigene Runs).
 */

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(req: NextRequest) {
  const auth = await requireUserApi();
  if (!auth.ok) return auth.response;

  const raw = req.nextUrl.searchParams.get("runIds") ?? "";
  const runIds = Array.from(
    new Set(
      raw
        .split(",")
        .map((s) => s.trim())
        .filter((s) => UUID_RE.test(s)),
    ),
  ).slice(0, 20);

  if (runIds.length === 0) {
    return NextResponse.json(
      { error: "Mindestens eine gültige Run-ID wird benötigt." },
      { status: 400 },
    );
  }

  const columns = await getLeadDataColumns(runIds, auth.user.id);
  return NextResponse.json({ columns });
}
