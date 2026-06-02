import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { leads, runs } from "@/lib/db/schema";

/**
 * Erlaubte Run-Status-Übergänge für die Preflight-Pipeline.
 *
 *   draft              → preflighting
 *   preflighting       → awaiting_approval | cancelled
 *   awaiting_approval  → approved | cancelled
 *   approved           → generating | cancelled  (Phase-2-Trigger)
 *   ANY (alive)        → cancelled
 *   failed             → preflighting           (Retry-Pfad)
 *
 * Terminale Stati (completed | failed | cancelled) sind nicht mehr
 * verlassbar, ausser `failed → preflighting` für expliziten User-Retry.
 */
const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  draft: ["preflighting", "cancelled"],
  mapping: ["preflighting", "cancelled"],
  preflighting: ["awaiting_approval", "cancelled", "failed"],
  awaiting_approval: ["approved", "cancelled"],
  approved: ["generating", "cancelled"],
  generating: ["completed", "failed", "cancelled"],
  failed: ["preflighting", "cancelled"],
  completed: [],
  cancelled: [],
};

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

// ───────────────────────────────────────────────────────────────────────────
// ── Preflight ─────────────────────────────────────────────────────────────
// ───────────────────────────────────────────────────────────────────────────

/** Alias für den vollen Run-Status (inkl. Preflight-Stati aus Migration 0006). */
export type ExtendedRunStatus = Run["status"];

/**
 * Setzt den Run-Status guarded: das UPDATE schlägt nur durch, wenn der aktuell
 * gespeicherte Status zu den als erlaubt deklarierten Vorgänger-Stati gehört.
 * Damit ist die Transition atomar (optimistic concurrency control) — selbst
 * wenn zwei Requests gleichzeitig denselben Run vorantreiben wollen, gewinnt
 * nur einer.
 *
 * Liefert `{ ok: false, currentStatus }` zurück, wenn die Transition nicht
 * erlaubt war ODER der Run nicht zum User gehört (Tenant-Guard).
 */
export async function setRunStatus(
  runId: string,
  userId: string,
  newStatus: ExtendedRunStatus,
  additional?: Partial<UpdateRunPatch>,
): Promise<
  | { ok: true; run: Run }
  | { ok: false; currentStatus: ExtendedRunStatus | null }
> {
  // Liste der Vorgänger-Stati, von denen aus die neue Status erlaubt ist.
  const validPredecessors = Object.entries(ALLOWED_TRANSITIONS)
    .filter(([, targets]) => targets.includes(newStatus))
    .map(([from]) => from);

  // cancelled darf von jedem nicht-terminalen Status aus erreicht werden —
  // bauen wir auch ohne explizite Tabelle an, damit Cancel immer zieht.
  const predecessors =
    newStatus === "cancelled"
      ? Array.from(
          new Set([
            ...validPredecessors,
            "draft",
            "mapping",
            "preflighting",
            "awaiting_approval",
            "approved",
            "generating",
          ]),
        )
      : validPredecessors;

  if (predecessors.length === 0) {
    // Niemand darf in den neuen Status springen — Schema-Bug.
    const [cur] = await db
      .select({ status: runs.status })
      .from(runs)
      .where(and(eq(runs.id, runId), eq(runs.userId, userId)))
      .limit(1);
    return { ok: false, currentStatus: (cur?.status as ExtendedRunStatus) ?? null };
  }

  const [updated] = await db
    .update(runs)
    .set({ status: newStatus, ...(additional ?? {}) })
    .where(
      and(
        eq(runs.id, runId),
        eq(runs.userId, userId),
        inArray(runs.status, predecessors as Run["status"][]),
      ),
    )
    .returning();

  if (updated) return { ok: true, run: updated };

  // Update hat nicht gegriffen — entweder Tenant-Mismatch oder Status passt nicht.
  const [cur] = await db
    .select({ status: runs.status })
    .from(runs)
    .where(and(eq(runs.id, runId), eq(runs.userId, userId)))
    .limit(1);
  return { ok: false, currentStatus: (cur?.status as ExtendedRunStatus) ?? null };
}

/**
 * Liest einen Run inkl. der Preflight-Counter (approved / rejected / failed).
 * Wrapper um `getRun`, der das Result als ungeschachteltes Object liefert —
 * macht den API-Code lesbarer und vermeidet doppelte SELECTs.
 */
export async function getRunForPreflight(
  runId: string,
  userId: string,
): Promise<Run> {
  return getRun(runId, userId);
}

/**
 * Inkrementiert/setzt die Preflight-Aggregat-Counter auf einem Run.
 * Wird vom Approve-/Reject-Endpoint nach der eigentlichen DB-Mutation
 * aufgerufen, damit das UI die Zähler ohne separaten COUNT(*) lesen kann.
 *
 * Werte werden SET (nicht incrementiert), weil der Caller die echten
 * Zähler aus dem Update-Result kennt und Race-Conditions damit unmöglich
 * sind (es gibt genau einen "Approve"-Aufruf pro Run).
 */
export async function updateRunCounts(
  runId: string,
  userId: string,
  counts: {
    approvedLeadCount?: number;
    rejectedLeadCount?: number;
    preflightFailedCount?: number;
  },
): Promise<Run> {
  const patch: UpdateRunPatch = {};
  if (counts.approvedLeadCount !== undefined) {
    patch.approvedLeadCount = counts.approvedLeadCount;
  }
  if (counts.rejectedLeadCount !== undefined) {
    patch.rejectedLeadCount = counts.rejectedLeadCount;
  }
  if (counts.preflightFailedCount !== undefined) {
    patch.preflightFailedCount = counts.preflightFailedCount;
  }
  return updateRun(runId, userId, patch);
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
