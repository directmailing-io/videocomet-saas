/**
 * User-Fairness beim Enqueue (Skalierungs-Phase 1, 2026-08-19).
 *
 * Problem: `leadJobPriority` = rowIndex sorgt zwar dafür, dass die ersten
 * Leads JEDES Runs früh laufen — aber ein User mit 3 parallelen Runs bekommt
 * pro Prioritätsstufe 3 Slots, ein User mit 1 Run nur 1. Lösung: die
 * Priorität eines neuen Runs wird um den offenen Render-Backlog der ANDEREN
 * laufenden Runs desselben Users verschoben. Effekt: die eigenen Runs eines
 * Users laufen quasi nacheinander, fremde User interleaven weiter vorne.
 *
 * Der Offset wird pro Enqueue-Batch EINMAL gezählt (billige indexierte
 * COUNT-Query) und ist bewusst eine Momentaufnahme — Recovery-Re-Enqueues
 * zählen frisch und sind damit automatisch adaptiv.
 */

import { and, eq, inArray, isNull, lt, ne, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { leads, runs } from "@/lib/db/schema";
import { MAX_BULLMQ_PRIORITY } from "@/lib/queue-priority";

/** Lead-Status, die noch Render-Arbeit vor sich haben. */
const OPEN_LEAD_STATUSES = ["pending", "rendering", "uploading"] as const;

/**
 * Zählt die offenen Leads in ÄLTEREN `generating`-Runs desselben Users
 * (startedAt vor dem eigenen Run). Nur ältere Runs zählen — sonst würden
 * sich zwei parallele Runs beim adaptiven Re-Enqueue (Intro-Pfad) gegen-
 * seitig als Backlog sehen und die Reihenfolge ping-pongen.
 *
 * Fehler (z.B. DB kurz weg) degradieren zu Offset 0 — Enqueue darf daran
 * nie scheitern, dann gilt einfach wieder reine rowIndex-Fairness.
 */
export async function countUserRenderBacklog(
  userId: string,
  excludeRunId: string,
): Promise<number> {
  try {
    const [own] = await db
      .select({ startedAt: runs.startedAt })
      .from(runs)
      .where(eq(runs.id, excludeRunId))
      .limit(1);
    const ownStart = own?.startedAt ?? null;
    const [row] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(leads)
      .innerJoin(runs, eq(leads.runId, runs.id))
      .where(
        and(
          eq(runs.userId, userId),
          eq(runs.status, "generating"),
          ne(runs.id, excludeRunId),
          isNull(runs.deletedAt),
          isNull(leads.removedAt),
          inArray(leads.status, [...OPEN_LEAD_STATUSES]),
          // Ohne eigenen startedAt (sollte nicht vorkommen) zählen alle
          // anderen generating-Runs — konservativ, aber stabil.
          ...(ownStart ? [lt(runs.startedAt, ownStart)] : []),
        ),
      );
    return row?.n ?? 0;
  } catch {
    return 0;
  }
}

/**
 * Priorität = eigener Backlog + Zeilen-Reihenfolge. Kleinere Zahl = früher
 * dran (BullMQ); Cap bei 2^21 (BullMQ-Hard-Limit).
 */
export function fairLeadPriority(
  rowIndex: number | null | undefined,
  userBacklog: number,
): number {
  const idx =
    typeof rowIndex === "number" && Number.isFinite(rowIndex) && rowIndex >= 0
      ? rowIndex
      : 0;
  const backlog =
    Number.isFinite(userBacklog) && userBacklog > 0 ? Math.floor(userBacklog) : 0;
  return Math.min(backlog + idx + 1, MAX_BULLMQ_PRIORITY);
}
