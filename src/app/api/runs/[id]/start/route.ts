export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { requireUserApi } from "@/lib/auth-guard";
import { db } from "@/lib/db";
import { leads, runs } from "@/lib/db/schema";
import { getRun, updateRun } from "@/lib/db/queries/runs";
import { bulkInsertLeads, type BulkLeadRow } from "@/lib/db/queries/leads";
import { pipelineQueue } from "@/worker/queue";

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
 *   1. Loads the run + parsed-rows + mapping blob.
 *   2. For each parsed row: applies the mapping (placeholder → original
 *      column value) to produce the lead's `data` payload — original
 *      columns are kept too so the export later still has everything.
 *   3. Bulk-inserts leads, flips run.status to 'generating' and enqueues a
 *      pipeline job per lead.
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
  if (run.status === "generating") {
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

  // Fetch the freshly inserted lead-ids so we can enqueue jobs in order.
  const leadRows = await db
    .select({ id: leads.id, rowIndex: leads.rowIndex })
    .from(leads)
    .where(eq(leads.runId, params.id));
  // Sort by rowIndex for predictable enqueue order.
  leadRows.sort((a, b) => a.rowIndex - b.rowIndex);

  await updateRun(params.id, auth.user.id, {
    status: "generating",
    startedAt: new Date(),
    totalLeads: inserted,
  });

  // Free the parsed-rows blob (they're now in `leads`).
  await db
    .update(runs)
    .set({
      columnMapping: { mapping } as unknown as Record<string, string>,
    })
    .where(and(eq(runs.id, params.id), eq(runs.userId, auth.user.id)));

  // Enqueue jobs (best-effort: if Redis is down we still return — the run
  // can be re-started by an admin / via a worker requeue script).
  try {
    const queue = pipelineQueue();
    await queue.addBulk(
      leadRows.map((lr) => ({
        name: "lead-pipeline",
        data: {
          leadId: lr.id,
          runId: params.id,
          userId: auth.user.id,
          campaignId: run.campaignId,
        },
      })),
    );
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[runs:start] enqueue failed:", err);
    return NextResponse.json(
      {
        ok: false,
        error:
          "Leads angelegt, aber die Job-Queue ist nicht erreichbar. Bitte Worker prüfen.",
        totalLeads: inserted,
      },
      { status: 503 },
    );
  }

  return NextResponse.json({ ok: true, totalLeads: inserted });
}
