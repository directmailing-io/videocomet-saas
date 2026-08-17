/**
 * Single-Contact-API auf dem neuen contacts-Modell (Migration 0054).
 *
 *   GET    /api/contacts/v2/:id  — Detail-Objekt (Contact + Listen + Occurrences)
 *   PATCH  /api/contacts/v2/:id  — inline-Feld-Update
 *   DELETE /api/contacts/v2/:id  — Soft-Delete (deleted_at, Kaskade via FK)
 *
 * Der alte /api/contacts/[id]-Endpoint bleibt für DSGVO-Hard-Delete
 * bestehen (arbeitet auf leads-Aggregat, dt. Confirmation-Text).
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { requireUserApi } from "@/lib/auth-guard";
import { db } from "@/lib/db";
import { contactFields } from "@/lib/db/schema";
import {
  getContactDetail,
  softDeleteContact,
  updateContact,
} from "@/lib/db/queries/contacts";
import { slugifyFieldKey } from "@/lib/contacts/detect-field";

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await requireUserApi();
  if (!auth.ok) return auth.response;

  const detail = await getContactDetail({
    userId: auth.user.id,
    contactId: params.id,
  });
  if (!detail) {
    return NextResponse.json({ error: "Diesen Kontakt gibt es nicht mehr." }, { status: 404 });
  }
  return NextResponse.json(detail);
}

function asStrOrNull(v: unknown): string | null | undefined {
  if (v === undefined) return undefined;
  if (v === null) return null;
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t === "" ? null : t;
}

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
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Body erwartet." }, { status: 400 });
  }
  const b = body as Record<string, unknown>;

  const patch: Parameters<typeof updateContact>[0]["patch"] = {};
  const first = asStrOrNull(b.firstName);
  if (first !== undefined) patch.firstName = first;
  const last = asStrOrNull(b.lastName);
  if (last !== undefined) patch.lastName = last;
  const email = asStrOrNull(b.email);
  if (email !== undefined) patch.email = email;
  const company = asStrOrNull(b.company);
  if (company !== undefined) {
    patch.company = company ? company.toLowerCase() : null;
    patch.companyDisplay = company;
  }
  const phone = asStrOrNull(b.phone);
  if (phone !== undefined) patch.phone = phone;
  const linkedin = asStrOrNull(b.linkedinUrl);
  if (linkedin !== undefined) patch.linkedinUrl = linkedin;
  // Erweiterte Basis-Felder (Migration 0058)
  const salutation = asStrOrNull(b.salutation);
  if (salutation !== undefined) patch.salutation = salutation;
  const title = asStrOrNull(b.title);
  if (title !== undefined) patch.title = title;
  const externalId = asStrOrNull(b.externalId);
  if (externalId !== undefined) patch.externalId = externalId;
  const street = asStrOrNull(b.street);
  if (street !== undefined) patch.street = street;
  const postalCode = asStrOrNull(b.postalCode);
  if (postalCode !== undefined) patch.postalCode = postalCode;
  const city = asStrOrNull(b.city);
  if (city !== undefined) patch.city = city;
  const country = asStrOrNull(b.country);
  if (country !== undefined) patch.country = country;
  const position = asStrOrNull(b.position);
  if (position !== undefined) patch.position = position;
  const website = asStrOrNull(b.website);
  if (website !== undefined) patch.website = website;
  const gender = asStrOrNull(b.gender);
  if (gender !== undefined) patch.gender = gender;
  if (b.data && typeof b.data === "object" && !Array.isArray(b.data)) {
    const clean: Record<string, string> = {};
    for (const [k, v] of Object.entries(b.data)) {
      if (typeof v === "string") clean[k] = v;
    }
    patch.data = clean;
  }

  // Optional: gleichzeitig ein Custom-Feld beim User registrieren
  // (wenn im Slide-Over „+ Feld hinzufügen" geklickt wurde).
  if (b.registerCustomField && typeof b.registerCustomField === "object") {
    const r = b.registerCustomField as Record<string, unknown>;
    const rawKey = typeof r.key === "string" ? r.key : null;
    const label = typeof r.label === "string" ? r.label.trim() : null;
    if (rawKey && label) {
      const key = slugifyFieldKey(rawKey) || slugifyFieldKey(label);
      if (key) {
        await db.execute(sql`
          INSERT INTO contact_fields (user_id, key, label, detected_type, usage_count)
          VALUES (${auth.user.id}, ${key}, ${label}, 'text', 1)
          ON CONFLICT (user_id, key)
          DO UPDATE SET usage_count = contact_fields.usage_count + 1,
                        label = COALESCE(EXCLUDED.label, contact_fields.label),
                        updated_at = now()
        `);
      }
    }
  }

  const row = await updateContact({
    userId: auth.user.id,
    contactId: params.id,
    patch,
  });
  if (!row) {
    return NextResponse.json({ error: "Diesen Kontakt gibt es nicht mehr." }, { status: 404 });
  }
  return NextResponse.json({ contact: row });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await requireUserApi();
  if (!auth.ok) return auth.response;

  const ok = await softDeleteContact({
    userId: auth.user.id,
    contactId: params.id,
    reason: "user_deleted",
  });
  if (!ok) {
    return NextResponse.json({ error: "Diesen Kontakt gibt es nicht mehr." }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
