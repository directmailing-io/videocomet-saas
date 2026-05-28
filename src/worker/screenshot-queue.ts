/**
 * BullMQ queue setup for the screenshot pipeline.
 *
 * Single queue `screenshot` that captures one fullPage screenshot per job.
 * Kept separate from the lead pipeline queue so its shorter-running jobs
 * don't get stuck behind long lead renders. Reuses the same shared Redis
 * connection (see `./queue.ts`).
 *
 * Job state + result are also persisted in a Redis hash under
 *   `screenshot:<jobId>`
 * with fields { status, imageUrl, width, height, error } and a 30-minute
 * TTL. The GET /api/screenshot/[jobId] endpoint reads this hash; using a
 * hash (instead of inspecting BullMQ job state directly) means the API
 * doesn't need to keep a BullMQ Queue instance around in the Next.js
 * runtime once the job is enqueued.
 */

import { Queue, Worker, type ConnectionOptions, type Processor } from "bullmq";
import { getRedisConnection } from "./queue";

export const SCREENSHOT_QUEUE_NAME = "screenshot";

/** Payload for a single screenshot job. */
export interface ScreenshotJobData {
  jobId: string;
  userId: string;
  url: string;
}

/** TTL for the per-job Redis hash. 30 minutes. */
export const SCREENSHOT_REDIS_TTL_SECONDS = 30 * 60;

/** Returns the Redis key used to store a job's status + result hash. */
export function getScreenshotJobRedisKey(jobId: string): string {
  return `screenshot:${jobId}`;
}

function getConnectionOpts(): ConnectionOptions {
  return getRedisConnection() as unknown as ConnectionOptions;
}

let _screenshotQueue: Queue<ScreenshotJobData> | null = null;

/**
 * Returns the (lazy-initialized) BullMQ queue used to enqueue screenshot
 * jobs from the Next.js side.
 */
export function screenshotQueue(): Queue<ScreenshotJobData> {
  if (_screenshotQueue) return _screenshotQueue;
  _screenshotQueue = new Queue<ScreenshotJobData>(SCREENSHOT_QUEUE_NAME, {
    connection: getConnectionOpts(),
    defaultJobOptions: {
      attempts: 2,
      backoff: { type: "exponential", delay: 2_000 },
      removeOnComplete: 50,
      removeOnFail: 100,
    },
  });
  return _screenshotQueue;
}

/**
 * Creates a BullMQ Worker that consumes the screenshot queue.
 *
 * Settings tuned for short-running capture jobs (≤ ~30 s each).
 */
export function screenshotWorker(
  processor: Processor<ScreenshotJobData>,
): Worker<ScreenshotJobData> {
  const concurrency = Number(
    process.env.SCREENSHOT_WORKER_CONCURRENCY ?? "2",
  );
  return new Worker<ScreenshotJobData>(SCREENSHOT_QUEUE_NAME, processor, {
    connection: getConnectionOpts(),
    concurrency,
    maxStalledCount: 2,
    lockDuration: 90 * 1000, // capture is bounded to ~60s + headroom
    removeOnComplete: { count: 50 },
    removeOnFail: { count: 100 },
  });
}
