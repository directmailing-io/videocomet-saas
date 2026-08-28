/**
 * PATCH  /api/contact-labels/[id] — Label umbenennen / umfärben.
 * DELETE /api/contact-labels/[id] — Label komplett löschen.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { requireUserApi } from "@/lib/auth-guard";
import {
  deleteContactLabel,
  updateContactLabel,
} from "@/lib/db/queries/contact-labels";

export async function PATCH(
  req: Request,
  { params }: { params: { id: string } },
) {
  const auth = await requireUserApi();
  if (!auth.ok) return auth.response;
  const body = await req.json().catch(() => null);
  const name = typeof body?.name === "string" ? body.name : undefined;
  const color =
    typeof body?.color === "string" && /^#[0-9a-fA-F]{6}$/.test(body.color)
      ? body.color
      : undefined;
  if (name === undefined && color === undefined) {
    return NextResponse.json({ error: "Nichts zu ändern." }, { status: 400 });
  }
  try {
    const label = await updateContactLabel({
      userId: auth.user.id,
      labelId: params.id,
      name,
      color,
    });
    return NextResponse.json({
      label: { id: label.id, name: label.name, color: label.color },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Fehler beim Speichern.";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}

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
