export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUserApi } from "@/lib/auth-guard";
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
  const { rejectedLeadIds, approveAlsoProblematic } = parsed.data;

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

  // ── 3. Counter auf dem Run setzen ────────────────────────────────────
  // Wir addieren rejectedCount zum bestehenden Wert, weil der Operator
  // möglicherweise vorher schon einzeln rejected hat (siehe /reject Endpoint).
  await updateRunCounts(params.id, auth.user.id, {
    approvedLeadCount: approvedCount,
    rejectedLeadCount: (run.rejectedLeadCount ?? 0) + rejectedCount,
  });

  // ── 4. Run-Status hochziehen (atomic) ───────────────────────────────
  const transition = await setRunStatus(
    params.id,
    auth.user.id,
    "approved",
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
