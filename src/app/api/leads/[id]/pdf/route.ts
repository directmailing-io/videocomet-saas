export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { requireUserApi } from "@/lib/auth-guard";
import { db } from "@/lib/db";
import { leads, runs } from "@/lib/db/schema";

/**
 * GET /api/leads/[id]/pdf
 *
 * Tenant-aware redirect to the PDF stored on Bunny Edge Storage.
 * Using a redirect (302) keeps memory + bandwidth on Bunny while still
 * preventing direct exposure of pdfUrl in the page-source — the URL is
 * resolved server-side.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await requireUserApi();
  if (!auth.ok) return auth.response;

  const [row] = await db
    .select({ pdfUrl: leads.pdfUrl })
    .from(leads)
    .innerJoin(runs, eq(runs.id, leads.runId))
    .where(and(eq(leads.id, params.id), eq(runs.userId, auth.user.id)))
    .limit(1);

  if (!row) {
    return NextResponse.json({ error: "Nicht gefunden." }, { status: 404 });
  }
  if (!row.pdfUrl) {
    return NextResponse.json(
      { error: "PDF noch nicht verfügbar." },
      { status: 404 },
    );
  }
  return NextResponse.redirect(row.pdfUrl, { status: 302 });
}
