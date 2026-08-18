/**
 * BullMQ queue setup for the lead render pipeline.
 *
 * The single queue `lead-pipeline` orchestrates all 10 stages per lead. Each
 * stage is implemented as a child function called from the orchestrator
 * (see `processors/pipeline.ts`). Keeping the stages in one job avoids
 * "thundering herd" effects between rapid sub-jobs and lets us cleanly
 * cancel a single Lead.
 */

import { Queue, Worker, type ConnectionOptions, type Processor } from "bullmq";
import IORedis from "ioredis";
import type { LeadJobData, PreflightJobData } from "./types";

const QUEUE_NAME = "lead-pipeline";
const PREFLIGHT_QUEUE_NAME = "lead-preflight";

let redisConnection: IORedis | null = null;

function getRedisUrl(): string {
  const url = process.env.REDIS_URL;
  if (!url) {
    throw new Error("[worker] REDIS_URL is required");
  }
  return url;
}

/**
 * Lazily creates a shared IORedis connection. BullMQ requires
 * `maxRetriesPerRequest: null` for blocking commands; we also wire a
 * basic exponential retry strategy so brief redis hiccups don't kill us.
 *
 * Connection knobs:
 *  - `connectTimeout: 10s` — fail fast if Redis is unreachable instead
 *    of hanging the worker boot indefinitely (Coolify will restart the
 *    container and surface the error).
 *  - `enableOfflineQueue: false` — when the connection is down, reject
 *    queued commands immediately rather than buffering them. Pipelines
 *    that try to enqueue mid-outage will see the error right away and
 *    can fall through to the lead-recovery path on next boot.
 */
export function getRedisConnection(): IORedis {
  if (redisConnection) return redisConnection;
  redisConnection = new IORedis(getRedisUrl(), {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    connectTimeout: 10_000,
    enableOfflineQueue: false,
    retryStrategy(times: number) {
      // Exponential backoff capped at 10s.
      return Math.min(1000 * 2 ** Math.min(times, 6), 10_000);
    },
  });
  redisConnection.on("error", (err) => {
    // eslint-disable-next-line no-console
    console.error("[worker:redis] error:", err.message);
  });
  return redisConnection;
}

function getConnectionOpts(): ConnectionOptions {
  return getRedisConnection() as unknown as ConnectionOptions;
}

let _pipelineQueue: Queue<LeadJobData> | null = null;

/**
 * Returns the (lazy-initialized) BullMQ queue used to enqueue lead jobs
 * from the Next.js side. Kept as a function so importing the module never
 * touches Redis until actually needed.
 *
 * `attempts: 3` with a 5s exponential backoff: transiente Fehler (Bunny
 * CDN 403, DB-Blip) und langsames Bunny-Encoding bekommen zwei Retries.
 * Retries sind seit dem Resume-Pfad (video-upload.ts) billig — sie pollen
 * das schon encodierende Video weiter statt neu zu rendern.
 */
export function pipelineQueue(): Queue<LeadJobData> {
  if (_pipelineQueue) return _pipelineQueue;
  _pipelineQueue = new Queue<LeadJobData>(QUEUE_NAME, {
    connection: getConnectionOpts(),
    defaultJobOptions: {
      // 3 Attempts: der Resume-Pfad (video-upload.ts) macht Retries billig —
      // Attempt 2/3 pollt das schon encodierende Bunny-Video weiter statt neu
      // zu rendern. 3 × 5,5 min Encoding-Wait deckt auch langsame Bunny-Queues.
      attempts: 3,
      backoff: { type: "exponential", delay: 5_000 },
      removeOnComplete: 100,
      removeOnFail: 500,
    },
  });
  return _pipelineQueue;
}

/**
 * Creates a BullMQ Worker that consumes the lead-pipeline queue.
 *
 * Settings:
 *  - `concurrency: 16` (env: WORKER_CONCURRENCY) — the per-lead pipeline
 *    is I/O-bound (Bunny upload, LibreOffice, ffmpeg, Puppeteer CDP
 *    screencast) rather than CPU-bound. At idle the worker uses ~0.25%
 *    CPU + ~730 MB RAM on a CPX42 (8 vCPU / 16 GB RAM); doubling
 *    parallelism from 8 → 16 still leaves headroom. Peak RSS estimate at
 *    16 parallel leads:
 *      LibreOffice    16 × ~200 MB  ≈  3.2 GB
 *      Chromium                      ≈  1.0 GB (pooled, shared)
 *      Node heap                     ≈  1.0 GB
 *      sharp + ffmpeg buffers        ≈  1.0-2.0 GB
 *      ───────────────────────────────────────
 *      Total                         ≈  6-8 GB  (well within 15 GB)
 *  - `stalledInterval: 30s` — how often BullMQ checks for stalled jobs.
 *  - `maxStalledCount: 3` — tolerate 3 missed lock renewals before moving
 *    the job to failed; default 1 was too aggressive for pipelines that
 *    legitimately spend tens of seconds inside a single ffmpeg call.
 *  - `lockDuration: 90s` — how long a worker "owns" a job before another
 *    worker may claim it as stalled.
 *  - `lockRenewTime: 30s` — proactively renew the lock at 1/3 of the
 *    duration so we never lose ownership while still processing.
 *  - On crash/restart, jobs whose lock expires get re-emitted as pending
 *    automatically — this fixes the "166 pending leads after worker
 *    restart" symptom we saw in the 250-lead run.
 *  - `removeOnComplete/Fail` keeps Redis from growing unbounded.
 */
