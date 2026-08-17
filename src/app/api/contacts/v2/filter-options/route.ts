/**
 * GET /api/contacts/v2/filter-options
 *
 * Liefert alle Auswahl-Werte für die Filter-Bar der Kontakte-Zentrale
 * (Kampagnen, Runden, Custom-Feld-Definitionen). Wird beim Öffnen des
 * Filter-Menüs geladen, damit "Kampagne = XY" ein echtes Dropdown ist.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { campaigns, contactFields, runs } from "@/lib/db/schema";
import { requireUserApi } from "@/lib/auth-guard";

export async function GET(_req: NextRequest) {
  const auth = await requireUserApi();
  if (!auth.ok) return auth.response;

  const [campaignRows, runRows, fieldRows] = await Promise.all([
    db.execute<{ id: string; name: string }>(sql`
      SELECT id, name FROM ${campaigns}
       WHERE user_id = ${auth.user.id}
       ORDER BY created_at DESC
    `),
    db.execute<{ id: string; name: string; campaign_id: string; campaign_name: string }>(sql`
      SELECT r.id, r.name, r.campaign_id, c.name AS campaign_name
        FROM ${runs} r
        JOIN ${campaigns} c ON c.id = r.campaign_id
       WHERE r.user_id = ${auth.user.id}
       ORDER BY r.created_at DESC
       LIMIT 200
    `),
    db.execute<{ id: string; key: string; label: string; detected_type: string }>(sql`
      SELECT id, key, label, detected_type FROM ${contactFields}
       WHERE user_id = ${auth.user.id}
       ORDER BY usage_count DESC, label ASC
    `),
  ]);

  return NextResponse.json({
    campaigns: campaignRows.map((c) => ({ id: c.id, name: c.name })),
    runs: runRows.map((r) => ({
      id: r.id,
      name: r.name,
      campaignId: r.campaign_id,
      campaignName: r.campaign_name,
    })),
    customFields: fieldRows.map((f) => ({
      key: f.key,
      label: f.label,
      type: f.detected_type,
    })),
  });
}
