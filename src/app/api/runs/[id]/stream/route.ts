export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { requireUserApi } from "@/lib/auth-guard";
import { db } from "@/lib/db";
import { leads, runs } from "@/lib/db/schema";
import { getRun } from "@/lib/db/queries/runs";
import { countByStatus } from "@/lib/db/queries/leads";
import { createSSEResponse } from "@/lib/sse";

const POLL_INTERVAL_MS = 2000;
const RECENT_LIMIT = 50;

/**
 * GET /api/runs/[id]/stream
 *
 * Server-Sent Events stream that pushes:
 *   - `snapshot` once on connect: { run, counts, leads }
 *   - `tick`     every 2s:      { counts, recentEvents, runStatus }
 *
 * Closes the connection cleanly when the run reaches a terminal state
 * (`completed`, `failed`, or `cancelled`).
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await requireUserApi();
  if (!auth.ok) return auth.response;

  // Tenant guard (returns 404 via SSE 'error' if missing).
  try {
    await getRun(params.id, auth.user.id);
  } catch {
    return new Response("Nicht gefunden.", { status: 404 });
  }

  const userId = auth.user.id;
  const runId = params.id;

  return createSSEResponse(async (send, close, signal) => {
    // Initial snapshot.
    const initialRun = await getRun(runId, userId);
    const initialCounts = await countByStatus(runId, userId);
    const initialLeads = await listAllLeads(runId, userId);
    send("snapshot", {
      run: initialRun,
      counts: initialCounts,
      leads: initialLeads,
    });

    if (isTerminal(initialRun.status)) {
      close();
      return;
    }

    while (!signal.aborted) {
      await wait(POLL_INTERVAL_MS, signal);
      if (signal.aborted) break;

      try {
        const [runRow] = await db
          .select()
          .from(runs)
          .where(and(eq(runs.id, runId), eq(runs.userId, userId)))
          .limit(1);
        if (!runRow) {
          send("error", { message: "Run wurde geloescht." });
          break;
        }

        const counts = await countByStatus(runId, userId);
        const recentEvents = await listRecentLeadEvents(runId, userId);

        send("tick", {
          runStatus: runRow.status,
          counts,
          recentEvents,
        });

        if (isTerminal(runRow.status)) {
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

function isTerminal(status: string): boolean {
  return status === "completed" || status === "failed" || status === "cancelled";
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

async function listAllLeads(runId: string, userId: string) {
  const rows = await db
    .select({ lead: leads })
    .from(leads)
    .innerJoin(runs, eq(runs.id, leads.runId))
    .where(and(eq(leads.runId, runId), eq(runs.userId, userId)))
    .orderBy(leads.rowIndex);
  return rows.map((r) => projectLead(r.lead));
}

async function listRecentLeadEvents(runId: string, userId: string) {
  const rows = await db
    .select({ lead: leads })
    .from(leads)
    .innerJoin(runs, eq(runs.id, leads.runId))
    .where(and(eq(leads.runId, runId), eq(runs.userId, userId)))
    .orderBy(desc(leads.completedAt), desc(leads.startedAt))
    .limit(RECENT_LIMIT);
  return rows.map((r) => projectLead(r.lead));
}

function projectLead(l: typeof leads.$inferSelect) {
  return {
    id: l.id,
    rowIndex: l.rowIndex,
    status: l.status,
    slug: l.slug,
    videoUrl: l.videoUrl,
    pdfUrl: l.pdfUrl,
    thumbnailUrl: l.thumbnailUrl,
    errorMessage: l.errorMessage,
    completedAt: l.completedAt,
    data: l.data,
  };
}
