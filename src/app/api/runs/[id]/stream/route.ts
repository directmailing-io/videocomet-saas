export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { and, eq, gt, inArray, isNull, or } from "drizzle-orm";
import { requireUserApi } from "@/lib/auth-guard";
import { db } from "@/lib/db";
import { leads, runs, userDomains } from "@/lib/db/schema";
import { getRun } from "@/lib/db/queries/runs";
import { countByStatus } from "@/lib/db/queries/leads";
import {
  listPipelineEvents,
  listPipelineEventsSinceTs,
  type PipelineEvent,
} from "@/lib/db/queries/pipeline-events";
import { createSSEResponse } from "@/lib/sse";

const POLL_INTERVAL_MS = 1500;
const CHANGED_LEAD_LIMIT = 200;
const INITIAL_EVENT_LIMIT = 200;
const TICK_EVENT_LIMIT = 50;
const IN_FLIGHT_STATUSES = ["rendering", "uploading"] as const;

/**
 * GET /api/runs/[id]/stream
 *
 * Server-Sent Events stream that pushes:
 *   - `snapshot` once on connect: { run, counts, leads, pipelineEvents }
 *   - `tick`     every POLL_INTERVAL_MS: { runStatus, counts, recentEvents, pipelineEvents }
 *
 * `pipelineEvents` on snapshot = last 200 events of the run; on tick = only
 * events whose `ts` is newer than the cursor (set after the snapshot to the
 * latest event's ts, advanced on each tick).
 *
 * `recentEvents` on tick = every lead whose `startedAt` OR `completedAt` is
 * newer than `leadCursor` (advanced to `now()` after each tick) PLUS every
 * lead currently in an in-flight status (`rendering`, `uploading`). The
 * in-flight join catches intermediate status transitions (e.g. rendering →
 * uploading) where no timestamp gets bumped — without it the row would freeze
 * on its first-seen status until it finally completes.
 *
 * Closes the connection cleanly when the run reaches a terminal state
 * (`completed`, `failed`, or `cancelled`) — but only AFTER pushing one final
 * tick so the run-completion event surfaces in the UI.
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
    const initialEvents = await listPipelineEvents(runId, userId, {
      limit: INITIAL_EVENT_LIMIT,
    });

    // Cursor = ts of the last event we've sent. New events sent on tick have
    // ts > cursor. If there are no events yet, start cursor at run.createdAt
    // (so any event written shortly after subscribe is picked up).
    let eventCursor: Date =
      initialEvents.length > 0
        ? initialEvents[initialEvents.length - 1]!.ts
        : initialRun.createdAt;

    // Lead cursor: any lead whose startedAt OR completedAt advances past this
    // ts on a tick is re-emitted. Starts at run.createdAt so leads that begin
    // working right after subscribe are included.
    let leadCursor: Date = initialRun.createdAt;

    send("snapshot", {
      run: initialRun,
      counts: initialCounts,
      leads: initialLeads,
      pipelineEvents: initialEvents.map(projectPipelineEvent),
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
          send("error", { message: "Run wurde gelöscht." });
          break;
        }

        const tickStartedAt = new Date();
        const counts = await countByStatus(runId, userId);
        const recentEvents = await listChangedOrInFlightLeads(
          runId,
          userId,
          leadCursor,
        );
        // Advance the cursor to "now" so the next tick only picks up rows
        // that change AFTER this query window. In-flight rows are still
        // re-emitted regardless of cursor (see listChangedOrInFlightLeads).
        leadCursor = tickStartedAt;

        const newPipelineEvents = await listPipelineEventsSinceTs(
          runId,
          userId,
          eventCursor,
          TICK_EVENT_LIMIT,
        );
        if (newPipelineEvents.length > 0) {
          eventCursor = newPipelineEvents[newPipelineEvents.length - 1]!.ts;
        }

        send("tick", {
          runStatus: runRow.status,
          counts,
          recentEvents,
          pipelineEvents: newPipelineEvents.map(projectPipelineEvent),
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
    .select({ lead: leads, customHostname: userDomains.hostname })
    .from(leads)
    .innerJoin(runs, eq(runs.id, leads.runId))
    .leftJoin(userDomains, eq(userDomains.id, leads.domainId))
    // Soft-deleted Leads (z.B. preflight-rejected) NIE in den Snapshot —
    // sonst zeigt die Live-Tabelle sie als "Wartet" und der User denkt
    // das System hängt. Audit-Trail bleibt in der DB.
    .where(and(eq(leads.runId, runId), eq(runs.userId, userId), isNull(leads.removedAt)))
    .orderBy(leads.rowIndex);
  return rows.map((r) => projectLead(r.lead, r.customHostname));
}

/**
 * Returns leads that need to be re-pushed to the client this tick:
 *   1. Every lead whose `startedAt` OR `completedAt` advanced past `sinceTs`
 *      (covers transitions pending → rendering and uploading → completed/failed).
 *   2. Every lead currently in an in-flight status (`rendering`, `uploading`)
 *      so the row reflects status flips that don't bump any timestamp
 *      (e.g. rendering → uploading mid-pipeline).
 *
 * Bounded by CHANGED_LEAD_LIMIT as a safety cap. With typical worker
 * concurrency the result is a handful of rows per tick.
 */
async function listChangedOrInFlightLeads(
  runId: string,
  userId: string,
  sinceTs: Date,
) {
  const rows = await db
    .select({ lead: leads, customHostname: userDomains.hostname })
    .from(leads)
    .innerJoin(runs, eq(runs.id, leads.runId))
    .leftJoin(userDomains, eq(userDomains.id, leads.domainId))
    .where(
      and(
        eq(leads.runId, runId),
        eq(runs.userId, userId),
        isNull(leads.removedAt),
        or(
          gt(leads.startedAt, sinceTs),
          gt(leads.completedAt, sinceTs),
          inArray(leads.status, [...IN_FLIGHT_STATUSES]),
        ),
      ),
    )
    .orderBy(leads.rowIndex)
    .limit(CHANGED_LEAD_LIMIT);
  return rows.map((r) => projectLead(r.lead, r.customHostname));
}

function projectLead(
  l: typeof leads.$inferSelect,
  customHostname: string | null,
) {
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
    envelopePdfUrl: l.envelopePdfUrl,
    data: l.data,
    viewCount: l.viewCount,
    firstViewedAt: l.firstViewedAt,
    lastViewedAt: l.lastViewedAt,
    playCount: l.playCount,
    watchTimeSec: l.watchTimeSec,
    ctaClickCount: l.ctaClickCount,
    lastCtaAt: l.lastCtaAt,
    /** Hostname der Custom-Domain (NULL = Default app.videocomet.de). */
    customHostname,
  };
}

function projectPipelineEvent(e: PipelineEvent) {
  return {
    id: e.id,
    runId: e.runId,
    leadId: e.leadId,
    ts: e.ts instanceof Date ? e.ts.toISOString() : e.ts,
    level: e.level,
    stage: e.stage,
    message: e.message,
    durationMs: e.durationMs,
  };
}
