export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { requireUserApi } from "@/lib/auth-guard";
import { getRun } from "@/lib/db/queries/runs";
import { normalizeForRuleMatch } from "@/lib/placeholders/rules";
import type { StoredRunColumnMapping } from "@/lib/placeholders/types";

/**
 * GET /api/runs/[id]/column-values?column=<name>
 *
 * Liefert die Distinct-Werte einer CSV-Spalte aus den am Run persistierten
 * Preview-Rows (`column_mapping.parsed`, max 5000 Zeilen) — Grundlage der
 * Werte-Zuordnungstabelle im Wenn-Dann-Regel-Dialog.
 *
 * Werte werden mit derselben toleranten Normalisierung gruppiert wie das
 * Regel-Matching (`normalizeForRuleMatch`), damit "AT" und " at " als EIN
 * Eintrag erscheinen — genau so, wie eine equals-Regel sie später matcht.
 * Angezeigt wird die zuerst gesehene Original-Schreibweise.
 */
const MAX_VALUES = 60;

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await requireUserApi();
  if (!auth.ok) return auth.response;

  let run;
  try {
    run = await getRun(params.id, auth.user.id);
  } catch {
    return NextResponse.json({ error: "Nicht gefunden." }, { status: 404 });
  }

  const column = req.nextUrl.searchParams.get("column")?.trim();
  if (!column) {
    return NextResponse.json(
      { error: "Query-Parameter `column` fehlt." },
      { status: 400 },
    );
  }

  const cm = (run.columnMapping as StoredRunColumnMapping | null) ?? {};
  const parsed = cm.parsed;
  if (!parsed || parsed.headers.length === 0) {
    return NextResponse.json(
      { error: "Für diese Runde liegen keine Listen-Daten vor." },
      { status: 404 },
    );
  }

  // Header case-insensitive auflösen (gleiche Toleranz wie lookupLeadValueCI).
  const header =
    parsed.headers.find((h) => h === column) ??
    parsed.headers.find((h) => h.toLowerCase() === column.toLowerCase());
  if (!header) {
    return NextResponse.json(
      { error: `Spalte „${column}" nicht in der Liste gefunden.` },
      { status: 404 },
    );
  }

  const groups = new Map<string, { value: string; count: number }>();
  let emptyCount = 0;
  for (const row of parsed.rows) {
    const raw = typeof row[header] === "string" ? row[header] : "";
    const trimmed = raw.trim();
    if (trimmed.length === 0) {
      emptyCount++;
      continue;
    }
    const norm = normalizeForRuleMatch(trimmed);
    const g = groups.get(norm);
    if (g) g.count++;
    else groups.set(norm, { value: trimmed, count: 1 });
  }

  const sorted = Array.from(groups.values()).sort((a, b) => b.count - a.count);

  return NextResponse.json({
    column: header,
    values: sorted.slice(0, MAX_VALUES),
    distinctTotal: sorted.length,
    truncated: sorted.length > MAX_VALUES,
    emptyCount,
    sampledRows: parsed.rows.length,
    totalRows: parsed.totalRows,
  });
}
