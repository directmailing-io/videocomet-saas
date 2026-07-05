export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { requireUserApi } from "@/lib/auth-guard";
import { db } from "@/lib/db";
import { leads, runs } from "@/lib/db/schema";

/**
 * GET /api/leads/[id]/envelope-pdf
 *
 * Analog zu /api/leads/[id]/pdf, aber fuer das Umschlag-PDF (Migration 0031).
 * Tenant-scoped ueber runs.userId. 302-Redirect auf leads.envelopePdfUrl.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await requireUserApi();
  if (!auth.ok) return auth.response;

  const [row] = await db
    .select({ envelopePdfUrl: leads.envelopePdfUrl })
    .from(leads)
    .innerJoin(runs, eq(runs.id, leads.runId))
    .where(and(eq(leads.id, params.id), eq(runs.userId, auth.user.id)))
    .limit(1);

  if (!row) {
    return NextResponse.json({ error: "Nicht gefunden." }, { status: 404 });
  }
  if (!row.envelopePdfUrl) {
    return NextResponse.json(
      { error: "Umschlag noch nicht verfügbar." },
      { status: 404 },
    );
  }
  return NextResponse.redirect(row.envelopePdfUrl, { status: 302 });
}
