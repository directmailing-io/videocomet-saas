/**
 * DB-heartbeat for live worker visibility.
 *
 * Every 30 seconds we UPSERT into `worker_heartbeats` so the admin dashboard
 * can show which workers are alive (and how busy they are). `currentJobs`
 * is read from a shared counter the pipeline orchestrator increments /
 * decrements at job-start / job-end.
 *
 * In addition to the DB row, this module exposes a process-local
 * `getWorkerHealth()` snapshot consumed by the in-process healthcheck
 * endpoint (Agent A). It tracks the most recent successful job completion
 * timestamp so an external probe can detect a "wedged" worker (alive
 * heartbeat, but no jobs finishing).
 */

import { hostname } from "node:os";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { workerHeartbeats } from "@/lib/db/schema";

let interval: NodeJS.Timeout | null = null;
let inFlight = 0;
let currentWorkerId: string | null = null;
const startedAt: Date = new Date();
let lastJobCompletedAt: Date | null = null;
let lastHeartbeatAt: Date | null = null;

export function incrementInFlight(): void {
  inFlight += 1;
}
export function decrementInFlight(): void {
  inFlight = Math.max(0, inFlight - 1);
}

/**
 * Records that a job just finished (success OR failure). Called from the
 * pipeline orchestrator after a job leaves the in-flight set so the
 * healthcheck can detect "alive but not processing" wedges.
 */
export function markJobCompleted(): void {
  lastJobCompletedAt = new Date();
}

export interface WorkerHealthSnapshot {
  /** stable worker id passed to startHeartbeat (null before init). */
  id: string | null;
  /** seconds since this process booted. */
  uptime: number;
  /** in-flight job counter (incremented at job start, decremented at end). */
  inFlight: number;
  /** ISO timestamp of the last job that finished (success or failure). */
  lastJobCompletedAt: string | null;
  /** ISO timestamp of the last successful DB heartbeat upsert. */
  lastHeartbeatAt: string | null;
}

/**
 * Returns a process-local snapshot of worker health. Cheap, sync, never
 * throws — safe to call from a healthcheck handler on every request.
 */
export function getWorkerHealth(): WorkerHealthSnapshot {
  return {
    id: currentWorkerId,
    uptime: Math.floor((Date.now() - startedAt.getTime()) / 1000),
    inFlight,
    lastJobCompletedAt: lastJobCompletedAt
      ? lastJobCompletedAt.toISOString()
      : null,
    lastHeartbeatAt: lastHeartbeatAt ? lastHeartbeatAt.toISOString() : null,
  };
}

async function writeHeartbeat(workerId: string): Promise<void> {
  try {
    await db
      .insert(workerHeartbeats)
      .values({
        workerId,
        hostname: hostname(),
        capabilities: ["video", "pdf"],
        currentJobs: inFlight,
        lastSeenAt: new Date(),
      })
      .onConflictDoUpdate({
        target: workerHeartbeats.workerId,
        set: {
          hostname: hostname(),
          currentJobs: inFlight,
          lastSeenAt: sql`now()`,
        },
      });
    lastHeartbeatAt = new Date();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[worker:heartbeat] write failed:", err);
  }
}

/**
 * Starts the heartbeat loop. Fires once immediately and then every 30s.
 * Returns a stop function for graceful shutdown.
 */
export function startHeartbeat(workerId: string): () => void {
  if (interval) {
    return () => stopHeartbeat();
  }
  currentWorkerId = workerId;
  void writeHeartbeat(workerId);
  interval = setInterval(() => {
    void writeHeartbeat(workerId);
  }, 30_000);
  return () => stopHeartbeat();
}

export function stopHeartbeat(): void {
  if (interval) {
    clearInterval(interval);
    interval = null;
  }
}
