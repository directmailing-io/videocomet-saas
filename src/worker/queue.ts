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
import type { LeadJobData } from "./types";

const QUEUE_NAME = "lead-pipeline";

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
 */
export function getRedisConnection(): IORedis {
  if (redisConnection) return redisConnection;
  redisConnection = new IORedis(getRedisUrl(), {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
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
 * `attempts: 2` with a 5s exponential backoff means a single transient
 * error (e.g. Bunny CDN 403, a momentary DB blip) gets one retry before
 * the lead is marked failed. We do NOT want too many retries — long-running
 * pipelines that fail for a "real" reason should fail fast rather than tie
 * up worker slots.
 */
export function pipelineQueue(): Queue<LeadJobData> {
  if (_pipelineQueue) return _pipelineQueue;
  _pipelineQueue = new Queue<LeadJobData>(QUEUE_NAME, {
    connection: getConnectionOpts(),
    defaultJobOptions: {
      attempts: 2,
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
 *  - `concurrency: 8` (env: WORKER_CONCURRENCY) — the per-lead pipeline is
 *    I/O-bound (Bunny upload, LibreOffice, ffmpeg, Puppeteer) rather than
 *    CPU-bound. With the LibreOffice mutex removed (per-instance user
 *    profile dirs, see `lib/libreoffice.ts`) 8 parallel pipelines fit
 *    comfortably in memory.
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
  const concurrency = Number(process.env.WORKER_CONCURRENCY ?? "8");
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
