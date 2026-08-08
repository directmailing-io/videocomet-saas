export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { requireUserApi } from "@/lib/auth-guard";
import { db } from "@/lib/db";
import { leads, runs } from "@/lib/db/schema";
import { pipelineQueue } from "@/worker/queue";
import { leadJobPriority } from "@/lib/queue-priority";

/**
 * POST /api/leads/[id]/regenerate
 *
 * Reprozessiert EINEN Lead — Video, Brief-PDF, Umschlag, oder alles.
 * Analog zum Run-scoped /api/runs/[id]/regenerate, aber pro Lead.
 *
 * Body (optional):
 *   { scope?: "all" | "video" | "pdf" | "envelope" }
 *   - "all":      video + pdf + envelope werden zurueckgesetzt
 *   - "video":    nur video + thumbnail + bunnyVideoId + landing page
 *   - "pdf":      nur pdfUrl
 *   - "envelope": nur envelopePdfUrl (fuer Umschlag-Nachzieher)
 *
 * Wichtig: **slug bleibt in JEDEM Modus stabil**. Tracking-URLs, die
 * schon versendet wurden, muessen weiter funktionieren. Nur pdfUrl /
 * videoUrl / envelopePdfUrl werden je nach scope genullt; Pipeline
 * ueberspringt Stages die bereits fertig sind (Idempotenz-Guards).
 *
 * Guards:
 *   - Tenant-scope ueber runs.userId
 *   - Wenn die Runde gerade laeuft → 409
 */

type RegenScope = "all" | "video" | "pdf" | "envelope";

const bodySchema = z.object({
  scope: z.enum(["all", "video", "pdf", "envelope"]).optional(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await requireUserApi();
  if (!auth.ok) return auth.response;

  let scope: RegenScope = "all";
  try {
    const ct = req.headers.get("content-type") ?? "";
    if (ct.includes("application/json")) {
      const body = bodySchema.parse(await req.json());
      if (body.scope) scope = body.scope;
    }
  } catch {
    // leerer/falscher body → Default "all"
  }

  const [row] = await db
    .select({
      leadId: leads.id,
      runId: leads.runId,
      campaignId: runs.campaignId,
      userId: runs.userId,
      runStatus: runs.status,
      rowIndex: leads.rowIndex,
    })
    .from(leads)
    .innerJoin(runs, eq(runs.id, leads.runId))
    .where(and(eq(leads.id, params.id), eq(runs.userId, auth.user.id)))
    .limit(1);

  if (!row) {
    return NextResponse.json({ error: "Nicht gefunden." }, { status: 404 });
  }
  if (row.runStatus === "generating") {
    return NextResponse.json(
      { error: "Runde läuft bereits — bitte warten." },
      { status: 409 },
    );
  }

  // Reset abhaengig vom Scope. slug NIE anfassen — Tracking-URLs muessen
  // stabil bleiben. status wird auf "pending" gesetzt damit die
  // Live-Tabelle den Fortschritt neu tracked.
  const patch: Record<string, unknown> = {
    status: "pending" as const,
    errorMessage: null,
    startedAt: null,
    completedAt: null,
    updatedAt: new Date(),
  };
  const skipVideo = scope === "pdf" || scope === "envelope";
  const skipPdf = scope === "video" || scope === "envelope";
  if (scope === "all" || scope === "video") {
    patch.videoUrl = null;
    patch.videoMp4Url = null;
    patch.bunnyVideoId = null;
    patch.thumbnailUrl = null;
  }
  if (scope === "all" || scope === "pdf") {
    patch.pdfUrl = null;
  }
  if (scope === "all" || scope === "envelope") {
    patch.envelopePdfUrl = null;
    patch.envelopePdfExpiresAt = null;
  }

  await db.update(leads).set(patch).where(eq(leads.id, params.id));

  // Re-enqueue diesen einen Lead. Skip-Flags steuern welche Stages
  // ausgefuehrt werden; die Stages selbst haben eigene Idempotenz-Guards
  // (videoAlreadyDone/pdfAlreadyDone), sodass ein "envelope"-only-Regen
  // videoUrl + pdfUrl unangetastet laesst und nur Stage 9b (Envelope)
  // ausfuehrt.
  try {
    const queue = pipelineQueue();
    // BullMQ dedupliziert per jobId — alte completed Job-Records blockieren
    // sonst stumm den neuen add(). Wir verwenden einen eindeutigen jobId
    // pro Regenerate (leadId + Timestamp), sodass BullMQ ihn immer annimmt.
    // Concurrency-Schutz kommt vom lead.status="pending" Reset weiter oben.
    // WICHTIG: BullMQ verbietet ":" in Custom-jobIds — deshalb "-" statt ":"
    const jobId = `${row.leadId}-regen-${Date.now()}`;
    await queue.add(
      "lead-pipeline",
      {
        leadId: row.leadId,
        runId: row.runId,
        userId: row.userId,
        campaignId: row.campaignId,
        ...(skipVideo ? { skipVideo: true } : {}),
        ...(skipPdf ? { skipPdf: true } : {}),
      },
      { jobId, priority: leadJobPriority(row.rowIndex) },
    );
  } catch (err) {
    return NextResponse.json(
      {
        error: "Job konnte nicht eingereiht werden (Redis?).",
        details: err instanceof Error ? err.message : null,
      },
      { status: 503 },
    );
  }

  return NextResponse.json({ ok: true, scope });
}
