/**
 * BullMQ queue für Outreach-GIF-Encodes (Kontrakt Kapitel 6).
 *
 * Eigene Queue `email-gif` (Muster: screenshot-queue.ts), damit die kurzen
 * GIF-Encodes nicht hinter langen Lead-Renders in der Pipeline-Queue
 * hängen. Ein Job = ein Lead. Enqueue passiert aus der Next.js-Seite
 * (`POST /api/campaigns/[id]/email-gif`) mit `jobId = email-gif-<leadId>`
 * — Re-Enqueues müssen stale Job-IDs vorher entfernen (BullMQ dedupt
 * still gegen completed/failed-ZSETs, siehe queue.ts-Kommentar).
 */

import { Queue, Worker, type ConnectionOptions, type Processor } from "bullmq";
import { getRedisConnection } from "./queue";

export const EMAIL_GIF_QUEUE_NAME = "email-gif";

export interface EmailGifJobData {
  leadId: string;
  campaignId: string;
  userId: string;
}

export function emailGifJobId(leadId: string): string {
  return `email-gif-${leadId}`;
}

function getConnectionOpts(): ConnectionOptions {
  return getRedisConnection() as unknown as ConnectionOptions;
}

let _emailGifQueue: Queue<EmailGifJobData> | null = null;

export function emailGifQueue(): Queue<EmailGifJobData> {
  if (_emailGifQueue) return _emailGifQueue;
  _emailGifQueue = new Queue<EmailGifJobData>(EMAIL_GIF_QUEUE_NAME, {
    connection: getConnectionOpts(),
    defaultJobOptions: {
      attempts: 2,
      backoff: { type: "exponential", delay: 5_000 },
      removeOnComplete: { count: 200 },
      removeOnFail: { count: 500 },
    },
  });
  return _emailGifQueue;
}

/**
 * Worker für die email-gif-Queue. Download + ffmpeg-GIF-Encode + Upload
 * sind zusammen ~10–30s pro Lead; Concurrency klein halten, weil
 * palettegen/paletteuse CPU-lastig ist (läuft NICHT durch die
 * libx264-Semaphore des Encode-Limiters).
 */
export function emailGifWorker(
  processor: Processor<EmailGifJobData>,
): Worker<EmailGifJobData> {
  const concurrency = Number(process.env.EMAIL_GIF_WORKER_CONCURRENCY ?? "2");
  return new Worker<EmailGifJobData>(EMAIL_GIF_QUEUE_NAME, processor, {
    connection: getConnectionOpts(),
    concurrency,
    stalledInterval: 30_000,
    maxStalledCount: 2,
    lockDuration: 120_000,
    lockRenewTime: 40_000,
    removeOnComplete: { count: 200 },
    removeOnFail: { count: 500 },
  });
}
