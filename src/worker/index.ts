/**
 * Worker entry point.
 *
 * Boots dotenv, starts the DB-heartbeat loop, and wires the BullMQ worker
 * to the pipeline orchestrator. Concurrency is read from `WORKER_CONCURRENCY`
 * (default 4).
 *
 * Graceful shutdown on SIGTERM/SIGINT:
 *   1. stop accepting new jobs
 *   2. wait for in-flight jobs to finish
 *   3. close browser pool
 *   4. stop heartbeat
 *   5. exit
 */

import "dotenv/config";
import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { pipelineWorker } from "./queue";
import { screenshotWorker, type ScreenshotJobData } from "./screenshot-queue";
import { pipelineProcessor } from "./processors/pipeline";
import { screenshotProcessor } from "./processors/screenshot";
import { closeBrowserPool } from "./lib/browser-pool";
import {
  startHeartbeat,
  stopHeartbeat,
  incrementInFlight,
  decrementInFlight,
} from "./lib/heartbeat";
import type { LeadJobData } from "./types";
import type { Job } from "bullmq";

const WORKER_ID = `${hostname()}-${randomUUID().slice(0, 8)}`;

function log(level: "info" | "warn" | "error", msg: string, extra?: unknown): void {
  // eslint-disable-next-line no-console
  const fn = level === "error" ? console.error : level === "warn" ? console.warn : console.log;
  if (extra) fn(`[worker:${WORKER_ID}] ${msg}`, extra);
  else fn(`[worker:${WORKER_ID}] ${msg}`);
}

async function main(): Promise<void> {
  log("info", "booting…");
  startHeartbeat(WORKER_ID);

  const worker = pipelineWorker(async (job: Job<LeadJobData>) => {
    incrementInFlight();
    try {
      log("info", `start job=${job.id} lead=${job.data.leadId}`);
      const result = await pipelineProcessor(job);
      log("info", `done  job=${job.id} lead=${job.data.leadId}`);
      return result;
    } catch (err) {
      log("error", `fail  job=${job?.id} lead=${job?.data?.leadId}`, err);
      throw err;
    } finally {
      decrementInFlight();
    }
  });

  worker.on("failed", (job, err) => {
    log("error", `job ${job?.id} failed:`, err?.message);
  });
  worker.on("error", (err) => {
    log("error", "worker error:", err.message);
  });

  // Screenshot worker — runs in the same process so it shares the same
  // browser pool. Concurrency is controlled separately via
  // SCREENSHOT_WORKER_CONCURRENCY (default 2).
  const screenshotW = screenshotWorker(async (job: Job<ScreenshotJobData>) => {
    incrementInFlight();
    try {
      log("info", `screenshot start job=${job.id} screenshotJob=${job.data.jobId}`);
      const result = await screenshotProcessor(job);
      log("info", `screenshot done  job=${job.id} screenshotJob=${job.data.jobId}`);
      return result;
    } catch (err) {
      log(
        "error",
        `screenshot fail  job=${job?.id} screenshotJob=${job?.data?.jobId}`,
        err,
      );
      throw err;
    } finally {
      decrementInFlight();
    }
  });

  screenshotW.on("failed", (job, err) => {
    log("error", `screenshot job ${job?.id} failed:`, err?.message);
  });
  screenshotW.on("error", (err) => {
    log("error", "screenshot worker error:", err.message);
  });

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    log("info", `received ${signal}, shutting down…`);
    try {
      await worker.close(); // waits for in-flight jobs
    } catch (err) {
      log("error", "worker close failed:", err);
    }
    try {
      await screenshotW.close();
    } catch (err) {
      log("error", "screenshot worker close failed:", err);
    }
    try {
      await closeBrowserPool();
    } catch (err) {
      log("error", "browser pool shutdown failed:", err);
    }
    stopHeartbeat();
    log("info", "bye.");
    process.exit(0);
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));

  log("info", "ready.");
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(`[worker:${WORKER_ID}] fatal:`, err);
  process.exit(1);
});
