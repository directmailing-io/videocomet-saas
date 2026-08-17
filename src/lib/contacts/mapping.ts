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

/**
 * Wenn-Dann-Regel für einen Placeholder. Klassischer Use-Case:
 * „Wenn Land = Deutschland, DE, D → leer lassen" (Inlands-Absender
 * schreibt kein Land auf den Umschlag). Für Österreich und Schweiz
 * analog. Der User pflegt selbst welche Werte matchen sollen.
 */
export interface ContactMappingRule {
  /** Match-Werte (Groß-/Kleinschreibung, Whitespace, Leerräume egal). */
  equalsAnyOf: string[];
  /** Was passiert wenn eine Bedingung matcht. */
  then: "empty" | "replace";
  /** Ersatzwert wenn `then=replace`. */
  replaceWith?: string;
}

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
  /** Wenn-Dann-Regeln, werden VOR dem Fallback ausgewertet. */
  rules?: ContactMappingRule[];
}

/** Presets für die häufigste Wenn-Dann-Regel: eigenes Land ausblenden. */
export const COUNTRY_HIDE_PRESETS: Array<{ key: string; label: string; values: string[] }> = [
  {
    key: "de",
    label: "Deutschland ausblenden",
    values: ["Deutschland", "DE", "D", "Germany", "BRD"],
  },
  {
    key: "at",
    label: "Österreich ausblenden",
    values: ["Österreich", "Oesterreich", "AT", "A", "Austria"],
  },
  {
    key: "ch",
    label: "Schweiz ausblenden",
    values: ["Schweiz", "CH", "CHE", "Switzerland", "Suisse"],
  },
];

export type ContactMapping = Record<string, ContactMappingEntry>;

/** Die Basis-Felder eines Contacts, die als Placeholder-Quelle verwendbar sind. */
export const BASE_CONTACT_FIELDS = [
  "email",
  "firstName",
  "lastName",
  "company",
  "phone",
  "linkedinUrl",
  // Erweitert mit Migration 0058
  "salutation",
  "title",
  "externalId",
  "street",
  "postalCode",
  "city",
  "country",
  "position",
  "website",
  "gender",
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
    // Erweitert mit Migration 0058
    salutation?: string | null;
    title?: string | null;
    externalId?: string | null;
    street?: string | null;
    postalCode?: string | null;
    city?: string | null;
    country?: string | null;
    position?: string | null;
    website?: string | null;
    gender?: string | null;
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
      else if (entry.field === "salutation") raw = ctx.contact.salutation;
      else if (entry.field === "title") raw = ctx.contact.title;
      else if (entry.field === "externalId") raw = ctx.contact.externalId;
      else if (entry.field === "street") raw = ctx.contact.street;
      else if (entry.field === "postalCode") raw = ctx.contact.postalCode;
      else if (entry.field === "city") raw = ctx.contact.city;
      else if (entry.field === "country") raw = ctx.contact.country;
      else if (entry.field === "position") raw = ctx.contact.position;
      else if (entry.field === "website") raw = ctx.contact.website;
      else if (entry.field === "gender") raw = ctx.contact.gender;
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

  // Wenn-Dann-Regeln VOR dem Fallback auswerten.
  if (clean.length > 0 && entry.rules && entry.rules.length > 0) {
    const norm = clean.toLowerCase().replace(/\s+/g, "");
    for (const rule of entry.rules) {
      const matches = rule.equalsAnyOf.some(
        (v) => v.toLowerCase().replace(/\s+/g, "") === norm,
      );
      if (matches) {
        if (rule.then === "empty") return "";
        if (rule.then === "replace") return rule.replaceWith ?? "";
      }
    }
  }

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
  // Erweiterte Basis-Felder (Migration 0058)
  if (ctx.contact.salutation) data.salutation = ctx.contact.salutation;
  if (ctx.contact.title) data.title = ctx.contact.title;
  if (ctx.contact.externalId) data.externalId = ctx.contact.externalId;
  if (ctx.contact.street) data.street = ctx.contact.street;
  if (ctx.contact.postalCode) data.postalCode = ctx.contact.postalCode;
  if (ctx.contact.city) data.city = ctx.contact.city;
  if (ctx.contact.country) data.country = ctx.contact.country;
  if (ctx.contact.position) data.position = ctx.contact.position;
  if (ctx.contact.website) data.website = ctx.contact.website;
  if (ctx.contact.gender) data.gender = ctx.contact.gender;

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
    const rules = Array.isArray(v.rules) ? normalizeRules(v.rules) : undefined;
    if (source === "contactField") {
      if (!BASE_CONTACT_FIELDS.includes(field as BaseContactField)) continue;
      out[key] = { source: "contactField", field, fallback, rules };
    } else if (source === "customField") {
      if (!field || !/^[a-z0-9_]+$/i.test(field)) continue;
      out[key] = { source: "customField", field, fallback, rules };
    } else if (source === "systemUrl") {
      if (!SYSTEM_SOURCES.includes(field as SystemSource)) continue;
      out[key] = { source: "systemUrl", field, fallback, rules };
    }
  }
  return out;
}

function normalizeRules(input: unknown[]): ContactMappingRule[] {
  const out: ContactMappingRule[] = [];
  for (const raw of input) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const equalsAnyOf = Array.isArray(r.equalsAnyOf)
      ? r.equalsAnyOf.filter((v): v is string => typeof v === "string" && v.trim().length > 0)
      : [];
    if (equalsAnyOf.length === 0) continue;
    const then = r.then === "replace" ? "replace" : "empty";
    const replaceWith = typeof r.replaceWith === "string" ? r.replaceWith : undefined;
    out.push({ equalsAnyOf, then, replaceWith });
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
