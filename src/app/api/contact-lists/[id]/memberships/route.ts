/**
 * Membership-API: Contacts zu einer Liste hinzufügen oder entfernen.
 *
 *   POST   /api/contact-lists/:id/memberships  Body: { contactIds: uuid[] }
 *   DELETE /api/contact-lists/:id/memberships  Body: { contactIds: uuid[] }
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { requireUserApi } from "@/lib/auth-guard";
import {
  addContactsToList,
  removeContactsFromList,
} from "@/lib/db/queries/contacts";

function parseContactIds(body: unknown): string[] {
  const b = body as Record<string, unknown> | null;
  if (!b || !Array.isArray(b.contactIds)) return [];
  return b.contactIds.filter((v): v is string => typeof v === "string" && v.length > 0);
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await requireUserApi();
  if (!auth.ok) return auth.response;

  const body = await req.json().catch(() => null);
  const contactIds = parseContactIds(body);
  if (contactIds.length === 0) {
    return NextResponse.json({ error: "Kein Kontakt ausgewählt." }, { status: 400 });
  }
  if (contactIds.length > 500) {
    return NextResponse.json(
      { error: "Zu viele Kontakte auf einmal. Bitte in Häppchen zu 500 aufteilen." },
      { status: 400 },
    );
  }

  const result = await addContactsToList({
    userId: auth.user.id,
    listId: params.id,
    contactIds,
  });
  return NextResponse.json(result);
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await requireUserApi();
  if (!auth.ok) return auth.response;

  const body = await req.json().catch(() => null);
  const contactIds = parseContactIds(body);
  if (contactIds.length === 0) {
    return NextResponse.json({ error: "Kein Kontakt ausgewählt." }, { status: 400 });
  }

  const result = await removeContactsFromList({
    userId: auth.user.id,
    listId: params.id,
    contactIds,
  });
  return NextResponse.json(result);
}
