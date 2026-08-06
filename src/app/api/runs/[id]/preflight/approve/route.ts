export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { requireUserApi } from "@/lib/auth-guard";
import { db } from "@/lib/db";
import { campaigns } from "@/lib/db/schema";
import {
  approveLeads,
  markLeadsRemoved,
} from "@/lib/db/queries/leads";
import {
  getRunForPreflight,
  setRunStatus,
  updateRunCounts,
} from "@/lib/db/queries/runs";
import { enqueueApprovedLeadsForPhase2 } from "@/lib/preflight/job-enqueue";

const BodySchema = z.object({
  rejectedLeadIds: z.array(z.string().uuid()).optional().default([]),
  approveAlsoProblematic: z.boolean().optional().default(false),
  /**
   * Explizite Bestätigung der Intro-Vorschau (personalisierte Video-
   * Begrüßung). Pflicht, wenn die Kampagne intro_enabled hat UND
   * Vorschau-Videos vorliegen (`runs.intro_preview` nicht leer).
   */
  introApproved: z.boolean().optional().default(false),
});

/**
 * POST /api/runs/[id]/preflight/approve
 *
 * Schließt die Phase-1-Review ab. Pflichten:
 *   - Soft-Delete der explizit abgelehnten Leads (rejectedLeadIds).
 *   - Approve aller anderen nicht-removed Leads mit `preflight_status='ok'`.
 *     Wenn `approveAlsoProblematic` true ist, werden auch terminale Fehler-
 *     Stati mit approved (User-Override).
 *   - Run-Status auf `approved` setzen (atomic, optimistic-locked).
 *   - Approved/Rejected-Counter auf dem Run aktualisieren.
 *
 * WICHTIG: Dieser Endpoint enqueued KEINE Phase-2-Jobs. Das macht Agent 4
 * im Worker oder im start-Endpoint, sobald er `run.status='approved'` sieht.
 *
 * Idempotenz: Wenn `run.status` schon `approved` oder `generating` ist,
 * liefert die Route 409 mit klarem Hinweis — User hat zweimal geklickt.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await requireUserApi();
  if (!auth.ok) return auth.response;

  let bodyRaw: unknown;
  try {
    bodyRaw = await req.json();
  } catch {
    bodyRaw = {};
  }
  const parsed = BodySchema.safeParse(bodyRaw);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Ungültige Anfrage.",
        details: parsed.error.message,
      },
      { status: 400 },
    );
  }
  const { rejectedLeadIds, approveAlsoProblematic, introApproved } = parsed.data;

  let run;
  try {
    run = await getRunForPreflight(params.id, auth.user.id);
  } catch {
    return NextResponse.json(
      { error: "Run nicht gefunden.", details: null },
      { status: 404 },
    );
  }

  if (run.status === "approved" || run.status === "generating") {
    return NextResponse.json(
      {
        error: "Run wurde bereits freigegeben.",
        details: `current_status=${run.status}`,
      },
      { status: 409 },
    );
  }
  if (run.status !== "awaiting_approval" && run.status !== "preflighting") {
    return NextResponse.json(
      {
        error: "Freigabe ist im aktuellen Status nicht erlaubt.",
        details: `current_status=${run.status}`,
      },
      { status: 409 },
    );
  }

  // ── 0. Intro-Vorschau-Gate ───────────────────────────────────────────
  // Kampagnen mit personalisierter Video-Begrüßung: liegen Vorschau-Videos
  // vor, muss der User sie explizit bestätigen (introApproved=true), bevor
  // die Runde freigegeben wird. Kein/leeres Preview-Array = kein Gate
  // (Feature nicht bereit oder alle Previews fehlgeschlagen — dann läuft
  // die Pipeline ohnehin mit Fallback-Logik).
  let introGateActive = false;
  const introPreviews = run.introPreview;
  if (Array.isArray(introPreviews) && introPreviews.length > 0) {
    const [campaign] = await db
      .select({ introEnabled: campaigns.introEnabled })
      .from(campaigns)
      .where(eq(campaigns.id, run.campaignId))
      .limit(1);
    if (campaign?.introEnabled) {
      introGateActive = true;
      if (!introApproved) {
        return NextResponse.json(
          {
            error: "intro_preview_not_approved",
            details:
              "Die Vorschau der personalisierten Begrüßung muss vor der Freigabe bestätigt werden.",
          },
          { status: 400 },
        );
      }
    }
  }

  // ── 1. Reject explizit gelistete Leads ──────────────────────────────
  let rejectedCount = 0;
  if (rejectedLeadIds.length > 0) {
    rejectedCount = await markLeadsRemoved(
      rejectedLeadIds,
      params.id,
      auth.user.id,
      "user_rejected",
    );
  }

  // ── 2. Approve den Rest ──────────────────────────────────────────────
  const { approvedCount } = await approveLeads(
    params.id,
    auth.user.id,
    { approveAlsoProblematic },
  );

  // Guard: Ohne einen einzigen approvten Lead darf der Run NICHT auf
  // `approved` gehen — er würde dort für immer hängen bleiben, weil der
  // Phase-2-Enqueue und der Recovery-Watcher bei 0 approvten Leads bewusst
  // nichts tun (DigiSpace-Incident 2026-08-06).
  if (approvedCount === 0) {
    await updateRunCounts(params.id, auth.user.id, {
      approvedLeadCount: 0,
      rejectedLeadCount: (run.rejectedLeadCount ?? 0) + rejectedCount,
    });
    return NextResponse.json(
      {
        error:
          "Kein einziger Lead kann produziert werden — alle wurden abgelehnt oder beim Import aussortiert. Bitte prüfe die Liste und starte ggf. eine neue Runde.",
        details: "no_approved_leads",
      },
      { status: 422 },
    );
  }

  // ── 3. Counter auf dem Run setzen ────────────────────────────────────
  // Wir addieren rejectedCount zum bestehenden Wert, weil der Operator
  // möglicherweise vorher schon einzeln rejected hat (siehe /reject Endpoint).
  await updateRunCounts(params.id, auth.user.id, {
    approvedLeadCount: approvedCount,
    rejectedLeadCount: (run.rejectedLeadCount ?? 0) + rejectedCount,
  });

  // ── 4. Run-Status hochziehen (atomic) ───────────────────────────────
  // Bei aktivem Intro-Gate wird die Bestätigung der Vorschau im selben
  // Update mit Zeitstempel festgehalten.
  const transition = await setRunStatus(
    params.id,
    auth.user.id,
    "approved",
    introGateActive ? { introPreviewApprovedAt: new Date() } : undefined,
  );
  if (!transition.ok) {
    return NextResponse.json(
      {
        error:
          "Status konnte nicht auf approved gesetzt werden — wurde zwischenzeitlich verändert.",
        details: `current_status=${transition.currentStatus ?? "unknown"}`,
      },
      { status: 409 },
    );
  }

  // ── 5. Phase-2-Jobs direkt enqueuen ──────────────────────────────────
  // Wir warten nicht auf den 2-Minuten-Recovery-Watcher im Worker — das
  // wäre für den User eine unnötige Verzögerung. Wenn das hier fehlschlägt
  // (Redis kurzfristig weg), fängt der Watcher es spätestens beim
  // nächsten Tick auf — die Response liefert dann trotzdem `ok: true` mit
  // einem Hinweis-Flag, damit das UI keine falsche Fehlermeldung zeigt.
  let phase2Queued = 0;
  let phase2DelayedToWorker = false;
  try {
    const enq = await enqueueApprovedLeadsForPhase2(params.id, auth.user.id);
    phase2Queued = enq.queued;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(
      "[preflight:approve] phase-2 enqueue failed, falling back to recovery watcher:",
      err,
    );
    phase2DelayedToWorker = true;
  }

  return NextResponse.json({
    ok: true,
    approvedCount,
    rejectedCount,
    phase2Queued,
    phase2DelayedToWorker,
  });
}
