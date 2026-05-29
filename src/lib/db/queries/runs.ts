import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { leads, runs } from "@/lib/db/schema";

export type Run = typeof runs.$inferSelect;
export type NewRun = typeof runs.$inferInsert;

export type CreateRunInput = Omit<NewRun, "id" | "userId" | "createdAt">;

export type UpdateRunPatch = Partial<Omit<Run, "id" | "userId" | "createdAt">>;

export async function createRun(userId: string, input: CreateRunInput): Promise<Run> {
  const [row] = await db
    .insert(runs)
    .values({ ...input, userId })
    .returning();
  if (!row) throw new Error("Failed to create run");
  return row;
}

export async function updateRun(
  id: string,
  userId: string,
  patch: UpdateRunPatch,
): Promise<Run> {
  const [row] = await db
    .update(runs)
    .set(patch)
    .where(and(eq(runs.id, id), eq(runs.userId, userId)))
    .returning();
  if (!row) throw new Error("Not found");
  return row;
}

/**
 * Setzt den Run-Status auf "completed", wenn ALLE Leads einen terminalen
 * Status haben (completed oder failed) und der Run noch nicht abgeschlossen
 * ist. Idempotent: mehrere Calls sind sicher (UPDATE-WHERE-Filter blockt
 * Doppel-Schreibungen).
 *
 * Wird vom Worker am Ende jedes Lead-Jobs aufgerufen, weil es im aktuellen
 * Pipeline-Setup keinen separaten "Run-Finalizer"-Job gibt.
 */
export async function finalizeRunIfAllLeadsDone(runId: string): Promise<{
  finalized: boolean;
  total: number;
  done: number;
}> {
  const rows = (await db.execute(sql`
    SELECT
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE ${leads.status} IN ('completed', 'failed'))::int AS done
    FROM ${leads}
    WHERE ${leads.runId} = ${runId}
  `)) as unknown as Array<{ total: number; done: number }>;
  const r = Array.isArray(rows) ? rows[0] : (rows as { rows?: Array<{ total: number; done: number }> }).rows?.[0];
  const total = Number(r?.total ?? 0);
  const done = Number(r?.done ?? 0);
  if (total === 0 || done < total) {
    return { finalized: false, total, done };
  }
  const result = await db
    .update(runs)
    .set({ status: "completed", completedAt: new Date() })
    .where(
      and(
        eq(runs.id, runId),
        sql`${runs.status} NOT IN ('completed', 'failed', 'cancelled')`,
      ),
    )
    .returning({ id: runs.id });
  return { finalized: result.length > 0, total, done };
}

export async function deleteRun(id: string, userId: string): Promise<void> {
  const result = await db
    .delete(runs)
    .where(and(eq(runs.id, id), eq(runs.userId, userId)))
    .returning({ id: runs.id });
  if (result.length === 0) throw new Error("Not found");
}

export async function getRun(id: string, userId: string): Promise<Run> {
  const [row] = await db
    .select()
    .from(runs)
    .where(and(eq(runs.id, id), eq(runs.userId, userId)))
    .limit(1);
  if (!row) throw new Error("Not found");
  return row;
}

export async function listCampaignRuns(
  campaignId: string,
  userId: string,
): Promise<Run[]> {
  return db
    .select()
    .from(runs)
    .where(and(eq(runs.campaignId, campaignId), eq(runs.userId, userId)))
    .orderBy(desc(runs.createdAt));
}

/**
 * Returns runs joined with live per-status counts from the `leads` table.
 * We compute completed/failed via correlated subqueries because the cached
 * counters on `runs` (completed_leads, failed_leads) lag behind worker
 * updates in practice and would render a 0% bar even when leads are done.
 */
export interface RunWithCounts {
  id: string;
  campaignId: string;
  name: string;
  status: Run["status"];
  totalLeads: number;
  completedLeads: number;
  failedLeads: number;
  startedAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
}

export async function listCampaignRunsWithCounts(
  campaignId: string,
  userId: string,
): Promise<RunWithCounts[]> {
  const rows = await db
    .select({
      id: runs.id,
      campaignId: runs.campaignId,
      name: runs.name,
      status: runs.status,
      totalLeads: runs.totalLeads,
      startedAt: runs.startedAt,
      completedAt: runs.completedAt,
      createdAt: runs.createdAt,
      liveCompleted: sql<number>`(
        SELECT COUNT(*)::int FROM ${leads}
        WHERE ${leads.runId} = ${runs.id} AND ${leads.status} = 'completed'
      )`,
      liveFailed: sql<number>`(
        SELECT COUNT(*)::int FROM ${leads}
        WHERE ${leads.runId} = ${runs.id} AND ${leads.status} = 'failed'
      )`,
    })
    .from(runs)
    .where(and(eq(runs.campaignId, campaignId), eq(runs.userId, userId)))
    .orderBy(desc(runs.createdAt));

  return rows.map((r) => ({
    id: r.id,
    campaignId: r.campaignId,
    name: r.name,
    status: r.status,
    totalLeads: r.totalLeads,
    // Live counts are authoritative; the cached counters on `runs` are a
    // denormalization that the workers update best-effort.
    completedLeads: r.liveCompleted ?? 0,
    failedLeads: r.liveFailed ?? 0,
    startedAt: r.startedAt,
    completedAt: r.completedAt,
    createdAt: r.createdAt,
  }));
}
