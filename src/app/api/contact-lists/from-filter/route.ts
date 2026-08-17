/**
 * POST /api/contact-lists/from-filter
 *
 * Legt eine neue Liste aus dem Ergebnis eines Filters an.
 *
 * Body: {
 *   name: string
 *   filter: FilterDefinition
 *   type?: "static" | "smart"   // static (default): Ergebnis materialisiert
 *                               // smart: Filter gespeichert, Ergebnis live
 *   listId?: string             // zusätzlicher Membership-Filter beim Auswerten
 *   description?: string
 * }
 *
 * Für "static" wird der Filter EINMAL ausgewertet und die passenden Contacts
 * per bulk-INSERT in list_memberships gesteckt. Für "smart" wird der Filter
 * in contact_lists.smart_filter gespeichert; die Auswertung geschieht live
 * bei jeder Anfrage (via listId → Smart-Path im UI).
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { requireUserApi } from "@/lib/auth-guard";
import { db } from "@/lib/db";
import { contactLists } from "@/lib/db/schema";
import {
  addContactsToList,
  createContactList,
  listContacts,
} from "@/lib/db/queries/contacts";
import { normalizeFilter } from "@/lib/contacts/filter";
import { eq } from "drizzle-orm";

export async function POST(req: NextRequest) {
  const auth = await requireUserApi();
  if (!auth.ok) return auth.response;

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "Ungültiges JSON." }, { status: 400 });
  }
  const body = (raw ?? {}) as Record<string, unknown>;

  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) return NextResponse.json({ error: "Bitte gib der Liste einen Namen." }, { status: 400 });
  if (name.length > 80) {
    return NextResponse.json({ error: "Der Name ist zu lang. Maximal 80 Zeichen." }, { status: 400 });
  }
  const type = body.type === "smart" ? "smart" : "static";
  const filter = normalizeFilter(body.filter);
  const listId = typeof body.listId === "string" ? body.listId : null;

  try {
    const list = await createContactList({
      userId: auth.user.id,
      name,
      description:
        typeof body.description === "string" ? body.description : null,
    });

    if (type === "smart") {
      // Smart-Liste: Filter in contact_lists.smart_filter speichern, keine
      // Materialisierung. Auswertung passiert bei jedem Query gegen die
      // Liste (siehe /api/contacts/v2 mit listId → Smart-Path).
      await db
        .update(contactLists)
        .set({ type: "smart", smartFilter: filter as unknown as Record<string, unknown> })
        .where(eq(contactLists.id, list.id));
      return NextResponse.json(
        { list: { ...list, type: "smart", smartFilter: filter } },
        { status: 201 },
      );
    }

    // Statisch: Filter auswerten, alle matchenden Contact-IDs holen, in
    // list_memberships stecken.
    const filtered = await listContacts({
      userId: auth.user.id,
      listId,
      filter,
      limit: 5000, // Sicherheit: bei sehr großen Ergebnissen sollte
      // später eine Streaming-Insertion her, für Etappe 4 reicht das.
    });
    const contactIds = filtered.contacts.map((c) => c.id);
    const { added } = await addContactsToList({
      userId: auth.user.id,
      listId: list.id,
      contactIds,
      via: "filter",
    });

    return NextResponse.json(
      { list, added, matched: filtered.total },
      { status: 201 },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("contact_lists_user_name_uq")) {
      return NextResponse.json(
        { error: `Du hast schon eine Liste mit dem Namen "${name}". Wähl einen anderen Namen.` },
        { status: 409 },
      );
    }
    return NextResponse.json(
      { error: "Speichern hat gerade nicht geklappt. Bitte in einem Moment nochmal probieren.", details: msg },
      { status: 500 },
    );
  }
}
