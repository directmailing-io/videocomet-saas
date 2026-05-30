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
import { and, eq, lt, inArray, sql } from "drizzle-orm";
import { pipelineWorker, pipelineQueue } from "./queue";
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
import { db } from "@/lib/db";
import { leads, runs } from "@/lib/db/schema";
import type { LeadJobData } from "./types";
import type { Job } from "bullmq";

/**
 * Findet Leads die seit >5 min in 'rendering'/'uploading' hängen
 * (Worker-Crash, Container-Restart mid-pipeline) und re-enqueued sie.
 * Wird beim Boot + alle 2 min ausgeführt.
 */
async function stuckLeadRecovery(): Promise<void> {
  const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
  // Hole alle stuck leads UND ihre Run-Daten in einem Query.
  const stuck = await db
    .select({
      id: leads.id,
      runId: leads.runId,
      userId: runs.userId,
      campaignId: runs.campaignId,
    })
    .from(leads)
    .innerJoin(runs, eq(runs.id, leads.runId))
    .where(
      and(
        inArray(leads.status, ["rendering", "uploading"]),
        lt(leads.startedAt, fiveMinutesAgo),
        // Nur Leads in laufenden Runden (sonst spammt das die DB)
        eq(runs.status, "generating"),
      ),
    );

  if (stuck.length === 0) return;

  // eslint-disable-next-line no-console
  console.log(
    `[worker:${WORKER_ID}] stuck-recovery: found ${stuck.length} leads stuck >5min, requeueing`,
  );

  // Status zurück auf pending, startedAt = null.
  const ids = stuck.map((s) => s.id);
  await db
    .update(leads)
    .set({
      status: "pending",
      startedAt: null,
      errorMessage: sql`COALESCE(${leads.errorMessage}, 'recovered from stuck rendering')`,
    })
    .where(inArray(leads.id, ids));

  // Re-enqueue alle stuck leads in BullMQ.
  try {
    const queue = pipelineQueue();
    await queue.addBulk(
      stuck.map((s) => ({
        name: "lead-pipeline",
        data: {
          leadId: s.id,
          runId: s.runId,
          userId: s.userId,
          campaignId: s.campaignId,
        },
      })),
    );
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`[worker:${WORKER_ID}] stuck-recovery enqueue failed:`, err);
  }
}

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

  // Stuck-Lead-Recovery: leads die in rendering/uploading hängen
  // (Worker-Crash, Container-Restart mitten in Pipeline) zurück auf
  // pending setzen + re-enqueue. Wird beim Boot ausgeführt + alle 2 min.
  await stuckLeadRecovery().catch((err) => {
    log("error", "initial stuck-recovery failed:", err);
  });
  const recoveryTimer = setInterval(() => {
    stuckLeadRecovery().catch((err) => {
      log("error", "periodic stuck-recovery failed:", err);
    });
  }, 120_000);
  recoveryTimer.unref();

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
