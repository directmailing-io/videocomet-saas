/**
 * Preflight-Worker bootstrap.
 *
 * Instantiates the BullMQ worker that consumes the `lead-preflight` queue
 * and wires it up to `processPreflightJob`. Exported as a single function
 * so the worker entry point (`src/worker/index.ts`) can call it during
 * boot without this file growing its own side-effect-on-import behaviour.
 *
 * The processor is INTENTIONALLY a thin wrapper here: heavy logic lives in
 * `processors/preflight.ts`. This file owns only:
 *   - error/failure event logging
 *   - the "ready" log line so operators see the worker came up
 *   - per-job wall-clock logging (start/done) for grep-ability
 */

import type { Job, Worker } from "bullmq";
import { preflightWorker } from "./queue";
import { processPreflightJob } from "./processors/preflight";
import type { PreflightJobData } from "./types";

/**
 * Boots the Phase-1 Preflight worker. Returns the BullMQ `Worker` instance
 * so the caller can register it on the shutdown path (await worker.close()
 * during SIGTERM handling) — see `src/worker/index.ts`.
 *
 * Concurrency is sourced from `PREFLIGHT_WORKER_CONCURRENCY` (default 24)
 * via `preflightWorker()`.
 */
export function bootPreflightWorker(): Worker<PreflightJobData> {
  const worker = preflightWorker(async (job: Job<PreflightJobData>) => {
    const startedAt = Date.now();
    // eslint-disable-next-line no-console
    console.log(
      `[preflight] start job=${job.id} lead=${job.data.leadId} run=${job.data.runId}`,
    );
    try {
      await processPreflightJob(job);
      // eslint-disable-next-line no-console
      console.log(
        `[preflight] done  job=${job.id} lead=${job.data.leadId} (${Date.now() - startedAt}ms)`,
      );
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(
        `[preflight] fail  job=${job.id} lead=${job.data.leadId}:`,
        err instanceof Error ? err.message : err,
      );
      throw err;
    }
  });

  worker.on("failed", (job, err) => {
    // eslint-disable-next-line no-console
    console.error(
      `[preflight] job ${job?.id} (lead=${job?.data?.leadId}) failed:`,
      err?.message,
    );
  });

  worker.on("error", (err) => {
    // eslint-disable-next-line no-console
    console.error("[preflight] worker error:", err.message);
  });

  // Single line so logs are easy to grep on container boot.
  // eslint-disable-next-line no-console
  console.log("[preflight] ready (concurrency=24)");

  return worker;
}
