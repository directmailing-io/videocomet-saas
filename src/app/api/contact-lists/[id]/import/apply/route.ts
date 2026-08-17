/**
 * POST /api/contact-lists/:id/import/apply
 *
 * Body: {
 *   parseId: string,
 *   mapping: Record<header, { slot: ContactFieldSlot, customKey?: string, customLabel?: string, customType?: string }>
 * }
 *
 * Mappt die vor-geparste Zeilen-Menge auf Contacts und importiert sie in
 * die Liste :id (falls listId=null-Route: nur ins contacts-Repository).
 * Antwort: { created, updated, skipped }.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { requireUserApi } from "@/lib/auth-guard";
import { bulkImportContacts } from "@/lib/db/queries/contacts";
import {
  deleteParseSnapshot,
  getParseSnapshot,
} from "@/lib/contacts/import-cache";
import type { ContactFieldSlot } from "@/lib/contacts/detect-field";
import { slugifyFieldKey } from "@/lib/contacts/detect-field";

interface FieldMap {
  slot: ContactFieldSlot | "ignore";
  customKey?: string;
  customLabel?: string;
  customType?: string;
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await requireUserApi();
  if (!auth.ok) return auth.response;

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "Ungültiges JSON." }, { status: 400 });
  }
  const b = (raw ?? {}) as Record<string, unknown>;
  const parseId = typeof b.parseId === "string" ? b.parseId : "";
  const mapping = b.mapping as Record<string, FieldMap> | undefined;
  if (!parseId || !mapping) {
    return NextResponse.json({ error: "Import-Info fehlt. Bitte nochmal von vorn beginnen." }, { status: 400 });
  }

  const snap = getParseSnapshot(parseId);
  if (!snap) {
    return NextResponse.json(
      { error: "Der Import war zu lange offen. Bitte die Datei nochmal hochladen." },
      { status: 410 },
    );
  }
  if (snap.userId !== auth.user.id || snap.listId !== params.id) {
    return NextResponse.json({ error: "Dieser Import gehört zu einer anderen Liste." }, { status: 403 });
  }

  // Mapping validieren + gesammelte Custom-Feld-Definitionen extrahieren
  const registerCustomFields: Array<{ key: string; label: string; detectedType: string }> = [];
  const seenCustomKeys = new Set<string>();
  for (const [header, m] of Object.entries(mapping)) {
    if (!snap.headers.includes(header)) continue;
    if (m.slot === "custom") {
      const key = (m.customKey && slugifyFieldKey(m.customKey)) || slugifyFieldKey(header);
      if (!key || seenCustomKeys.has(key)) continue;
      seenCustomKeys.add(key);
      registerCustomFields.push({
        key,
        label: m.customLabel || header,
        detectedType: m.customType || "text",
      });
      // Für die Zeilen-Konvertierung merken wir uns den finalen Key
      mapping[header] = { ...m, customKey: key };
    }
  }

  // Zeilen auf Contact-Objekte projizieren
  const rowsForImport = snap.rows.map((row) => {
    const contact: Parameters<typeof bulkImportContacts>[0]["rows"][number] = {
      data: {},
    };
    for (const [header, m] of Object.entries(mapping)) {
      if (m.slot === "ignore") continue;
      const raw = (row[header] ?? "").trim();
      if (!raw) continue;
      switch (m.slot) {
        case "email":
          contact.email = raw;
          break;
        case "firstName":
          contact.firstName = raw;
          break;
        case "lastName":
          contact.lastName = raw;
          break;
        case "fullName": {
          // Split am ersten Leerzeichen — first / rest
          const parts = raw.split(/\s+/);
          if (parts.length === 1) {
            contact.firstName = parts[0];
          } else {
            contact.firstName = parts[0];
            contact.lastName = parts.slice(1).join(" ");
          }
          break;
        }
        case "company":
          contact.company = raw;
          break;
        case "phone":
          contact.phone = raw;
          break;
        case "linkedinUrl":
          contact.linkedinUrl = raw;
          break;
        case "salutation":
          contact.salutation = raw;
          break;
        case "title":
          contact.title = raw;
          break;
        case "externalId":
          contact.externalId = raw;
          break;
        case "street":
          contact.street = raw;
          break;
        case "postalCode":
          contact.postalCode = raw;
          break;
        case "city":
          contact.city = raw;
          break;
        case "country":
          contact.country = raw;
          break;
        case "position":
          contact.position = raw;
          break;
        case "website":
          contact.website = raw;
          break;
        case "gender":
          contact.gender = raw;
          break;
        case "custom": {
          const key = m.customKey ?? slugifyFieldKey(header);
          if (key) (contact.data ??= {})[key] = raw;
          break;
        }
        default:
          break;
      }
    }
    return contact;
  });

  try {
    const result = await bulkImportContacts({
      userId: auth.user.id,
      listId: params.id,
      rows: rowsForImport,
      registerCustomFields,
    });
    deleteParseSnapshot(parseId);
    return NextResponse.json({
      created: result.created,
      updated: result.updated,
      skipped: result.skipped,
      totalAdded: result.contactIds.length,
    });
  } catch (err) {
    return NextResponse.json(
      { error: "Import hat gerade nicht geklappt. Bitte in einem Moment nochmal probieren.", details: err instanceof Error ? err.message : null },
      { status: 500 },
    );
  }
}
