/**
 * BullMQ-Queue fuer URL-Mediathek-Preview-Generation.
 *
 * Separate Queue von Render-Worker, weil:
 *   - Preview-Jobs sind kurz (<10s typisch) und CPU-leicht.
 *   - Render-Pipelines sind GPU/FFmpeg-schwer, sollen nicht von Preview-
 *     Bursts blockiert werden.
 *
 * Concurrency: 4 (Puppeteer-Pool-vertraeglich, der Worker-Container hat
 * ~24 Slots fuer den Render-Pool, 4 fuer Previews ist guenstiger).
 */

import { Queue, Worker, type ConnectionOptions, type Processor } from "bullmq";
import { getRedisConnection } from "./queue";

export const URL_PREVIEW_QUEUE = "url-preview";

export interface UrlPreviewJob {
  mediaUrlId: string;
  userId: string;
  url: string;
  type: string;
}

function getConnectionOpts(): ConnectionOptions {
  return getRedisConnection() as unknown as ConnectionOptions;
}

let _q: Queue<UrlPreviewJob> | null = null;

export function urlPreviewQueue(): Queue<UrlPreviewJob> {
  if (_q) return _q;
  _q = new Queue<UrlPreviewJob>(URL_PREVIEW_QUEUE, {
    connection: getConnectionOpts(),
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: "exponential", delay: 30_000 },
      removeOnComplete: { count: 200 },
      removeOnFail: { count: 500 },
    },
  });
  return _q;
}

export function urlPreviewWorker(
  processor: Processor<UrlPreviewJob>,
): Worker<UrlPreviewJob> {
  const concurrency = Number(process.env.URL_PREVIEW_WORKER_CONCURRENCY ?? "4");
  return new Worker<UrlPreviewJob>(URL_PREVIEW_QUEUE, processor, {
    connection: getConnectionOpts(),
    concurrency,
    stalledInterval: 30_000,
    maxStalledCount: 1,
    lockDuration: 60_000,
    lockRenewTime: 20_000,
    removeOnComplete: { count: 200 },
    removeOnFail: { count: 500 },
  });
}
