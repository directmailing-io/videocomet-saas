export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { requireAdminApi } from "@/lib/auth-guard";
import { db } from "@/lib/db";
import { leads, runs } from "@/lib/db/schema";
import { regenerateLeadCore, type LeadRegenScope } from "@/lib/regenerate";

/**
 * POST /api/admin/leads/[id]/regenerate
 *
 * Admin-Variante von /api/leads/[id]/regenerate: gleicher Kern
 * (@/lib/regenerate), aber ohne Tenant-Scope — der Admin regeneriert
 * einen Lead im Namen des Run-Owners (Support-Fall).
 *
 * Body (optional): { scope?: "all" | "video" | "pdf" | "envelope" }
 */

const bodySchema = z.object({
  scope: z.enum(["all", "video", "pdf", "envelope"]).optional(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await requireAdminApi();
  if (!auth.ok) return auth.response;

  let scope: LeadRegenScope = "all";
  try {
    const ct = req.headers.get("content-type") ?? "";
    if (ct.includes("application/json")) {
      const body = bodySchema.parse(await req.json());
      if (body.scope) scope = body.scope;
    }
  } catch {
    // leerer/falscher body → Default "all"
  }

  const [row] = await db
    .select({
      leadId: leads.id,
      runId: leads.runId,
      campaignId: runs.campaignId,
      userId: runs.userId,
      runStatus: runs.status,
      rowIndex: leads.rowIndex,
    })
    .from(leads)
    .innerJoin(runs, eq(runs.id, leads.runId))
    .where(eq(leads.id, params.id))
    .limit(1);

  if (!row) {
    return NextResponse.json({ error: "Nicht gefunden." }, { status: 404 });
  }

  const outcome = await regenerateLeadCore(
    {
      leadId: row.leadId,
      runId: row.runId,
      campaignId: row.campaignId,
      ownerUserId: row.userId,
      runStatus: row.runStatus,
      rowIndex: row.rowIndex,
    },
    scope,
  );
  return NextResponse.json(outcome.body, { status: outcome.status });
}