export function pipelineWorker(
  processor: Processor<LeadJobData>,
): Worker<LeadJobData> {
  // Default 24 (2026-08-18): der Bunny-Wait ist entblockiert, damit
  // laufen Leads schneller durch → mehr Slots = mehr Durchsatz. Auf 8 GB
  // RAM/12 GB Swap-Config passt das noch (Peak ~11 GB inkl. LibreOffice).
  const concurrency = Number(process.env.WORKER_CONCURRENCY ?? "24");
  return new Worker<LeadJobData>(QUEUE_NAME, processor, {
    connection: getConnectionOpts(),
    concurrency,
    stalledInterval: 30_000,
    maxStalledCount: 3,
    lockDuration: 90_000,
    lockRenewTime: 30_000,
    removeOnComplete: { count: 100 },
    removeOnFail: { count: 500 },
  });
}

export const LEAD_PIPELINE_QUEUE = QUEUE_NAME;
export const LEAD_PREFLIGHT_QUEUE = PREFLIGHT_QUEUE_NAME;

// ── Phase-1 Preflight Queue ─────────────────────────────────────────────────
//
// A separate BullMQ queue for the fast URL-probe + light-screenshot pass that
// runs before the heavy video render. Kept distinct from the main pipeline
// queue so a heavy render run never blocks a new run's preflight (or vice
// versa) and so concurrency can be tuned independently.
//
// Caller-Note (start endpoint, Agent 1's responsibility):
//   `addBulk` with an explicit `jobId` will SILENTLY DEDUPE if the same ID
//   sits in the failed/completed ZSETs. Before enqueueing preflight jobs
//   for a given leadId, the caller MUST do:
//
//     await preflightQueue().remove(leadId).catch(() => undefined);
//
//   …otherwise re-runs of a previously preflighted Lead deadlock — same
//   pattern we already use in `worker/index.ts` for stuck-recovery.

let _preflightQueue: Queue<PreflightJobData> | null = null;

/**
 * Returns the (lazy-initialized) BullMQ queue used to enqueue Lead-Preflight
 * jobs. Mirrors `pipelineQueue()` settings but with TIGHTER retain counts —
 * preflight jobs are short-lived and produce ~1000s of completions per run.
 */
export function preflightQueue(): Queue<PreflightJobData> {
  if (_preflightQueue) return _preflightQueue;
  _preflightQueue = new Queue<PreflightJobData>(PREFLIGHT_QUEUE_NAME, {
    connection: getConnectionOpts(),
    defaultJobOptions: {
      // 2 attempts: one transient retry, then fail — preflight jobs are
      // cheap to re-trigger and should fail fast.
      attempts: 2,
      backoff: { type: "exponential", delay: 5_000 },
      removeOnComplete: { count: 200 },
      removeOnFail: { count: 500 },
    },
  });
  return _preflightQueue;
}

/**
 * Creates a BullMQ Worker that consumes the lead-preflight queue.
 *
 * Settings:
 *  - `concurrency: 24` (env: PREFLIGHT_WORKER_CONCURRENCY) — preflight jobs
 *    are ~80 MB Chromium-page each + a tiny network probe; 24 parallel
 *    sits comfortably inside the 15 GB worker container while letting us
 *    process 500 leads in ~90 s (per concept doc).
 *  - `stalledInterval: 30s` — frequent enough that a crashed page is
 *    surfaced quickly without thrashing.
 *  - `maxStalledCount: 3` — tolerate transient lock-renewal hiccups.
 *  - `lockDuration: 60s` — preflight is bounded to ~8s goto + a small
 *    Bunny upload; 60s is generous.
 *  - `lockRenewTime: 20s` — renew at 1/3 of duration.
 */
export function preflightWorker(
  processor: Processor<PreflightJobData>,
): Worker<PreflightJobData> {
  const concurrency = Number(
    process.env.PREFLIGHT_WORKER_CONCURRENCY ?? "24",
  );
  return new Worker<PreflightJobData>(PREFLIGHT_QUEUE_NAME, processor, {
    connection: getConnectionOpts(),
    concurrency,
    stalledInterval: 30_000,
    maxStalledCount: 3,
    lockDuration: 60_000,
    lockRenewTime: 20_000,
    removeOnComplete: { count: 200 },
    removeOnFail: { count: 500 },
  });
}
