export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUserApi } from "@/lib/auth-guard";
import { getContactDetail } from "@/lib/leads/global-list";
import { hardDeleteLeads } from "@/lib/leads/hard-delete";

/**
 * GET /api/contacts/[id]
 * Detail eines Kontakts inkl. aller Occurrences (Kampagnen + Runden wo der
 * Kontakt vorkommt) + roh-importierte Daten.
 *
 * `id` = masterLeadId (ID des juengsten Vorkommens der Person).
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await requireUserApi();
  if (!auth.ok) return auth.response;

  const detail = await getContactDetail(auth.user.id, params.id);
  if (!detail) {
    return NextResponse.json({ error: "Kontakt nicht gefunden." }, { status: 404 });
  }
  return NextResponse.json(detail);
}

/**
 * DELETE /api/contacts/[id]
 *
 * Body: { reason: 'user_request' | 'gdpr_dsar' | 'complaint', confirmation: 'DAUERHAFT LÖSCHEN' }
 *
 * Loescht ALLE Occurrences dieses Kontakts (ueber alle Kampagnen und
 * Runden). DSGVO-Hard-Delete: Datenbank + Bunny + Aliases werden
 * unwiderruflich vernichtet. Audit-Trail bleibt (Art. 30).
 */
const DeleteBody = z.object({
  reason: z.enum(["user_request", "gdpr_dsar", "complaint"]),
  confirmation: z.string(),
});

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await requireUserApi();
  if (!auth.ok) return auth.response;

  const raw = await req.json().catch(() => null);
  const parsed = DeleteBody.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "Ungueltiger Body" }, { status: 400 });
  }

  // Typed-Confirmation: der User muss genau diesen Text tippen.
  // Absicherung gegen versehentliche Deletion via API-Explorer o.ae.
  if (parsed.data.confirmation !== "DAUERHAFT LÖSCHEN") {
    return NextResponse.json(
      { error: "Bestaetigungs-Text falsch. Bitte 'DAUERHAFT LÖSCHEN' eintippen." },
      { status: 400 },
    );
  }

  // Detail laden, damit wir ALLE Occurrence-IDs kriegen.
  const detail = await getContactDetail(auth.user.id, params.id);
  if (!detail) {
    return NextResponse.json({ error: "Kontakt nicht gefunden." }, { status: 404 });
  }

  const result = await hardDeleteLeads({
    userId: auth.user.id,
    leadIds: detail.occurrenceIds,
    reason: parsed.data.reason,
    requestedBy: auth.user.id,
  });

  return NextResponse.json(result);
}
