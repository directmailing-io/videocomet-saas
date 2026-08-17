/**
 * Placeholder-auf-Contact-Property-Mapping für den neuen Runden-Wizard v4.
 *
 * Altes Format (aus dem CSV-Wizard):
 *   `{ firstName: { column: "Vorname", fallback: "Kunde" } }`
 *
 * Neues Format (Contact-basiert):
 *   `{ firstName: { source: "contactField", field: "firstName" } }`
 *   `{ pageUrl:   { source: "systemUrl",   field: "pageUrl" } }`
 *   `{ praxisUmsatz: { source: "customField", field: "praxis_umsatz", fallback: "0 €" } }`
 *
 * Beide Formate werden vom Runden-Start akzeptiert (Rückwärts-Kompat), das
 * neue wird von neuen Runs bevorzugt.
 */

export type ContactMappingSource = "contactField" | "customField" | "systemUrl";

export interface ContactMappingEntry {
  source: ContactMappingSource;
  /**
   * - contactField: eines aus BASE_CONTACT_FIELDS (email, firstName, ...)
   * - customField:  key im contacts.data-jsonb (z.B. "praxis_umsatz")
   * - systemUrl:    einer aus SYSTEM_SOURCES (z.B. "pageUrl", "pageUrlShort")
   */
  field: string;
  /** Fallback wenn das Feld leer ist. */
  fallback?: string;
}

export type ContactMapping = Record<string, ContactMappingEntry>;

/** Die Basis-Felder eines Contacts, die als Placeholder-Quelle verwendbar sind. */
export const BASE_CONTACT_FIELDS = [
  "email",
  "firstName",
  "lastName",
  "company",
  "phone",
  "linkedinUrl",
] as const;
export type BaseContactField = (typeof BASE_CONTACT_FIELDS)[number];

/** System-generierte Werte, die nicht aus dem Kontakt kommen. */
export const SYSTEM_SOURCES = ["pageUrl", "pageUrlShort"] as const;
export type SystemSource = (typeof SYSTEM_SOURCES)[number];

/**
 * Anwendungs-Objekt: alle Werte, aus denen ein Placeholder-Wert
 * berechnet werden kann. Wird pro Lead-Erstellung aufgebaut.
 */
export interface ContactMappingContext {
  contact: {
    email: string | null;
    firstName: string | null;
    lastName: string | null;
    company: string | null;
    companyDisplay: string | null;
    phone: string | null;
    linkedinUrl: string | null;
    data: Record<string, string>;
  };
  system: {
    pageUrl?: string | null;
    pageUrlShort?: string | null;
  };
}

/**
 * Löst einen einzelnen Placeholder gegen den Kontext auf.
 * Rückgabe: der finale String (oder "", wenn kein Wert + kein Fallback).
 */
export function resolveContactMappingEntry(
  entry: ContactMappingEntry,
  ctx: ContactMappingContext,
): string {
  let raw: string | null | undefined;
  switch (entry.source) {
    case "contactField":
      if (entry.field === "email") raw = ctx.contact.email;
      else if (entry.field === "firstName") raw = ctx.contact.firstName;
      else if (entry.field === "lastName") raw = ctx.contact.lastName;
      else if (entry.field === "company")
        raw = ctx.contact.companyDisplay ?? ctx.contact.company;
      else if (entry.field === "phone") raw = ctx.contact.phone;
      else if (entry.field === "linkedinUrl") raw = ctx.contact.linkedinUrl;
      else raw = null;
      break;
    case "customField":
      raw = ctx.contact.data?.[entry.field] ?? null;
      break;
    case "systemUrl":
      if (entry.field === "pageUrl") raw = ctx.system.pageUrl;
      else if (entry.field === "pageUrlShort") raw = ctx.system.pageUrlShort;
      else raw = null;
      break;
  }
  const clean = raw == null ? "" : String(raw).trim();
  if (clean.length > 0) return clean;
  return entry.fallback ?? "";
}

/**
 * Baut das `data`-jsonb für einen Lead: neben den Placeholder-Werten
 * werden immer auch die Basis-Contact-Felder (firstName, email etc.)
 * als Convenience-Keys mitgegeben — die Pipeline nutzt sie z. B. für
 * Slug-Generierung oder den PDF-Renderer.
 */
