/**
 * Pipeline-Event-Queries.
 *
 * Append-only Log für den Live-Log im Run-Detail-UI. Worker schreiben
 * Stage-Start/Stop/Fehler-Events; das SSE-Stream-Endpoint liest sie und
 * pushed neue Events alle 2s in den Client.
 */

import { and, asc, eq, gt, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { pipelineEvents, runs } from "@/lib/db/schema";

export type PipelineEvent = typeof pipelineEvents.$inferSelect;
export type PipelineEventLevel = "info" | "warn" | "error";

export interface InsertPipelineEventInput {
  runId: string;
  leadId?: string | null;
  level: PipelineEventLevel;
  stage: string;
  message: string;
  durationMs?: number | null;
}

/**
 * Schreibt ein Pipeline-Event. Fehlersicher: Wirft NIE, damit ein Log-Schreib-
 * Fehler den Worker-Job nicht abbricht. Stattdessen wird der Fehler per
 * console.warn protokolliert.
 *
 * `message` wird auf 2000 Zeichen begrenzt, damit ein voll ausgegebener Stack-
 * Trace nicht die Tabelle aufblaeht.
 */
export async function insertPipelineEvent(
  input: InsertPipelineEventInput,
): Promise<void> {
  try {
    const message =
      typeof input.message === "string" && input.message.length > 2000
        ? input.message.slice(0, 2000)
        : input.message;
    await db.insert(pipelineEvents).values({
      runId: input.runId,
      leadId: input.leadId ?? null,
      level: input.level,
      stage: input.stage,
      message,
      durationMs: input.durationMs ?? null,
    });
  } catch (err) {
    console.warn(
      `[pipeline-events] insert failed for run=${input.runId}:`,
      err instanceof Error ? err.message : err,
    );
  }
}

export interface ListPipelineEventsOptions {
  sinceTs?: Date;
  limit?: number;
}

/**
 * Listet Pipeline-Events für einen Run, mit Tenant-Guard via runs.userId.
 * Bei `sinceTs` werden nur Events mit `ts > sinceTs` zurückgegeben (für den
 * SSE-Tick-Cursor). Default-Limit 200, Maximum 1000.
 */
export async function listPipelineEvents(
  runId: string,
  userId: string,
  opts: ListPipelineEventsOptions = {},
): Promise<PipelineEvent[]> {
  const limit = Math.min(Math.max(opts.limit ?? 200, 1), 1000);

  const whereParts = [
    eq(pipelineEvents.runId, runId),
    eq(runs.userId, userId),
  ];
  if (opts.sinceTs) {
    whereParts.push(gt(pipelineEvents.ts, opts.sinceTs));
  }

  const rows = await db
    .select({ event: pipelineEvents })
    .from(pipelineEvents)
    .innerJoin(runs, eq(runs.id, pipelineEvents.runId))
    .where(and(...whereParts))
    .orderBy(asc(pipelineEvents.ts))
    .limit(limit);

  return rows.map((r) => r.event);
}

/**
 * Convenience: liefert die `n` aeltesten Events seit `sinceTs`. Wird vom
 * SSE-Tick verwendet, der einen Cursor mitfuehrt.
 */
export async function listPipelineEventsSinceTs(
  runId: string,
  userId: string,
  sinceTs: Date,
  limit = 50,
): Promise<PipelineEvent[]> {
  return listPipelineEvents(runId, userId, { sinceTs, limit });
}

/**
 * Loescht alle Pipeline-Events eines Runs (z.B. wenn die Runde komplett
 * neu generiert wird und der bisherige Log irrefuehrend waere). Tenant-
 * Guard via runs.userId.
 */
export async function deletePipelineEventsForRun(
  runId: string,
  userId: string,
): Promise<void> {
  await db.execute(sql`
    DELETE FROM ${pipelineEvents}
    WHERE ${pipelineEvents.runId} = ${runId}
      AND EXISTS (
        SELECT 1 FROM ${runs}
        WHERE ${runs.id} = ${runId} AND ${runs.userId} = ${userId}
      )
  `);
}
