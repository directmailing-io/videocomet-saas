/**
 * Public liveness/readiness endpoint for Coolify (and any external
 * monitor). Hit every ~30s by the platform health-checker; must respond
 * under ~100ms typical and return:
 *
 *   200 → DB ping ok + Redis ping ok
 *   503 → either dependency unreachable
 *
 * Body shape:
 *   {
 *     ok: boolean,
 *     db: "ok" | "fail",
 *     redis: "ok" | "fail",
 *     uptime: number   // process uptime in seconds
 *   }
 *
 * No auth, no caching. Failure responses still serialize the per-check
 * status so the operator can tell at a glance which dependency is the
 * culprit without having to dig through container logs.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";

type CheckStatus = "ok" | "fail";

interface HealthzResponse {
  ok: boolean;
  db: CheckStatus;
  redis: CheckStatus;
  uptime: number;
}

const PING_TIMEOUT_MS = 2_000;

async function withPingTimeout<T>(p: Promise<T>): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      p,
      new Promise<T>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("ping timeout")),
          PING_TIMEOUT_MS,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function pingDb(): Promise<CheckStatus> {
  if (!process.env.DATABASE_URL) return "fail";
  try {
    const { db } = await import("@/lib/db");
    await withPingTimeout(db.execute(sql`select 1`));
    return "ok";
  } catch {
    return "fail";
  }
}

async function pingRedis(): Promise<CheckStatus> {
  if (!process.env.REDIS_URL) return "fail";
  try {
    // Reuse the worker's lazy IORedis connection so we don't burn a
    // fresh TCP handshake per healthcheck. The first hit warms the
    // connection; subsequent pings are sub-millisecond.
    const { getRedisConnection } = await import("@/worker/queue");
    const conn = getRedisConnection();
    const pong = await withPingTimeout(conn.ping());
    return pong === "PONG" ? "ok" : "fail";
  } catch {
    return "fail";
  }
}

export async function GET(): Promise<NextResponse<HealthzResponse>> {
  const [db, redis] = await Promise.all([pingDb(), pingRedis()]);
  const ok = db === "ok" && redis === "ok";
  const body: HealthzResponse = {
    ok,
    db,
    redis,
    uptime: Math.round(process.uptime()),
  };
  return NextResponse.json(body, {
    status: ok ? 200 : 503,
    headers: {
      "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
    },
  });
}
