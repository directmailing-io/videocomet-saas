export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { and, eq, isNull } from "drizzle-orm";
import { requireAdminApi } from "@/lib/auth-guard";
import { db } from "@/lib/db";
import { runs } from "@/lib/db/schema";
import {
  regenerateRunCore,
  type RunRegenMode,
} from "@/lib/regenerate";

/**
 * POST /api/admin/runs/[id]/regenerate
 *
 * Admin-Variante von /api/runs/[id]/regenerate: gleicher Kern
 * (@/lib/regenerate), aber ohne Tenant-Scope — der Admin stößt die
 * Generierung im Namen des Run-Owners neu an (Support-Fall).
 *
 * Body (optional): { mode?: "all" | "video" | "pdf" | "failed" }
 */

function parseMode(input: unknown): RunRegenMode {
  if (
    input === "video" ||
    input === "pdf" ||
    input === "all" ||
    input === "failed"
  ) {
    return input;
  }
  return "all";
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await requireAdminApi();
  if (!auth.ok) return auth.response;

  let mode: RunRegenMode = "all";
  try {
    const ct = req.headers.get("content-type") ?? "";
    if (ct.includes("application/json")) {
      const body = (await req.json()) as { mode?: unknown };
      mode = parseMode(body?.mode);
    }
  } catch {
    // Leerer / kaputter Body → Default behalten.
  }

  const [run] = await db
    .select({
      id: runs.id,
      userId: runs.userId,
      campaignId: runs.campaignId,
      status: runs.status,
      sharedBunnyVideoId: runs.sharedBunnyVideoId,
    })
    .from(runs)
    .where(and(eq(runs.id, params.id), isNull(runs.deletedAt)))
    .limit(1);
  if (!run) {
    return NextResponse.json({ error: "Nicht gefunden." }, { status: 404 });
  }

  const outcome = await regenerateRunCore(run, mode);
  return NextResponse.json(outcome.body, { status: outcome.status });
}
