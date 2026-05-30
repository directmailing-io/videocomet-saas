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
 * Setzt eine abgeschlossene (oder fehlgeschlagene) Runde teilweise oder
 * komplett zurück und schickt ALLE Leads erneut durch die Pipeline.
 *
 * Body (optional): { mode?: "all" | "video" | "pdf" }
 *   - "all"   (Default, back-compat): alle Outputs werden zurückgesetzt
 *             und die volle Pipeline läuft erneut.
 *   - "video": nur Video + Landingpage werden neu erzeugt. Der bestehende
 *             `pdfUrl` bleibt erhalten; die Worker überspringen die PDF-
 *             Stages (`skipPdf=true`).
 *   - "pdf":   nur das PDF-Brief wird neu erzeugt. Bestehende `videoUrl`,
 *             `thumbnailUrl` und `slug` bleiben erhalten; die Worker
 *             überspringen Render/Upload/Landingpage (`skipVideo=true`).
 *
 * Sichtbar nur wenn der Run einen terminalen Status hat (completed /
 * failed / cancelled). Ein laufender Run wird mit 409 abgelehnt.
 */

type RegenerateMode = "all" | "video" | "pdf";

function parseMode(input: unknown): RegenerateMode {
  if (input === "video" || input === "pdf" || input === "all") return input;
  return "all";
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await requireUserApi();
  if (!auth.ok) return auth.response;

  // Body lesen ist optional — wenn nichts mitgegeben wird, behalten wir
  // das alte Verhalten ("all") bei.
  let mode: RegenerateMode = "all";
  try {
    const ct = req.headers.get("content-type") ?? "";
    if (ct.includes("application/json")) {
      const body = (await req.json()) as { mode?: unknown };
      mode = parseMode(body?.mode);
    }
  } catch {
    // Leerer / kaputter Body → Default behalten.
  }

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

  // Reset der Lead-Felder hängt vom Modus ab:
  //  - "all":   alle URLs werden genullt.
  //  - "video": nur video- und landingpage-bezogene Felder; pdfUrl bleibt.
  //  - "pdf":   nur pdfUrl; video / thumbnail / slug bleiben unverändert.
  // In allen Fällen: status zurück auf "pending", errorMessage / Zeitstempel
  // zurücksetzen, damit die Live-Tabelle sauber neu trackt.
  const baseReset = {
    status: "pending" as const,
    errorMessage: null,
    startedAt: null,
    completedAt: null,
  };
  const resetPatch =
    mode === "all"
      ? {
          ...baseReset,
          videoUrl: null,
          pdfUrl: null,
          thumbnailUrl: null,
        }
      : mode === "video"
        ? {
            ...baseReset,
            videoUrl: null,
            thumbnailUrl: null,
          }
        : {
            ...baseReset,
            pdfUrl: null,
          };

  await db.update(leads).set(resetPatch).where(eq(leads.runId, params.id));

  await updateRun(params.id, auth.user.id, {
    status: "generating",
    startedAt: new Date(),
    completedAt: null,
  });

  // Re-enqueue. Wenn Redis weg ist: rollen wir den Status NICHT zurück —
  // der User sieht "generating" und kann via separatem Worker-Requeue
  // nachhelfen. Wir geben aber eine 503 zurück damit das UI weiß was los war.
  const skipVideo = mode === "pdf";
  const skipPdf = mode === "video";
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
          ...(skipVideo ? { skipVideo: true } : {}),
          ...(skipPdf ? { skipPdf: true } : {}),
        },
        opts: { jobId: lr.id },
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

  return NextResponse.json({ ok: true, mode, totalLeads: leadRows.length });
}
