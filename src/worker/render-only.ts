/**
 * Render-only Worker-Entry (Skalierung Stufe 1, 2026-08-19).
 *
 * Läuft auf dem zweiten Server (CX53) und bootet AUSSCHLIESSLICH den
 * lead-pipeline-Worker: reine Chromium/ffmpeg-Rechenlast, die horizontal
 * skaliert. Alle Singleton-Jobs (Recovery-Loops, Domain-Verifier, Bunny-
 * Purger/Reconciler, E-Mail-Drip, Preflight-, Intro-, Screenshot-Worker …)
 * bleiben exklusiv beim Haupt-Worker — doppelt laufende Wartungsjobs
 * würden sich gegenseitig in die Quere kommen, und der Domain-Verifier
 * braucht Traefik-Mounts, die es hier nicht gibt.
 *
 * Aktiviert über WORKER_ROLE=render (siehe scripts/start-worker.ts).
 */

import "dotenv/config";
import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import type { Job } from "bullmq";
import { pipelineWorker } from "./queue";
import { pipelineProcessor } from "./processors/pipeline";
import { closeBrowserPool } from "./lib/browser-pool";
import {
  startHeartbeat,
  stopHeartbeat,
  incrementInFlight,
  decrementInFlight,
} from "./lib/heartbeat";
import type { LeadJobData } from "./types";

const WORKER_ID = `render-${hostname()}-${randomUUID().slice(0, 8)}`;

function log(level: "info" | "error", msg: string, extra?: unknown): void {
  const fn = level === "error" ? console.error : console.log;
  if (extra) fn(`[worker:${WORKER_ID}] ${msg}`, extra);
  else fn(`[worker:${WORKER_ID}] ${msg}`);
}

// Muss mit dem Haupt-Worker übereinstimmen (src/worker/index.ts) — die
// Stuck-Recovery dort geht von 20 min Hard-Timeout aus (21-min-Schwelle).
const PIPELINE_HARD_TIMEOUT_MS = Number(
  process.env.PIPELINE_HARD_TIMEOUT_MS ?? String(20 * 60 * 1000),
);

async function main(): Promise<void> {
  log("info", "booting (render-only)…");
  startHeartbeat(WORKER_ID);

  const worker = pipelineWorker(async (job: Job<LeadJobData>) => {
    incrementInFlight();
    try {
      log("info", `start job=${job.id} lead=${job.data.leadId}`);
      const result = await Promise.race([
        pipelineProcessor(job),
        new Promise<never>((_, reject) =>
          setTimeout(
            () =>
              reject(
                new Error(
                  `[pipeline] lead exceeded ${PIPELINE_HARD_TIMEOUT_MS}ms hard timeout`,
                ),
              ),
            PIPELINE_HARD_TIMEOUT_MS,
          ),
        ),
      ]);
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

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    log("info", `received ${signal}, shutting down…`);
    // Heartbeat-Row ZUERST löschen — BullMQ-Drain kann Dockers
    // 10s-Stop-Timeout überschreiten (SIGKILL), sonst bleibt eine
    // Watchdog-Alert-Leiche in worker_heartbeats zurück.
    try {
      await stopHeartbeat();
    } catch (err) {
      log("error", "heartbeat stop failed:", err);
    }
    try {
      await worker.close(); // waits for in-flight jobs
    } catch (err) {
      log("error", "worker close failed:", err);
    }
    try {
      await closeBrowserPool();
    } catch (err) {
      log("error", "browser pool shutdown failed:", err);
    }
    log("info", "bye.");
    process.exit(0);
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));

  log("info", "ready (render-only).");
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(`[worker:${WORKER_ID}] fatal:`, err);
  process.exit(1);
});
