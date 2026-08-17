/**
 * POST /api/contacts/v2/merge — zwei Contacts zusammenführen.
 * Body: { winnerId: uuid, loserId: uuid }
 *
 * Der loser wird soft-gelöscht (deleted_reason: "merged_into:<winnerId>"),
 * seine Leads und Listen-Memberships wandern zum winner. Leere Felder des
 * winners werden mit Werten des losers befüllt.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { requireUserApi } from "@/lib/auth-guard";
import { mergeContacts } from "@/lib/db/queries/contacts";

export async function POST(req: NextRequest) {
  const auth = await requireUserApi();
  if (!auth.ok) return auth.response;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Ungültiges JSON." }, { status: 400 });
  }
  const b = (body ?? {}) as Record<string, unknown>;
  const winnerId = typeof b.winnerId === "string" ? b.winnerId : null;
  const loserId = typeof b.loserId === "string" ? b.loserId : null;
  if (!winnerId || !loserId) {
    return NextResponse.json(
      { error: "winnerId und loserId erwartet." },
      { status: 400 },
    );
  }
  if (winnerId === loserId) {
    return NextResponse.json(
      { error: "winnerId und loserId dürfen nicht gleich sein." },
      { status: 400 },
    );
  }

  const ok = await mergeContacts({
    userId: auth.user.id,
    winnerId,
    loserId,
  });
  if (!ok) {
    return NextResponse.json(
      { error: "Kontakte nicht gefunden oder gehören nicht dir." },
      { status: 404 },
    );
  }
  return NextResponse.json({ ok: true });
}
