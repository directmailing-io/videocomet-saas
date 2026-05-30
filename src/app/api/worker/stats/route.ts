/**
 * GET /api/worker/stats
 *
 * Liefert eine kompakte Echtzeit-Sicht auf den Worker-Pool für die
 * Live-Tabelle. Wird im Run-Detail alle 5 s gepollt, solange der Run nicht
 * terminal ist.
 *
 * Datenquellen:
 *  - `worker_heartbeats` (Postgres): Anzahl der zuletzt (innerhalb 2 min)
 *    gesehenen Worker-Prozesse + deren `currentJobs`-Summe als "in-flight"
 *    Schätzung.
 *  - BullMQ Redis-Listen `bull:lead-pipeline:active` / `:wait`: ehrliche
 *    Queue-Tiefe, unabhängig von der Heartbeat-Frequenz.
 *
 * Bewusst KEIN Import von `getWorkerHealth()` aus `@/worker/lib/heartbeat`:
 * das ist ein in-process Snapshot vom Worker-Prozess. Der Next.js-Server,
 * der diese Route bedient, sieht davon nichts und würde immer 0 zurück
 * liefern. Stattdessen lesen wir die DB und Redis direkt.
 *
 * Antwort wird 5 s im Browser gecached (`Cache-Control: private, max-age=5`),
 * damit das 5-s-Polling kein redundantes Hämmern verursacht, falls der User
 * den Tab fokussiert.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { gte } from "drizzle-orm";
import { requireUserApi } from "@/lib/auth-guard";
import { db } from "@/lib/db";
import { workerHeartbeats } from "@/lib/db/schema";
import { getRedisConnection, LEAD_PIPELINE_QUEUE } from "@/worker/queue";

interface WorkerStatsResponse {
  /** Anzahl Worker-Prozesse, die in den letzten 2 min einen Heartbeat geschrieben haben. */
  workers: number;
  /** Summe der `currentJobs` über alle aktiven Worker. */
  inFlight: number;
  /** Länge von `bull:lead-pipeline:active`. */
  active: number;
  /** Länge von `bull:lead-pipeline:wait`. */
  waiting: number;
  /** ISO-Timestamp des letzten Heartbeats über alle Worker (null wenn keiner). */
  lastSeenAt: string | null;
}

const HEARTBEAT_WINDOW_MS = 2 * 60 * 1000;

async function readWorkerHeartbeats(): Promise<{
  workers: number;
  inFlight: number;
  lastSeenAt: string | null;
}> {
  try {
    const since = new Date(Date.now() - HEARTBEAT_WINDOW_MS);
    const rows = await db
      .select()
      .from(workerHeartbeats)
      .where(gte(workerHeartbeats.lastSeenAt, since));
    const inFlight = rows.reduce((acc, r) => acc + (r.currentJobs ?? 0), 0);
    const lastSeenAt = rows.reduce<Date | null>((acc, r) => {
      if (!r.lastSeenAt) return acc;
      const t = r.lastSeenAt instanceof Date ? r.lastSeenAt : new Date(r.lastSeenAt);
      if (Number.isNaN(t.getTime())) return acc;
      if (!acc || t > acc) return t;
      return acc;
    }, null);
    return {
      workers: rows.length,
      inFlight,
      lastSeenAt: lastSeenAt ? lastSeenAt.toISOString() : null,
    };
  } catch {
    return { workers: 0, inFlight: 0, lastSeenAt: null };
  }
}

async function readQueueDepth(): Promise<{ active: number; waiting: number }> {
  try {
    const redis = getRedisConnection();
    // BullMQ legt seine Listen unter `bull:<queue-name>:<state>` ab.
    const prefix = `bull:${LEAD_PIPELINE_QUEUE}`;
    const [active, waiting] = await Promise.all([
      redis.llen(`${prefix}:active`),
      redis.llen(`${prefix}:wait`),
    ]);
    return { active, waiting };
  } catch {
    return { active: 0, waiting: 0 };
  }
}

export async function GET() {
  const auth = await requireUserApi();
  if (!auth.ok) return auth.response;

  const [hb, depth] = await Promise.all([readWorkerHeartbeats(), readQueueDepth()]);

  const body: WorkerStatsResponse = {
    workers: hb.workers,
    inFlight: hb.inFlight,
    active: depth.active,
    waiting: depth.waiting,
    lastSeenAt: hb.lastSeenAt,
  };

  return NextResponse.json(body, {
    status: 200,
    headers: {
      "Cache-Control": "private, max-age=5",
    },
  });
}
