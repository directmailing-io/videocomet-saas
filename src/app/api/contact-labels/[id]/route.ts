/** DELETE /api/contact-labels/[id] — Label komplett löschen. */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { requireUserApi } from "@/lib/auth-guard";
import { deleteContactLabel } from "@/lib/db/queries/contact-labels";

export async function DELETE(
  _req: Request,
  { params }: { params: { id: string } },
) {
  const auth = await requireUserApi();
  if (!auth.ok) return auth.response;
  const ok = await deleteContactLabel({ userId: auth.user.id, labelId: params.id });
  if (!ok) {
    return NextResponse.json({ error: "Dieses Label gibt es nicht mehr." }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
