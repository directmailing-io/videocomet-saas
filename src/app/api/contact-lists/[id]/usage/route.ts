/**
 * GET /api/contact-lists/:id/usage
 *
 * Liefert alle Runden, in denen mindestens ein Kontakt aus dieser Liste
 * verwendet wurde. Damit weiß der User in der Kontakte-Ansicht auf einen
 * Blick, für welche Kampagnen die aktuell ausgewählte Liste schon gelaufen
 * ist.
 *
 * Response: { runs: Array<{ runId, runName, campaignId, campaignName,
 *                           startedAt, leadCount }> }
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  campaigns,
  contactLists,
  leads,
  listMemberships,
  runs,
} from "@/lib/db/schema";
import { requireUserApi } from "@/lib/auth-guard";

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await requireUserApi();
  if (!auth.ok) return auth.response;

  // Ownership-Check
  const [list] = await db
    .select({ id: contactLists.id })
    .from(contactLists)
    .where(and(eq(contactLists.id, params.id), eq(contactLists.userId, auth.user.id)))
    .limit(1);
  if (!list) {
    return NextResponse.json({ error: "Diese Liste gibt es nicht mehr." }, { status: 404 });
  }

  type Row = {
    run_id: string;
    run_name: string;
    campaign_id: string;
    campaign_name: string;
    started_at: string | null;
    lead_count: number;
  };
  const rows = await db.execute<Row>(sql`
    SELECT r.id AS run_id, r.name AS run_name,
           c.id AS campaign_id, c.name AS campaign_name,
           r.started_at::text AS started_at,
           COUNT(l.id)::int AS lead_count
      FROM ${runs} r
      JOIN ${campaigns} c ON c.id = r.campaign_id
      JOIN ${leads} l ON l.run_id = r.id AND l.removed_at IS NULL
     WHERE l.contact_id IN (
             SELECT lm.contact_id
               FROM ${listMemberships} lm
              WHERE lm.list_id = ${params.id}
           )
     GROUP BY r.id, r.name, c.id, c.name, r.started_at
     ORDER BY r.started_at DESC NULLS LAST
     LIMIT 50
  `);

  return NextResponse.json({
    runs: rows.map((r) => ({
      runId: r.run_id,
      runName: r.run_name,
      campaignId: r.campaign_id,
      campaignName: r.campaign_name,
      startedAt: r.started_at,
      leadCount: r.lead_count,
    })),
  });
}
