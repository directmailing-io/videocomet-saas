/**
 * BullMQ queue setup for the CRM-Sync pipeline.
 *
 * Mirrors the screenshot/preflight pattern: own queue name `crm-sync`,
 * reuses the shared Redis connection from `./queue.ts` (so we never open
 * a second IORedis instance for the same Redis host). A separate queue
 * keeps long-running render pipelines from blocking fast CRM pushes (and
 * vice versa) and lets us tune CRM-specific concurrency independent of
 * the render workers.
 *
 * Debounce strategy (see `lib/crm/enqueue.ts`):
 *   - Each (lead, event-kind) pair is added with the EXPLICIT job id
 *     `${leadId}:${kind}` and a 30s delay.
 *   - BullMQ silently dedups by jobId for jobs in `waiting`/`delayed`/
 *     `active`. The result: rapid bursts of the same event kind for the
 *     same lead collapse to a single CRM push within a 30s window. The
 *     worker then reads the aggregated DB columns (lastViewedAt etc.)
 *     when it finally runs — see `processors/crm-sync.ts`.
 *
 * `force: true` lets the manual `/api/.../crm-test-sync` endpoint bypass
 * the debounce dedup by adding a job with a unique id; the worker uses
 * the same processor either way.
 */

import { Queue, Worker, type ConnectionOptions, type Processor } from "bullmq";
import { getRedisConnection } from "./queue";

export const CRM_SYNC_QUEUE = "crm-sync";

/** Discriminated CRM event types we sync. Mapped from `lead_events.kind`. */
export type CrmSyncEventKind = "page_view" | "video_play" | "cta_click";

export interface CrmSyncJob {
  leadId: string;
  kind: CrmSyncEventKind;
  /** Unix-ms timestamp of the originating event. Informational; the worker
   *  reads aggregated lead.lastViewedAt etc. as the source of truth. */
  ts: number;
  /** Bypass debounce dedup (used by /api/.../crm-test-sync). */
  force?: boolean;
}

function getConnectionOpts(): ConnectionOptions {
  return getRedisConnection() as unknown as ConnectionOptions;
}

let _crmSyncQueue: Queue<CrmSyncJob> | null = null;

/**
 * Returns the (lazy-initialized) BullMQ queue used to enqueue CRM-sync
 * jobs from the Next.js side (and from the worker itself via the
 * tracker-hook in `lib/crm/enqueue.ts`).
 *
 * Defaults:
 *  - `attempts: 4` with exponential backoff base 30s. Salessuite/HubSpot
 *    rate-limit on 429 + Retry-After; the processor honors that header
 *    when present, otherwise this backoff (30s → 60s → 120s) keeps the
 *    queue from hammering the provider.
 *  - `removeOnComplete: 200` / `removeOnFail: 1000` — CRM jobs are tiny;
 *    keeping the last 1000 failed gives us a one-click failure-history
 *    view in the admin UI without bloating Redis.
 */
export function crmSyncQueue(): Queue<CrmSyncJob> {
  if (_crmSyncQueue) return _crmSyncQueue;
  _crmSyncQueue = new Queue<CrmSyncJob>(CRM_SYNC_QUEUE, {
    connection: getConnectionOpts(),
    defaultJobOptions: {
      attempts: 4,
      backoff: { type: "exponential", delay: 30_000 },
      removeOnComplete: { count: 200 },
      removeOnFail: { count: 1000 },
    },
  });
  return _crmSyncQueue;
}

/**
 * Creates a BullMQ Worker that consumes the crm-sync queue.
 *
 * Concurrency: defaults to 2 — Salessuite has a 3-concurrent-request quota
 * per tenant in their public API docs, and HubSpot/Close have similar
 * per-account soft limits. A global cap of 2 stays well inside those
 * limits even when a customer fires many events at once. Tunable via
 * `CRM_WORKER_CONCURRENCY` env if a single tenant needs more headroom.
 */
export function crmSyncWorker(
  processor: Processor<CrmSyncJob>,
): Worker<CrmSyncJob> {
  const concurrency = Number(process.env.CRM_WORKER_CONCURRENCY ?? "2");
  return new Worker<CrmSyncJob>(CRM_SYNC_QUEUE, processor, {
    connection: getConnectionOpts(),
    concurrency,
    // CRM pushes are short (< 5s typical); 60s lock with 20s renew is
    // plenty and keeps stalled-detection responsive.
    stalledInterval: 30_000,
    maxStalledCount: 2,
    lockDuration: 60_000,
    lockRenewTime: 20_000,
    removeOnComplete: { count: 200 },
    removeOnFail: { count: 1000 },
  });
}
