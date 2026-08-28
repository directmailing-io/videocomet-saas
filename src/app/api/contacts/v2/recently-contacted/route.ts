/**
 * POST /api/contacts/v2/recently-contacted
 *
 * Doppel-Anschreib-Check für den Runden-Wizard (Follow-up-Paket 2026-08-28):
 * Welche der geplanten Kontakte hatten in den letzten N Tagen schon Post
 * (Brief versendet ODER E-Mail versendet)? Reine Warnung — blockiert nie.
 *
 * Body: { listId?: uuid, contactIds?: uuid[], days?: number }
 * Response: { count: number, contactIds: string[] }
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { requireUserApi } from "@/lib/auth-guard";
import { db } from "@/lib/db";
import { contacts } from "@/lib/db/schema";

export async function POST(req: NextRequest) {
  const auth = await requireUserApi();
  if (!auth.ok) return auth.response;

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "Ungültiges JSON." }, { status: 400 });
  }
  const b = (raw ?? {}) as Record<string, unknown>;
  const listId = typeof b.listId === "string" ? b.listId : null;
  const contactIds = Array.isArray(b.contactIds)
    ? b.contactIds.filter((v): v is string => typeof v === "string")
    : [];
  const days = Math.min(Math.max(Number(b.days ?? 30) || 30, 1), 365);

  if (!listId && contactIds.length === 0) {
    return NextResponse.json({ count: 0, contactIds: [] });
  }

  const scopeSql = listId
    ? sql`EXISTS (
        SELECT 1 FROM list_memberships lm
        WHERE lm.contact_id = c.id AND lm.list_id = ${listId}
      )`
    : sql`c.id IN (${sql.join(contactIds.map((id) => sql`${id}`), sql`, `)})`;

  const rows = await db.execute<{ id: string }>(sql`
    SELECT c.id
    FROM ${contacts} c
    WHERE c.user_id = ${auth.user.id}
      AND c.deleted_at IS NULL
      AND ${scopeSql}
      AND EXISTS (
        SELECT 1 FROM leads l
        WHERE l.contact_id = c.id AND l.removed_at IS NULL
          AND (
            (l.letter_status = 'sent' AND l.letter_sent_at > NOW() - make_interval(days => ${days}))
            OR EXISTS (
              SELECT 1 FROM email_messages em
              WHERE em.lead_id = l.id
                AND em.sent_at > NOW() - make_interval(days => ${days})
            )
          )
      )
  `);

  return NextResponse.json({
    count: rows.length,
    contactIds: rows.map((r) => r.id),
  });
}
