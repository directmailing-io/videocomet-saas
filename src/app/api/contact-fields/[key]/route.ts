/**
 * PATCH  /api/contact-fields/:key  — Feld umbenennen
 * DELETE /api/contact-fields/:key  — Feld-Definition löschen
 *
 * Löschen entfernt nur die Definition (kein Icon, kein Filter-Vorschlag
 * mehr). Werte in contacts.data bleiben erhalten, damit keine Kunden-Daten
 * verlorengehen. Wer das komplett aus allen Kontakten haben will, kann
 * das später als "Werte auch aus allen Kontakten entfernen"-Option
 * bekommen.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { contactFields } from "@/lib/db/schema";
import { requireUserApi } from "@/lib/auth-guard";

export async function PATCH(
  req: NextRequest,
  { params }: { params: { key: string } },
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
  const label = typeof b.label === "string" ? b.label.trim() : "";
  if (!label) {
    return NextResponse.json({ error: "Bitte einen Namen angeben." }, { status: 400 });
  }

  const [row] = await db
    .update(contactFields)
    .set({ label, updatedAt: new Date() })
    .where(and(eq(contactFields.userId, auth.user.id), eq(contactFields.key, params.key)))
    .returning();
  if (!row) {
    return NextResponse.json({ error: "Feld nicht gefunden." }, { status: 404 });
  }
  return NextResponse.json({ field: row });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { key: string } },
) {
  const auth = await requireUserApi();
  if (!auth.ok) return auth.response;
  const rows = await db
    .delete(contactFields)
    .where(and(eq(contactFields.userId, auth.user.id), eq(contactFields.key, params.key)))
    .returning({ id: contactFields.id });
  if (rows.length === 0) {
    return NextResponse.json({ error: "Feld nicht gefunden." }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
