/**
 * GET /api/runs/[id]/placeholders
 *
 * Liefert alles, was die Mapping-Stage im Run-Wizard zum Rendern braucht:
 *   - `placeholders`: alle in der Kampagne gefundenen Platzhalter mit
 *                     Quellen-Info (Folie 1, PDF, Block: Hero, …).
 *   - `csvColumns`:   die Header-Liste aus dem hochgeladenen CSV/XLSX.
 *   - `suggestedMapping`: vom Server vor-belegtes Mapping — bevorzugt aus
 *                     dem letzten Run dieser Kampagne, ansonsten via
 *                     Normalisierungs-/Alias-Matching (s. `suggest.ts`).
 *   - `reusedFromPreviousRun`: `true`, wenn mindestens ein Eintrag aus
 *                     einer früheren Runde übernommen wurde.
 *
 * Auth: nur der Run-Owner sieht seine Platzhalter.
 *
 * Performance-Hinweis: der Collector macht Netzwerk-Calls zu Google-Docs.
 * Deshalb force-dynamic + nodejs runtime — und der Endpoint sollte vom
 * Frontend nur bei Bedarf (Einstieg in den Mapping-Step) gepollt werden.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { and, eq, ne } from "drizzle-orm";
import { requireUserApi } from "@/lib/auth-guard";
import { db } from "@/lib/db";
import { runs } from "@/lib/db/schema";
import { getRun } from "@/lib/db/queries/runs";
import { collectCampaignPlaceholders } from "@/lib/placeholders/collector";
import { suggestMapping } from "@/lib/placeholders/suggest";
import { resolveMapping } from "@/lib/placeholders/substitute";
import type {
  PlaceholderMapping,
  RunPlaceholdersResponse,
  StoredRunColumnMapping,
} from "@/lib/placeholders/types";

/**
 * Holt das jüngste vorhandene Mapping aus früheren Runs derselben Kampagne.
 * Wir bevorzugen `placeholderMapping`, fallen aber auf das Legacy-`mapping`
 * zurück und heben es per `resolveMapping()` aufs neue Format.
 */
async function loadPriorMapping(
  campaignId: string,
  userId: string,
  excludeRunId: string,
): Promise<PlaceholderMapping | undefined> {
  const rows = await db
    .select({ id: runs.id, cm: runs.columnMapping, createdAt: runs.createdAt })
    .from(runs)
    .where(
      and(
        eq(runs.campaignId, campaignId),
        eq(runs.userId, userId),
        ne(runs.id, excludeRunId),
      ),
    );
  if (rows.length === 0) return undefined;
  // Neueste zuerst (Drizzle sort separat, weil createdAt im Select).
  rows.sort((a, b) => +b.createdAt - +a.createdAt);
  for (const r of rows) {
    const stored = (r.cm as StoredRunColumnMapping | null) ?? {};
    const merged = resolveMapping({
      mapping: stored.mapping,
      placeholderMapping: stored.placeholderMapping,
    });
    if (Object.keys(merged).length > 0) return merged;
  }
  return undefined;
}

export async function GET(
  _req: NextRequest,
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

  const cm = (run.columnMapping as StoredRunColumnMapping | null) ?? {};
  const csvColumns: string[] = cm.parsed?.headers ?? [];

  const placeholders = await collectCampaignPlaceholders(
    run.campaignId,
    auth.user.id,
    { envelopeTemplateId: run.envelopeTemplateId ?? null },
  );

  // 1. Reuse aus voriger Runde
  const priorMapping = await loadPriorMapping(
    run.campaignId,
    auth.user.id,
    run.id,
  );

  // 2. Aktuell schon gespeichertes Mapping dieses Runs (höchste Priorität)
  const currentMapping = resolveMapping({
    mapping: cm.mapping,
    placeholderMapping: cm.placeholderMapping,
  });

  // 3. Auto-Suggest: nutzt prior als Vorrangs-Quelle
  const suggested = suggestMapping(placeholders, csvColumns, priorMapping);

  // Merge: current > prior > auto-suggest. Das, was der User schon im
  // aktuellen Run gespeichert hat, bleibt unangetastet.
  const finalSuggested: PlaceholderMapping = { ...suggested };
  for (const [k, v] of Object.entries(currentMapping)) {
    finalSuggested[k] = { ...finalSuggested[k], ...v };
  }

  // Nur Keys ausliefern, die aktuell auch detektiert sind. Gespeicherte
  // Mappings können Keys aus einem älteren Kontext enthalten (z. B. anderer
  // Umschlag, geändertes Google Doc) — die würde die UI mit-PUTten und der
  // Mapping-Endpoint einst mit „unbekannte Platzhalter" ablehnen.
  const detectedKeys = new Set(placeholders.map((p) => p.key));
  for (const k of Object.keys(finalSuggested)) {
    if (!detectedKeys.has(k)) delete finalSuggested[k];
  }

  // Füllstand pro Spalte — die UI warnt bei komplett leeren gemappten
  // Spalten (z. B. „Vorname"-Spalte vorhanden, aber ohne Werte).
  const parsedRows = cm.parsed?.rows ?? [];
  const columnFillCounts: Record<string, number> = {};
  for (const col of csvColumns) columnFillCounts[col] = 0;
  for (const row of parsedRows) {
    for (const col of csvColumns) {
      const v = row[col];
      if (typeof v === "string" && v.trim().length > 0) {
        columnFillCounts[col] += 1;
      }
    }
  }

  const response: RunPlaceholdersResponse = {
    placeholders,
    csvColumns,
    suggestedMapping: finalSuggested,
    reusedFromPreviousRun:
      !!priorMapping && Object.keys(priorMapping).length > 0,
    columnFillCounts,
    rowCount: parsedRows.length,
  };

  return NextResponse.json(response);
}
