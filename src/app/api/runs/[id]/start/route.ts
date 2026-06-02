export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { requireUserApi } from "@/lib/auth-guard";
import { db } from "@/lib/db";
import { campaigns, customLpTemplates, leads, runs } from "@/lib/db/schema";
import { getRun, updateRun } from "@/lib/db/queries/runs";
import { bulkInsertLeads, type BulkLeadRow } from "@/lib/db/queries/leads";
import { enqueueForPreflight } from "@/lib/preflight/job-enqueue";

/**
 * Looks up the active Custom-LP-Version-ID for a campaign at the moment a run
 * starts. Returns null if the campaign has no Custom-LP-Template bound, or if
 * the template has no active version (edge-case: ZIP uploaded but never
 * activated — we degrade silently and the run uses the Block-LP / default).
 */
async function resolveActiveCustomLpVersionId(
  campaignId: string,
): Promise<string | null> {
  const [row] = await db
    .select({
      customLpTemplateId: campaigns.customLpTemplateId,
      activeVersionId: customLpTemplates.activeVersionId,
    })
    .from(campaigns)
    .leftJoin(
      customLpTemplates,
      eq(customLpTemplates.id, campaigns.customLpTemplateId),
    )
    .where(eq(campaigns.id, campaignId))
    .limit(1);
  if (!row || !row.customLpTemplateId) return null;
  return row.activeVersionId ?? null;
}

interface StoredColumnMapping {
  mapping?: Record<string, string>;
  parsed?: {
    headers: string[];
    rows: Record<string, string>[];
    totalRows: number;
  };
}

/**
 * POST /api/runs/[id]/start
 *
 * NEUE SEMANTIK (Lead-Quality-Check / Preflight-Phase):
 *
 *   1. Loads the run + parsed-rows + mapping blob.
 *   2. For each parsed row: applies the mapping (placeholder → original
 *      column value) to produce the lead's `data` payload — original
 *      columns are kept too so the export later still has everything.
 *   3. Bulk-inserts leads. Flips run.status to **'preflighting'** (statt
 *      direkt 'generating'). Snapshot der aktiven Custom-LP-Version bleibt
 *      bestehen, weil sie pro Run immutable sein soll — der User darf an
 *      seinem Template feilen, ohne dass laufende Runs es mitbekommen.
 *   4. Ruft `enqueueForPreflight()` auf:
 *        - inline-validation (Pflichtfelder, URL-Format, Email-Format)
 *        - duplicate-detection (host + email)
 *        - inline-disqualifizierte Leads bekommen direkt einen terminalen
 *          `preflight_status` OHNE Worker-Job
 *        - alle übrigen Leads landen in der `lead-preflight`-Queue
 *   5. Returns `{ ok, totalLeads, queuedForPreflight, alreadyDisqualified }`.
 *
 * Phase 2 (das alte `lead-pipeline` enqueue) wird hier NICHT mehr getriggert.
 * Sie startet erst, wenn der Operator über `/api/runs/[id]/preflight/approve`
 * den Run freigibt — siehe `enqueueApprovedLeadsForPhase2()` im
 * `job-enqueue.ts`-Helper.
 */
export async function POST(
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

  const cm = (run.columnMapping as StoredColumnMapping | null) ?? {};
  if (!cm.parsed || cm.parsed.rows.length === 0) {
    return NextResponse.json(
      { error: "Keine Leads hochgeladen." },
      { status: 400 },
    );
  }
  if (!cm.mapping || Object.keys(cm.mapping).length === 0) {
    return NextResponse.json(
      { error: "Spalten-Mapping fehlt." },
      { status: 400 },
    );
  }
  // Guard: ein Run, der bereits in einem aktiven Pipeline-Status ist, darf
  // nicht doppelt gestartet werden. `preflighting`, `awaiting_approval`,
  // `approved` und `generating` sind alle "läuft schon".
  const activeStatuses: Array<typeof run.status> = [
    "preflighting",
    "awaiting_approval",
    "approved",
    "generating",
  ];
  if (activeStatuses.includes(run.status)) {
    return NextResponse.json(
      { error: "Runde läuft bereits." },
      { status: 409 },
    );
  }

  // Guard: same run shouldn't insert leads twice.
  const [existing] = await db
    .select({ id: leads.id })
    .from(leads)
    .where(eq(leads.runId, params.id))
    .limit(1);
  if (existing) {
    return NextResponse.json(
      { error: "Leads bereits angelegt." },
      { status: 409 },
    );
  }

  const mapping = cm.mapping;
  const rowsIn = cm.parsed.rows;

  const bulkRows: BulkLeadRow[] = rowsIn.map((row, index) => {
    // Original columns + flattened mapped values (placeholder names) so the
    // worker pipeline can look up `data.firstName` etc. AND keep `data.<col>`.
    const data: Record<string, string> = { ...row };
    for (const [placeholder, columnName] of Object.entries(mapping)) {
      if (columnName && row[columnName] !== undefined) {
        data[placeholder] = row[columnName];
      }
    }
    return { rowIndex: index, data };
  });

  const inserted = await bulkInsertLeads(params.id, bulkRows);

  // Snapshot the campaign's active Custom-LP version onto the run, so future
  // template edits do not silently change what THIS run delivers.
  const customLpVersionId = await resolveActiveCustomLpVersionId(
    run.campaignId,
  );

  // Status auf 'preflighting'. `preflightStartedAt` setzen, damit der Stuck-
  // Recovery-Pass nachher das 5-Minuten-Fenster für stuck preflight-leads
  // korrekt berechnen kann. `startedAt` (das Phase-2-Marker) bleibt NULL —
  // wird erst beim Approval-Übergang gesetzt.
  await updateRun(params.id, auth.user.id, {
    status: "preflighting",
    preflightStartedAt: new Date(),
    totalLeads: inserted,
    customLpVersionId,
  });

  // Free the parsed-rows blob (they're now in `leads`).
  await db
    .update(runs)
    .set({
      columnMapping: { mapping } as unknown as Record<string, string>,
    })
    .where(and(eq(runs.id, params.id), eq(runs.userId, auth.user.id)));

  // Preflight-Enqueue: inline-Validation + Duplikat-Detection + Bulk-Add in
  // `lead-preflight`. Wenn Redis weg ist, werfen wir einen 503, damit der
  // User merkt dass die Phase 1 nicht losgelaufen ist. Der Run bleibt in
  // `preflighting` — der nächste Worker-Boot-Recovery-Pass fängt das auf.
  let enqueueResult;
  try {
    enqueueResult = await enqueueForPreflight(
      params.id,
      auth.user.id,
      run.campaignId,
    );
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[runs:start] preflight enqueue failed:", err);
    return NextResponse.json(
      {
        ok: false,
        error:
          "Leads angelegt, aber die Preflight-Queue ist nicht erreichbar. " +
          "Bitte Worker prüfen — der Recovery-Pass holt den Run beim nächsten Boot ab.",
        totalLeads: inserted,
      },
      { status: 503 },
    );
  }

  return NextResponse.json({
    ok: true,
    totalLeads: enqueueResult.totalLeads,
    queuedForPreflight: enqueueResult.queuedForPreflight,
    alreadyDisqualified: enqueueResult.alreadyDisqualified,
  });
}
