export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";


type HealthCheck = "ok" | "fail" | "skipped";

interface HealthResponse {
  status: "ok" | "degraded";
  checks: {
    db: HealthCheck;
  };
  version: string | undefined;
  uptimeMs: number;
}

async function checkDb(): Promise<HealthCheck> {
  if (!process.env.DATABASE_URL) {
    // Lokale Dev ohne DB: nicht hart fehlschlagen.
    return "skipped";
  }
  try {
    // Dynamischer Import, damit fehlende DATABASE_URL beim Modul-Load
    // nicht den ganzen Endpunkt killt.
    const { db } = await import("@/lib/db");
    await db.execute(sql`select 1`);
    return "ok";
  } catch {
    return "fail";
  }
}

export async function GET() {
  const db = await checkDb();
  const status: HealthResponse["status"] = db === "fail" ? "degraded" : "ok";
  // Wenn DB-Connection generell fehlt (skipped): degraded aber HTTP 200.
  const degradedButOk = db === "skipped";
  const httpStatus = db === "fail" ? 503 : 200;

  const body: HealthResponse = {
    status: degradedButOk ? "degraded" : status,
    checks: { db },
    version: process.env.npm_package_version,
    uptimeMs: Math.round(process.uptime() * 1000),
  };

  return NextResponse.json(body, { status: httpStatus });
}
