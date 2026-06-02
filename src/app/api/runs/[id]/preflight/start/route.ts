export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { Queue, type ConnectionOptions } from "bullmq";
import { requireUserApi } from "@/lib/auth-guard";
import { getRedisConnection } from "@/worker/queue";
import {
  bulkSetPreflightStatus,
  getLeadsForPreflightStart,
  type PreflightStatusUpdate,
} from "@/lib/db/queries/leads";
import {
  getRunForPreflight,
  setRunStatus,
} from "@/lib/db/queries/runs";
import {
  findDuplicates,
  validateLeadInline,
} from "@/lib/preflight/inline-validate";

/**
 * Name der dedizierten BullMQ-Queue für Phase-1-Jobs. Bewusst lokal als
 * Konstante, damit dieser Route-Handler nicht auf interne Worker-APIs
 * angewiesen ist (siehe Aufgaben-Boundaries: kein touching von queue.ts).
 * Agent 2 / der Worker registriert eine `Worker`-Instance auf demselben
 * Namen — `Queue.add` aus der Next-Side schreibt nur in Redis und braucht
 * den Worker nicht.
 */
const LEAD_PREFLIGHT_QUEUE = "lead-preflight";

interface PreflightJobData {
  leadId: string;
  runId: string;
  userId: string;
  campaignId: string;
}

let _q: Queue<PreflightJobData> | null = null;
function preflightQueue(): Queue<PreflightJobData> {
  if (_q) return _q;
  _q = new Queue<PreflightJobData>(LEAD_PREFLIGHT_QUEUE, {
    connection: getRedisConnection() as unknown as ConnectionOptions,
    defaultJobOptions: {
      attempts: 2,
      backoff: { type: "exponential", delay: 3_000 },
      removeOnComplete: 100,
      removeOnFail: 500,
    },
  });
  return _q;
}

function err(message: string, status: number, details: string | null = null) {
  return NextResponse.json({ error: message, details }, { status });
}

/**
 * POST /api/runs/[id]/preflight/start
 *
 * Idempotent — wenn der Run bereits in `preflighting` ist, liefert er den
 * aktuellen Stand zurück ohne erneut zu enqueuen. Vorgehen:
 *   1. Tenant-Guard.
 *   2. Pre-Conditions: run.status ∈ {draft, mapping, failed} UND es gibt Leads.
 *   3. Inline-Validation: leere Pflichtfelder werden direkt als
 *      `missing_field`, Duplikate als `duplicate` (mit FK-Referenz) markiert.
 *      Diese Leads kommen NIE in die Queue.
 *   4. BullMQ-Bulk-Enqueue für alle nicht-disqualifizierten Leads.
 *      jobId = leadId, weil das die natürliche BullMQ-Dedup ist.
 *   5. run.status → preflighting, preflight_started_at = now.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await requireUserApi();
  if (!auth.ok) return auth.response;

  let run;
  try {
    run = await getRunForPreflight(params.id, auth.user.id);
  } catch {
    return err("Run nicht gefunden.", 404);
  }

  // Idempotenz: schon laufend → Status zurückgeben, kein Re-Enqueue.
  if (run.status === "preflighting") {
    return NextResponse.json({
      ok: true,
      totalLeads: 0,
      alreadyDisqualified: 0,
      note: "Preflight läuft bereits.",
    });
  }

  if (
    run.status !== "draft" &&
    run.status !== "mapping" &&
    run.status !== "failed"
  ) {
    return err(
      "Preflight kann nur aus dem Draft- oder Failed-Status gestartet werden.",
      409,
      `current_status=${run.status}`,
    );
  }

  const leadRows = await getLeadsForPreflightStart(params.id, auth.user.id);
  if (leadRows.length === 0) {
    return err(
      "Keine Leads in diesem Run — bitte zuerst Daten hochladen.",
      400,
    );
  }

  // ── Inline-Validation: disqualifizierte Leads direkt markieren ───────
  const updates: PreflightStatusUpdate[] = [];
  const skipIds = new Set<string>();

  const dupes = findDuplicates(
    leadRows.map((l) => ({ id: l.id, data: l.data })),
  );

  for (const lead of leadRows) {
    if (dupes.has(lead.id)) {
      updates.push({
        leadId: lead.id,
        status: "duplicate",
        duplicateOfLeadId: dupes.get(lead.id)!,
        errorMessage: "Duplikat (gleiche URL oder E-Mail wie ein anderer Lead).",
      });
      skipIds.add(lead.id);
      continue;
    }
    const v = validateLeadInline(lead.data);
    if (!v.ok) {
      // Bei kombinierten Issues priorisieren wir missing_field, weil das
      // dem Operator den eindeutigsten Hinweis liefert. invalid_url wird
      // ebenfalls als missing_field gewertet (URL existiert technisch
      // nicht in nutzbarer Form).
      const isMissing =
        v.issues.includes("missing_firstName") ||
        v.issues.includes("missing_websiteUrl") ||
        v.issues.includes("invalid_url");
      updates.push({
        leadId: lead.id,
        status: isMissing ? "missing_field" : "unknown_error",
        errorMessage: v.issues.join(", "),
      });
      skipIds.add(lead.id);
    }
  }

  if (updates.length > 0) {
    await bulkSetPreflightStatus(updates);
  }

  // ── Run-Status hochziehen (atomisch, optimistic lock) ────────────────
  const transition = await setRunStatus(
    params.id,
    auth.user.id,
    "preflighting",
    { preflightStartedAt: new Date() },
  );
  if (!transition.ok) {
    // Race-Condition: jemand anderes hat den Status zwischenzeitlich gesetzt.
    return err(
      "Run-Status konnte nicht auf preflighting gesetzt werden.",
      409,
      `current_status=${transition.currentStatus ?? "unknown"}`,
    );
  }

  // ── BullMQ-Enqueue ──────────────────────────────────────────────────
  const jobsToEnqueue = leadRows.filter((l) => !skipIds.has(l.id));
  if (jobsToEnqueue.length > 0) {
    try {
      const queue = preflightQueue();
      await queue.addBulk(
        jobsToEnqueue.map((l) => ({
          name: "lead-preflight",
          data: {
            leadId: l.id,
            runId: params.id,
            userId: auth.user.id,
            campaignId: run.campaignId,
          },
          opts: { jobId: l.id },
        })),
      );
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error("[preflight:start] enqueue failed:", e);
      return NextResponse.json(
        {
          ok: false,
          error:
            "Die Job-Queue ist nicht erreichbar. Bitte später erneut starten.",
          details: e instanceof Error ? e.message : null,
        },
        { status: 503 },
      );
    }
  }

  return NextResponse.json({
    ok: true,
    totalLeads: leadRows.length,
    alreadyDisqualified: updates.length,
  });
}