export function buildLeadDataFromContact(
  mapping: ContactMapping,
  ctx: ContactMappingContext,
): Record<string, string> {
  const data: Record<string, string> = {};
  // Basis-Felder immer mitgeben (falls im Contact vorhanden)
  if (ctx.contact.email) data.email = ctx.contact.email;
  if (ctx.contact.firstName) data.firstName = ctx.contact.firstName;
  if (ctx.contact.lastName) data.lastName = ctx.contact.lastName;
  const comp = ctx.contact.companyDisplay ?? ctx.contact.company;
  if (comp) data.company = comp;
  if (ctx.contact.phone) data.phone = ctx.contact.phone;
  if (ctx.contact.linkedinUrl) data.linkedin = ctx.contact.linkedinUrl;

  // Alle Custom-Felder mitgeben (unter Original-Key)
  for (const [k, v] of Object.entries(ctx.contact.data ?? {})) {
    if (v && typeof v === "string" && v.trim().length > 0) data[k] = v;
  }

  // Placeholder-Werte oben drauf — überschreiben Basis-Felder falls Konflikt.
  for (const [key, entry] of Object.entries(mapping)) {
    const val = resolveContactMappingEntry(entry, ctx);
    if (val) data[key] = val;
  }
  return data;
}

/**
 * Sehr defensive Normalisierung eines vom Client gesendeten Mapping-Objekts.
 * Unbekannte Sources oder Fields werden verworfen.
 */
export function normalizeContactMapping(input: unknown): ContactMapping {
  if (!input || typeof input !== "object") return {};
  const out: ContactMapping = {};
  for (const [key, val] of Object.entries(input as Record<string, unknown>)) {
    if (!val || typeof val !== "object") continue;
    const v = val as Record<string, unknown>;
    const source = v.source;
    const field = typeof v.field === "string" ? v.field : "";
    const fallback = typeof v.fallback === "string" ? v.fallback : undefined;
    if (source === "contactField") {
      if (!BASE_CONTACT_FIELDS.includes(field as BaseContactField)) continue;
      out[key] = { source: "contactField", field, fallback };
    } else if (source === "customField") {
      if (!field || !/^[a-z0-9_]+$/i.test(field)) continue;
      out[key] = { source: "customField", field, fallback };
    } else if (source === "systemUrl") {
      if (!SYSTEM_SOURCES.includes(field as SystemSource)) continue;
      out[key] = { source: "systemUrl", field, fallback };
    }
  }
  return out;
}

/**
 * Rät ein Auto-Mapping: für jeden Placeholder wird versucht, ihn auf ein
 * gleichnamiges Basis-Feld oder Custom-Feld zu mappen. Fällt aus, wenn's
 * keinen Match gibt (Caller kann die Zeile leer lassen und den User
 * entscheiden lassen).
 */
export function suggestContactMapping(input: {
  placeholderKeys: string[];
  customFieldKeys: string[];
  systemPageUrl?: boolean;
}): ContactMapping {
  const mapping: ContactMapping = {};
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const baseByNorm = new Map<string, BaseContactField>();
  for (const f of BASE_CONTACT_FIELDS) baseByNorm.set(norm(f), f);
  const customByNorm = new Map<string, string>();
  for (const k of input.customFieldKeys) customByNorm.set(norm(k), k);

  for (const key of input.placeholderKeys) {
    const nk = norm(key);
    // 1) System-URL zuerst
    if (input.systemPageUrl && (nk === "pageurl" || nk === "url")) {
      mapping[key] = { source: "systemUrl", field: "pageUrl" };
      continue;
    }
    // 2) Basis-Contact-Feld
    const base = baseByNorm.get(nk);
    if (base) {
      mapping[key] = { source: "contactField", field: base };
      continue;
    }
    // 3) Custom-Feld
    const cust = customByNorm.get(nk);
    if (cust) {
      mapping[key] = { source: "customField", field: cust };
      continue;
    }
    // 4) Kein Match — wird als "leer" behandelt bis User zuweist
  }
  return mapping;
}
