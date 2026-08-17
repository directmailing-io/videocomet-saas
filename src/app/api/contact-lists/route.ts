/**
 * Listen-API (Mini-CRM Etappe 2).
 *
 *   GET  /api/contact-lists          — Alle Listen des Users
 *   POST /api/contact-lists          — Neue Liste anlegen
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { requireUserApi } from "@/lib/auth-guard";
import {
  createContactList,
  listContactLists,
} from "@/lib/db/queries/contacts";

export async function GET(_req: NextRequest) {
  const auth = await requireUserApi();
  if (!auth.ok) return auth.response;

  const lists = await listContactLists({ userId: auth.user.id });
  return NextResponse.json({ lists });
}

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
  const name = typeof b.name === "string" ? b.name.trim() : "";
  if (!name) {
    return NextResponse.json({ error: "Name erwartet." }, { status: 400 });
  }
  if (name.length > 80) {
    return NextResponse.json(
      { error: "Name darf max. 80 Zeichen haben." },
      { status: 400 },
    );
  }

  try {
    const list = await createContactList({
      userId: auth.user.id,
      name,
      description: typeof b.description === "string" ? b.description : null,
      color: typeof b.color === "string" ? b.color : null,
      icon: typeof b.icon === "string" ? b.icon : null,
    });
    return NextResponse.json({ list }, { status: 201 });
  } catch (err) {
    // Uniqueness-Konflikt sauber ummünzen.
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("contact_lists_user_name_uq")) {
      return NextResponse.json(
        { error: "Eine Liste mit diesem Namen existiert bereits." },
        { status: 409 },
      );
    }
    return NextResponse.json(
      { error: "Liste konnte nicht angelegt werden.", details: msg },
      { status: 500 },
    );
  }
}
