/**
 * Analytics-Retention (Migration 0072).
 *
 * Löscht alte site_events, damit die Tabelle unabhängig vom Traffic-
 * Wachstum stabil bleibt. Zwei Regeln:
 *   - Heartbeats > 24 h  → weg (dienen nur der Live-Kennzahl)
 *   - alle anderen > 90 Tage → weg (Analytics-Rückschau selten länger)
 *
 * Tickt beim Boot + alle 6 h. Läuft in Batches, damit ein einziger großer
 * DELETE die DB nicht zu lange lockt.
 */

import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { siteEvents } from "@/lib/db/schema";

const SWEEP_INTERVAL_MS = 6 * 60 * 60 * 1000; // alle 6h
const HEARTBEAT_KEEP_HOURS = 24;
const EVENT_KEEP_DAYS = 90;
const BATCH_SIZE = 5_000;

function log(level: "info" | "warn" | "error", msg: string): void {
  // eslint-disable-next-line no-console
  const fn =
    level === "error" ? console.error : level === "warn" ? console.warn : console.log;
  fn(`[analytics-retention] ${msg}`);
}

async function deleteInBatches(where: ReturnType<typeof sql>): Promise<number> {
  let total = 0;
  for (;;) {
    const res = await db.execute(sql`
      WITH old AS (
        SELECT id FROM ${siteEvents}
        WHERE ${where}
        LIMIT ${BATCH_SIZE}
      )
      DELETE FROM ${siteEvents}
      WHERE id IN (SELECT id FROM old)
    `);
    const rowCount =
      (res as unknown as { rowCount?: number }).rowCount ??
      (res as unknown as { count?: number }).count ??
      0;
    total += rowCount;
    if (rowCount < BATCH_SIZE) break;
  }
  return total;
}

export async function runAnalyticsRetentionTick(): Promise<void> {
  try {
    const heartbeatDeleted = await deleteInBatches(
      sql`event_name = 'heartbeat' AND created_at < now() - (${HEARTBEAT_KEEP_HOURS} || ' hours')::interval`,
    );
    const oldDeleted = await deleteInBatches(
      sql`created_at < now() - (${EVENT_KEEP_DAYS} || ' days')::interval`,
    );
    if (heartbeatDeleted + oldDeleted > 0) {
      log(
        "info",
        `deleted ${heartbeatDeleted} old heartbeats + ${oldDeleted} events >${EVENT_KEEP_DAYS}d`,
      );
    }
  } catch (err) {
    log("error", `tick failed: ${(err as Error).message}`);
  }
}

export function startAnalyticsRetention(): () => void {
  void runAnalyticsRetentionTick();
  const t = setInterval(() => {
    void runAnalyticsRetentionTick();
  }, SWEEP_INTERVAL_MS);
  t.unref();
  return () => clearInterval(t);
}
