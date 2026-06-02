export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { requireUserApi } from "@/lib/auth-guard";
import { createSSEResponse } from "@/lib/sse";
import {
  getPreflightCounts,
  listChangedPreflightLeads,
  listPreflightLeads,
} from "@/lib/db/queries/leads";
import { getRunForPreflight } from "@/lib/db/queries/runs";

const POLL_INTERVAL_MS = 1500;
const IDLE_TIMEOUT_MS = 60_000;

/**
 * GET /api/runs/[id]/preflight/stream
 *
 * Server-Sent-Events-Stream für die Quality-Check-UI. Schickt:
 *   - `snapshot` einmal beim Connect: vollständige Lead-Liste + Counts
 *   - `lead-update` pro verändertem Lead seit letztem Tick
 *   - `counts` periodisch (jeder Tick) mit aggregierten Zählern
 *
 * Schließt automatisch wenn:
 *   - Run terminal ist (completed | failed | cancelled | awaiting_approval)
 *   - 60 Sekunden lang nichts passiert (idle)
 *   - der Client disconnected (AbortSignal)
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await requireUserApi();
  if (!auth.ok) return auth.response;

  try {
    await getRunForPreflight(params.id, auth.user.id);
  } catch {
    return new Response("Nicht gefunden.", { status: 404 });
  }

  const runId = params.id;
  const userId = auth.user.id;

  return createSSEResponse(async (send, close, signal) => {
    // ── Initial snapshot ────────────────────────────────────────────
    const initialLeads = await listPreflightLeads(runId, userId);
    const initialCounts = await getPreflightCounts(runId, userId);
    const initialRun = await getRunForPreflight(runId, userId);

    send("snapshot", {
      runStatus: initialRun.status,
      leads: initialLeads,
      counts: initialCounts,
    });

    if (isTerminalForStream(initialRun.status)) {
      close();
      return;
    }

    // Cursor: alle Leads, deren preflight_completed_at > cursor sind, gelten
    // als "verändert seit letztem Tick". Plus running-Leads (siehe Query).
    let leadCursor: Date = new Date();
    let lastActivityAt = Date.now();

    while (!signal.aborted) {
      await wait(POLL_INTERVAL_MS, signal);
      if (signal.aborted) break;

      try {
        const tickStartedAt = new Date();
        const run = await getRunForPreflight(runId, userId);
        const changed = await listChangedPreflightLeads(
          runId,
          userId,
          leadCursor,
        );
        leadCursor = tickStartedAt;

        for (const lead of changed) {
          send("lead-update", lead);
        }

        const counts = await getPreflightCounts(runId, userId);
        send("counts", counts);

        if (changed.length > 0) {
          lastActivityAt = Date.now();
        }

        if (isTerminalForStream(run.status)) {
          send("status", { runStatus: run.status });
          break;
        }

        if (Date.now() - lastActivityAt > IDLE_TIMEOUT_MS) {
          send("idle", { reason: "no_activity" });
          break;
        }
      } catch (err) {
        send("error", {
          message: err instanceof Error ? err.message : String(err),
        });
        break;
      }
    }
  });
}

/**
 * Im Preflight-Kontext gilt `awaiting_approval` als "Stream darf zu" — der
 * User entscheidet jetzt manuell, weitere Lead-Updates sind nicht zu
 * erwarten. Der `awaiting_approval`-Status wird vom Worker gesetzt, sobald
 * alle Leads terminal sind.
 */
function isTerminalForStream(status: string): boolean {
  return (
    status === "completed" ||
    status === "failed" ||
    status === "cancelled" ||
    status === "awaiting_approval" ||
    status === "approved" ||
    status === "generating"
  );
}

function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener("abort", onAbort, { once: true });
  });
}
