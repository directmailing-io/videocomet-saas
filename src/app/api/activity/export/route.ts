/**
 * GET /api/activity/export — CSV-Export der Leads im aktuellen Filter-Window.
 *
 * Limits: 50_000 Leads pro Export. Größere Mengen liefern 400 mit dem Hinweis,
 * den Filter zu verengen — sonst läuft der Browser-Download in eine
 * Excel-Importgrenze und die Postgres-Connection hängt.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { requireUserApi } from "@/lib/auth-guard";
import { parseFilters } from "@/lib/activity/filter-parser";
import { buildLeadCsv, getLeadsForExport } from "@/lib/activity/export-csv";

const MAX_EXPORT_ROWS = 50_000;

export async function GET(req: NextRequest) {
  const auth = await requireUserApi();
  if (!auth.ok) return auth.response;

  const parsed = parseFilters(req.nextUrl.searchParams, auth.user.id);
  if ("error" in parsed) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const rows = await getLeadsForExport(auth.user.id, parsed);
  if (rows.length > MAX_EXPORT_ROWS) {
    return NextResponse.json(
      { error: "Bitte enger filtern." },
      { status: 400 },
    );
  }

  const csv = buildLeadCsv(rows);

  // ISO-Datum (YYYY-MM-DD) im UTC, damit der Dateiname stabil bleibt.
  const today = new Date().toISOString().slice(0, 10);
  const filename = `aktivitaet-${today}.csv`;

  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
