export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { requireUserApi } from "@/lib/auth-guard";
import { db } from "@/lib/db";
import { leads } from "@/lib/db/schema";
import { getRun, updateRun } from "@/lib/db/queries/runs";
import { pipelineQueue } from "@/worker/queue";

/**
 * POST /api/runs/[id]/regenerate
 *
 * Setzt eine abgeschlossene (oder fehlgeschlagene) Runde komplett zurück
 * und schickt ALLE Leads erneut durch die Pipeline:
 *   1. Alle Leads des Runs: status='pending', urls=null, errorMessage=null,
 *      startedAt=null, completedAt=null
 *   2. Run: status='generating', startedAt=now, completedAt=null
 *   3. Re-enqueue eines Lead-Pipeline-Jobs pro Lead
 *
 * Sichtbar nur wenn der Run einen terminalen Status hat (completed /
 * failed / cancelled). Ein laufender Run wird mit 409 abgelehnt.
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

  if (run.status === "generating") {
    return NextResponse.json(
      { error: "Runde läuft bereits — bitte warten oder abbrechen." },
      { status: 409 },
    );
  }

  // Lead-IDs in row-Reihenfolge holen — für stabile Re-enqueue-Order.
  const leadRows = await db
    .select({ id: leads.id, rowIndex: leads.rowIndex })
    .from(leads)
    .where(eq(leads.runId, params.id));

  if (leadRows.length === 0) {
    return NextResponse.json(
      { error: "Keine Leads in dieser Runde." },
      { status: 400 },
    );
  }

  leadRows.sort((a, b) => a.rowIndex - b.rowIndex);

  // Reset aller Leads + Run-Status in einer Transaktion-light-Variante
  // (Drizzle ohne explizite TX hier; die zwei UPDATEs sind idempotent).
  await db
    .update(leads)
    .set({
      status: "pending",
      videoUrl: null,
      pdfUrl: null,
      thumbnailUrl: null,
      errorMessage: null,
      startedAt: null,
      completedAt: null,
    })
    .where(eq(leads.runId, params.id));

  await updateRun(params.id, auth.user.id, {
    status: "generating",
    startedAt: new Date(),
    completedAt: null,
  });

  // Re-enqueue. Wenn Redis weg ist: rollen wir den Status NICHT zurück —
  // der User sieht "generating" und kann via separatem Worker-Requeue
  // nachhelfen. Wir geben aber eine 503 zurück damit das UI weiß was los war.
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
    console.error("[runs:regenerate] enqueue failed:", err);
    return NextResponse.json(
      {
        ok: false,
        error:
          "Leads zurückgesetzt, aber die Job-Queue ist nicht erreichbar. Bitte Worker prüfen.",
      },
      { status: 503 },
    );
  }

  return NextResponse.json({ ok: true, totalLeads: leadRows.length });
}
