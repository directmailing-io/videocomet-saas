/**
 * GET  /api/contact-fields — alle Custom-Feld-Definitionen des Users
 * POST /api/contact-fields — neues Feld anlegen (global)
 *
 * Feld-Definitionen wirken sich sofort auf ALLE Kontakte aus: das Feld
 * taucht als Spalte in der Tabelle auf und ist im Filter auswählbar.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { contactFields } from "@/lib/db/schema";
import { requireUserApi } from "@/lib/auth-guard";
import { slugifyFieldKey } from "@/lib/contacts/detect-field";

export async function GET(_req: NextRequest) {
  const auth = await requireUserApi();
  if (!auth.ok) return auth.response;

  const rows = await db
    .select({
      id: contactFields.id,
      key: contactFields.key,
      label: contactFields.label,
      detectedType: contactFields.detectedType,
      usageCount: contactFields.usageCount,
      createdAt: contactFields.createdAt,
    })
    .from(contactFields)
    .where(eq(contactFields.userId, auth.user.id))
    .orderBy(contactFields.label);

  return NextResponse.json({ fields: rows });
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
  const label = typeof b.label === "string" ? b.label.trim() : "";
  const type = typeof b.type === "string" ? b.type : "text";
  const allowedTypes = ["email", "phone", "url", "text", "number", "date"];
  const detectedType = allowedTypes.includes(type) ? type : "text";

  if (!label) {
    return NextResponse.json({ error: "Bitte gib dem Feld einen Namen." }, { status: 400 });
  }
  if (label.length > 60) {
    return NextResponse.json({ error: "Der Name ist zu lang. Maximal 60 Zeichen." }, { status: 400 });
  }

  const key = slugifyFieldKey(label);
  if (!key) {
    return NextResponse.json(
      { error: "Der Name enthält keine Buchstaben oder Zahlen, mit denen wir arbeiten können." },
      { status: 400 },
    );
  }

  try {
    const [row] = await db
      .insert(contactFields)
      .values({
        userId: auth.user.id,
        key,
        label,
        detectedType: detectedType as never,
        usageCount: 0,
      })
      .returning();
    return NextResponse.json({ field: row }, { status: 201 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("contact_fields_user_key_uq")) {
      return NextResponse.json(
        { error: `Du hast schon ein Feld mit dem Namen "${label}".` },
        { status: 409 },
      );
    }
    return NextResponse.json(
      { error: "Speichern hat gerade nicht geklappt. Bitte in einem Moment nochmal probieren." },
      { status: 500 },
    );
  }
}
