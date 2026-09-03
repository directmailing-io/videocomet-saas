/**
 * Backfill: watch_time_sec + watch_pct fuer alle Leads mit Video-Events neu
 * berechnen (aggregateLeadStats). Einmalig nach Migration 0076 ausfuehren:
 *   docker exec videocomet-worker node --import tsx scripts/backfill-watch-stats.ts
 */
import { sql } from "drizzle-orm";
import { db } from "../src/lib/db";
import { aggregateLeadStats } from "../src/lib/db/queries/lead-events";

async function main() {
  const res = (await db.execute(sql`
    SELECT DISTINCT lead_id FROM lead_events
    WHERE kind IN ('video_play', 'video_progress', 'video_ended')
  `)) as unknown;
  const list = (Array.isArray(res) ? res : (res as { rows?: unknown[] }).rows ?? []) as Array<{ lead_id: string }>;
  console.log(`[backfill] ${list.length} Leads mit Video-Events`);
  let done = 0;
  for (const r of list) {
    await aggregateLeadStats(r.lead_id);
    done += 1;
    if (done % 50 === 0) console.log(`[backfill] ${done}/${list.length}`);
  }
  const statsRes = (await db.execute(sql`
    SELECT count(*) FILTER (WHERE play_count > 0) AS plays,
           count(*) FILTER (WHERE watch_time_sec > 0) AS watched,
           round(avg(watch_pct) FILTER (WHERE play_count > 0), 1) AS avg_pct
    FROM leads
  `)) as unknown;
  const stats = Array.isArray(statsRes) ? statsRes[0] : (statsRes as { rows?: unknown[] }).rows?.[0];
  console.log("[backfill] fertig:", JSON.stringify(stats));
  process.exit(0);
}

main().catch((err) => {
  console.error("[backfill] Fehler:", err);
  process.exit(1);
});
