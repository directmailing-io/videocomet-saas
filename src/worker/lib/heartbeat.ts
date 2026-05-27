/**
 * DB-heartbeat for live worker visibility.
 *
 * Every 30 seconds we UPSERT into `worker_heartbeats` so the admin dashboard
 * can show which workers are alive (and how busy they are). `currentJobs`
 * is read from a shared counter the pipeline orchestrator increments /
 * decrements at job-start / job-end.
 */

import { hostname } from "node:os";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { workerHeartbeats } from "@/lib/db/schema";

let interval: NodeJS.Timeout | null = null;
let inFlight = 0;

export function incrementInFlight(): void {
  inFlight += 1;
}
export function decrementInFlight(): void {
  inFlight = Math.max(0, inFlight - 1);
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
