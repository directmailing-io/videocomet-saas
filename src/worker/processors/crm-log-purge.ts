/**
 * CRM-Event-Log Retention Purge.
 *
 * The `crm_event_log` table is append-only with one row per CRM HTTP
 * call (success + every failure + every skip). For active customers
 * that's ~5-20k rows/day per campaign. The Phase-2 plan caps retention
 * at 30 days; this module implements the DELETE.
 *
 * Designed to be wired into a daily scheduler at ~02:00 UTC (low
 * traffic window). The function is idempotent — running it twice in a
 * row deletes nothing on the second run.
 *
 * Phase 3 TODO: wire this into the existing worker scheduler (see
 * `worker/index.ts` for the `setInterval`-based recovery pattern, or
 * `processors/bunny-purge.ts::startBunnyPurger()` for a self-contained
 * start/stop API). For now we leave it OFF so we don't silently start
 * deleting in environments without monitoring in place.
 */

import { sql } from "drizzle-orm";
import { db } from "@/lib/db";

const RETENTION_DAYS = 30;

export interface CrmLogPurgeResult {
  /** Rows deleted in this run. */
  deleted: number;
  /** Cutoff timestamp used (ts < cutoff). */
  cutoff: string;
  /** Wall time spent in the DELETE. */
  elapsedMs: number;
}

/**
 * Delete `crm_event_log` rows older than `RETENTION_DAYS`. Safe to run
 * repeatedly; the WHERE clause limits to old rows so a re-run is a
 * no-op after the first pass cleans them out.
 *
 * Implementation notes:
 *   - Uses `now() - interval '30 days'` server-side so timezone drift
 *     between worker container and DB never matters.
 *   - No batching: `crm_event_log` has a `(integration_id, ts)` index
 *     that makes this range scan cheap even at 100k rows. If we ever
 *     hit a customer with millions of rows we'll switch to a 10k-LIMIT
 *     loop. Today's reality is "5-7 customers, ~50k rows total".
 */
export async function runCrmLogPurge(): Promise<CrmLogPurgeResult> {
  const startedAt = Date.now();
  // Compute the cutoff timestamp in JS so we don't have to thread Postgres
  // result-row shapes through Drizzle's loosely-typed `execute()` return.
  const cutoffDate = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const cutoff = cutoffDate.toISOString();

  const deleteResult = await db.execute(sql`
    DELETE FROM crm_event_log
    WHERE ts < now() - interval '${sql.raw(String(RETENTION_DAYS))} days'
  `);

  // Drizzle's execute() forwards the underlying pg result. `rowCount` is
  // the standard pg field for affected rows; we cast defensively because
  // the typed surface doesn't expose it. Fall back to 0 if the driver
  // version surfaces it differently.
  const deleted =
    (deleteResult as unknown as { rowCount?: number | null }).rowCount ?? 0;

  const elapsedMs = Date.now() - startedAt;
  // eslint-disable-next-line no-console
  console.log(
    `[crm:log-purge] deleted ${deleted} rows older than ${cutoff} in ${elapsedMs}ms`,
  );
  return { deleted, cutoff, elapsedMs };
}
