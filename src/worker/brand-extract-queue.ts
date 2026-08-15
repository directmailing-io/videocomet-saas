/**
 * BullMQ queue setup für die Brand-Extraktion (Landingpage v3, Konzept 3.2).
 *
 * Single queue `brand-extract`: ein Job lädt die Kunden-Website mit
 * Puppeteer und leitet daraus ein BrandKit + Logo-Kandidaten ab. Gleiches
 * Muster wie `screenshot-queue.ts` — Job-Status + Ergebnis liegen in einem
 * Redis-Hash unter
 *   `brand-extract:<jobId>`
 * mit Feldern { status, phase, userId, url, result, error } und 30-Minuten-
 * TTL. Die API-Routen (POST /api/brand/extract + GET .../[jobId]) lesen nur
 * diesen Hash und brauchen keine BullMQ-Instanz für das Polling.
 *
 * Zusätzlich hält `brand-extract:lock:<userId>` (TTL 3 min) fest, dass pro
 * User maximal EIN Job gleichzeitig läuft — der POST setzt ihn mit NX, der
 * Processor räumt ihn am Ende weg.
 */

import { Queue, Worker, type ConnectionOptions, type Processor } from "bullmq";
import { getRedisConnection } from "./queue";

export const BRAND_EXTRACT_QUEUE_NAME = "brand-extract";

/** Payload für einen Brand-Extraktions-Job. */
export interface BrandExtractJobData {
  jobId: string;
  userId: string;
  url: string;
}

/** TTL für den per-Job Redis-Hash. 30 Minuten. */
export const BRAND_EXTRACT_REDIS_TTL_SECONDS = 30 * 60;

/** TTL für das 1-Job-pro-User-Lock. Muss > max. Job-Laufzeit sein. */
export const BRAND_EXTRACT_LOCK_TTL_SECONDS = 3 * 60;

/** Redis-Key des Status-/Ergebnis-Hashs eines Jobs. */
export function getBrandExtractJobRedisKey(jobId: string): string {
  return `brand-extract:${jobId}`;
}

/** Redis-Key des „max. 1 laufender Job pro User"-Locks. */
export function getBrandExtractUserLockKey(userId: string): string {
  return `brand-extract:lock:${userId}`;
}

function getConnectionOpts(): ConnectionOptions {
  return getRedisConnection() as unknown as ConnectionOptions;
}

let _brandExtractQueue: Queue<BrandExtractJobData> | null = null;

/**
 * Lazy-initialisierte Queue zum Enqueuen aus der Next.js-Seite.
 *
 * attempts: 1 — ein Retry würde dem pollenden Client zwischendurch ein
 * transientes "failed" zeigen; wer die Analyse erneut will, startet
 * einfach einen neuen Job (der Lock ist dann schon frei).
 */
export function brandExtractQueue(): Queue<BrandExtractJobData> {
  if (_brandExtractQueue) return _brandExtractQueue;
  _brandExtractQueue = new Queue<BrandExtractJobData>(
    BRAND_EXTRACT_QUEUE_NAME,
    {
      connection: getConnectionOpts(),
      defaultJobOptions: {
        attempts: 1,
        removeOnComplete: 50,
        removeOnFail: 100,
      },
    },
  );
  return _brandExtractQueue;
}

/**
 * BullMQ-Worker für die Brand-Extraktion. Kurzlaufende Puppeteer-Jobs
 * (Navigation 15 s + Auswertung) — Concurrency default 2, tunable via
 * BRAND_EXTRACT_WORKER_CONCURRENCY.
 */
export function brandExtractWorker(
  processor: Processor<BrandExtractJobData>,
): Worker<BrandExtractJobData> {
  const concurrency = Number(
    process.env.BRAND_EXTRACT_WORKER_CONCURRENCY ?? "2",
  );
  return new Worker<BrandExtractJobData>(BRAND_EXTRACT_QUEUE_NAME, processor, {
    connection: getConnectionOpts(),
    concurrency,
    maxStalledCount: 2,
    lockDuration: 90 * 1000, // Extraktion ist auf ~30 s begrenzt + Headroom
    removeOnComplete: { count: 50 },
    removeOnFail: { count: 100 },
  });
}
