/**
 * Single-Listen-API.
 *
 *   PATCH  /api/contact-lists/:id  — Name/Beschreibung/Farbe/Icon ändern
 *   DELETE /api/contact-lists/:id  — Liste löschen (Cascade zu Memberships)
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { requireUserApi } from "@/lib/auth-guard";
import {
  deleteContactList,
  updateContactList,
} from "@/lib/db/queries/contacts";

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await requireUserApi();
  if (!auth.ok) return auth.response;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Ungültiges JSON." }, { status: 400 });
  }
  const b = (body ?? {}) as Record<string, unknown>;

  const patch: Parameters<typeof updateContactList>[0]["patch"] = {};
  if (typeof b.name === "string") patch.name = b.name.trim();
  if (typeof b.description === "string" || b.description === null) {
    patch.description = b.description as string | null;
  }
  if (typeof b.color === "string" || b.color === null) {
    patch.color = b.color as string | null;
  }
  if (typeof b.icon === "string" || b.icon === null) {
    patch.icon = b.icon as string | null;
  }
  if (typeof b.autoRunCampaignId === "string" || b.autoRunCampaignId === null) {
    patch.autoRunCampaignId = b.autoRunCampaignId as string | null;
  }

  try {
    const list = await updateContactList({
      userId: auth.user.id,
      listId: params.id,
      patch,
    });
    if (!list) {
      return NextResponse.json({ error: "Liste nicht gefunden." }, { status: 404 });
    }
    return NextResponse.json({ list });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("contact_lists_user_name_uq")) {
      return NextResponse.json(
        { error: "Eine Liste mit diesem Namen existiert bereits." },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await requireUserApi();
  if (!auth.ok) return auth.response;

  const ok = await deleteContactList({
    userId: auth.user.id,
    listId: params.id,
  });
  if (!ok) {
    return NextResponse.json({ error: "Liste nicht gefunden." }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
