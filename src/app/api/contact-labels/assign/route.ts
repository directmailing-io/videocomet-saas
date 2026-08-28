/**
 * POST /api/contact-labels/assign — Label an Kontakte vergeben oder entfernen.
 * Body: { contactIds: string[], action: "add" | "remove",
 *         labelId?: string, create?: { name: string, color?: string } }
 * Entweder labelId (bestehendes Label) oder create (neues Label, nur bei add).
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { requireUserApi } from "@/lib/auth-guard";
import {
  assignLabelToContacts,
  getOrCreateContactLabel,
  removeLabelFromContacts,
} from "@/lib/db/queries/contact-labels";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: NextRequest) {
  const auth = await requireUserApi();
  if (!auth.ok) return auth.response;

  let body: {
    contactIds?: unknown;
    action?: unknown;
    labelId?: unknown;
    create?: { name?: unknown; color?: unknown };
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Ungültige Anfrage." }, { status: 400 });
  }

  const contactIds = Array.isArray(body.contactIds)
    ? body.contactIds.filter((id): id is string => typeof id === "string" && UUID_RE.test(id))
    : [];
  if (contactIds.length === 0 || contactIds.length > 2000) {
    return NextResponse.json(
      { error: "Bitte wähle 1 bis 2000 Kontakte aus." },
      { status: 400 },
    );
  }
  const action = body.action === "remove" ? "remove" : "add";

  let labelId: string;
  if (typeof body.labelId === "string" && UUID_RE.test(body.labelId)) {
    labelId = body.labelId;
  } else if (action === "add" && typeof body.create?.name === "string") {
    const name = body.create.name.trim();
    if (!name) {
      return NextResponse.json(
        { error: "Bitte gib einen Label-Namen ein." },
        { status: 400 },
      );
    }
    const color =
      typeof body.create.color === "string" && /^#[0-9a-fA-F]{6}$/.test(body.create.color)
        ? body.create.color
        : undefined;
    const label = await getOrCreateContactLabel({ userId: auth.user.id, name, color });
    labelId = label.id;
  } else {
    return NextResponse.json({ error: "Kein Label angegeben." }, { status: 400 });
  }

  try {
    const count =
      action === "add"
        ? await assignLabelToContacts({ userId: auth.user.id, labelId, contactIds })
        : await removeLabelFromContacts({ userId: auth.user.id, labelId, contactIds });
    return NextResponse.json({ ok: true, labelId, count });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Aktion fehlgeschlagen." },
      { status: 400 },
    );
  }
}
