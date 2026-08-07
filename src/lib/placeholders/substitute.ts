/**
 * Einheitliche Platzhalter-Substitution.
 *
 * Eine Funktion ersetzt alle vier Formate:
 *   - `double-brace`           `{{key}}`               (Text-Segmente)
 *   - `double-brace-fallback`  `{{key|fallback}}`      (LP / Custom-LP / gdocs)
 *   - `tiptap-span`            `<span data-placeholder="…">…</span>`
 *                              (zusätzlich {{key}} im HTML als Fallback)
 *   - `single-brace`           `{key}`                 (Slug-Template)
 *
 * Backward-Compat:
 *   Falls das Mapping fehlt oder als `Record<string,string>` daherkommt,
 *   fällt die Logik auf das alte Verhalten zurück (key === column). Damit
 *   bleiben bestehende Runs unverändert lauffähig.
 *
 * Lookup-Reihenfolge pro Key:
 *   1. Mapping-Entry `column` → `leadData[column]` (exakt, dann CI-Variante)
 *   2. Mapping-Entry `fallback` (statisch)
 *   3. `leadData[key]` (direkter Treffer, key === column, alter Modus)
 *   4. `leadData[<CI-Match auf key>]`
 *   5. `""` (leer)
 */

import type {
  LegacyMapping,
  PlaceholderFormat,
  PlaceholderMapping,
  PlaceholderMappingEntry,
} from "./types";
import { findMatchingRule } from "./rules";

/**
 * System-Platzhalter sind reservierte Keys, die NICHT aus Lead-Daten
 * stammen, sondern von der Pipeline pro Lead/Run berechnet werden
 * (z.B. die Kurz-URL der Landingpage). System-Keys haben Vorrang vor
 * gleichnamigen Lead-Daten — d.h. ein User kann keinen `pageUrl`-Wert
 * aus dem CSV durchschieben, der die berechnete URL überschreibt.
 *
 * Wird zentral exportiert, damit Slug-Engine + UI-Validierung (Wizard)
 * gegen dieselbe Liste prüfen können.
 */
export const SYSTEM_PLACEHOLDERS = ["pageUrl"] as const;
export type SystemPlaceholderKey = (typeof SYSTEM_PLACEHOLDERS)[number];

/**
 * Magic-Mapping-Werte: Wenn der User im Run-Wizard beim Mapping diesen
 * Sentinel als „Spalte" wählt, wird der Platzhalter NICHT aus den CSV-
 * Daten befüllt, sondern beim Render mit dem System-Wert ersetzt.
 *
 * Format `@system:<key>`. So bleibt der Sentinel vom CSV-Namespace
 * eindeutig getrennt (CSV-Spalten dürfen kein `@` enthalten).
 */
export const SYSTEM_MAPPING_PAGE_URL = "@system:pageUrl" as const;
export const SYSTEM_MAPPING_VALUES = [SYSTEM_MAPPING_PAGE_URL] as const;

/** Liefert den System-Key, wenn der Mapping-Wert ein Sentinel ist. */
export function parseSystemMappingValue(
  v: string | null | undefined,
): SystemPlaceholderKey | null {
  if (v === SYSTEM_MAPPING_PAGE_URL) return "pageUrl";
  return null;
}

/**
 * Schreibweisen-Aliase für System-Keys. User tippen den Platzhalter im
 * Google-Docs oft anders als unsere canonical-Form ({{pageUrl}}).
 * Wir akzeptieren alle gängigen Varianten — Bindestrich, Underscore,
 * Lowercase, mit/ohne "url"-Suffix, deutsche Schreibweise.
 *
 * Lookup ist case-insensitive (siehe `resolveSystemValue`).
 */
const SYSTEM_PLACEHOLDER_ALIASES: Record<string, SystemPlaceholderKey> = {
  // pageUrl — canonical
  pageurl: "pageUrl",
  "page-url": "pageUrl",
  page_url: "pageUrl",
  // Englisch — Landingpage
  landingpageurl: "pageUrl",
  "landingpage-url": "pageUrl",
  landingpage_url: "pageUrl",
  landingpageUrl: "pageUrl",
  // Mit "URL" am Ende getrennt
  "landing-page-url": "pageUrl",
  landing_page_url: "pageUrl",
  landingPageUrl: "pageUrl",
  // Deutsch — Landingpage / Webseite
  "landingpage-link": "pageUrl",
  landingpagelink: "pageUrl",
  landingpage: "pageUrl",
  "landing-page": "pageUrl",
  // Kurzformen (uname = url-name)
  uname: "pageUrl",
  "u-name": "pageUrl",
  u_name: "pageUrl",
  urlname: "pageUrl",
  "url-name": "pageUrl",
  url_name: "pageUrl",
  // Generisch
  url: "pageUrl",
  link: "pageUrl",
};

/**
 * Erweiterter Substitution-Context. Lead-Daten sind weiterhin Pflicht;
 * `system` enthält von der Pipeline berechnete Werte wie `pageUrl`.
 *
 * Felder sind alle optional — ein fehlender System-Wert bedeutet
 * „nicht verfügbar", die normale Lookup-Kette greift dann (Lead-Daten
 * oder Fallback). Ein explizit gesetzter `null`-Wert wird wie „nicht
 * verfügbar" behandelt.
 */
export interface SubstitutionSystemContext {
  /** Lead-Page-URL in Kurzform (ohne Protokoll). Berechnet via buildPageUrlShort. */
  pageUrl?: string | null;
  /**
   * Kampagnen-spezifische User-Aliase für `pageUrl` — zusaetzlich zu
   * den built-in Aliasen. Werden case-insensitive geprueft. Beispiel:
   * `["lp", "kundenlink", "meine-seite"]` → `{{lp}}` etc. landen auf
   * der Landingpage-URL.
   */
  pageUrlAliases?: ReadonlyArray<string> | null;
}

/**
 * Liefert den aufgelösten System-Wert für einen Key — oder `null`, wenn
 * der Key kein System-Key ist oder der Context den Wert nicht liefert.
 *
 * Case-sensitive: das Wording im Spec ist `{{pageUrl}}`. Wenn wir CI
 * matchen würden, kollidieren wir potentiell mit Lead-Spalten "pageurl".
 */
/**
 * Normalisiert einen User-Alias (z. B. " LP ", "Kunden-Link!") auf eine
 * vergleichbare Form: trim, lowercase, alphanumerisch+`-_`. Damit kann
 * der User in der UI tippen wie er will und wir matchen robust.
 */
function normalizeUserAlias(raw: string): string {
  return raw.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "");
}

function isPageUrlUserAlias(
  key: string,
  system: SubstitutionSystemContext,
): boolean {
  if (!system.pageUrlAliases || system.pageUrlAliases.length === 0) return false;
  const target = normalizeUserAlias(key);
  if (!target) return false;
  for (const a of system.pageUrlAliases) {
    if (typeof a !== "string") continue;
    if (normalizeUserAlias(a) === target) return true;
  }
  return false;
}

function resolveSystemValue(
  key: string,
  system: SubstitutionSystemContext | undefined,
): string | null {
  if (!system) return null;
  // Canonical match first, dann case-insensitive Alias-Lookup. So bleiben
  // bestehende Caller mit `{{pageUrl}}` unverändert schnell, neue
  // Schreibweisen funktionieren transparent mit.
  let canonical: SystemPlaceholderKey | null =
    key === "pageUrl" ? "pageUrl" : null;
  if (!canonical) {
    // User-konfigurierte Aliase haben hoechste Prioritaet ueber den
    // built-in-Aliasen — der User darf seinen eigenen Schreibstil
    // explizit registrieren, ohne dass wir das Codebase erweitern.
    if (isPageUrlUserAlias(key, system)) canonical = "pageUrl";
  }
  if (!canonical) {
    const lower = key.toLowerCase();
    canonical = SYSTEM_PLACEHOLDER_ALIASES[lower] ?? null;
  }
  if (!canonical) return null;
  if (canonical === "pageUrl") {
    const v = system.pageUrl;
    return typeof v === "string" && v.length > 0 ? v : null;
  }
  return null;
}

/**
 * Helper: case-insensitive Lookup eines Wertes über `leadData`.
 * Liefert den ersten nicht-leeren Treffer oder `null`.
 */
function lookupLeadValueCI(
  data: Record<string, string>,
  columnName: string,
): string | null {
  const direct = data[columnName];
  if (typeof direct === "string" && direct.trim().length > 0) return direct;
  const target = columnName.toLowerCase();
  for (const [k, v] of Object.entries(data)) {
    if (
      k.toLowerCase() === target &&
      typeof v === "string" &&
      v.trim().length > 0
    ) {
      return v;
    }
  }
  return null;
}

/**
 * Type-Guard: ein als unknown gespeichertes Mapping kann legacy
 * `Record<string,string>` ODER die neue `PlaceholderMapping` sein.
 */
function isLegacyMapping(
  m: PlaceholderMapping | LegacyMapping | undefined,
): m is LegacyMapping {
  if (!m) return false;
  // Wenn irgendein Value ein String ist → Legacy
  for (const v of Object.values(m)) {
    if (typeof v === "string") return true;
    if (v && typeof v === "object") return false;
  }
  return false;
}

/**
 * Liefert den eingesetzten Wert für einen einzelnen Platzhalter-Key.
 *
 * @param key       Original-Key, wie im Asset gefunden
 * @param leadData  Lead-Row aus dem CSV (oder Demo-Werte)
 * @param mapping   PlaceholderMapping (neues Format) ODER Legacy-Map
 * @param spanFallback  Optionaler Fallback aus dem Tiptap-Span-Attribut
 * @param inlineFallback Optionaler Fallback aus `{{key|fallback}}`-Token
 *
 * Exportiert, damit Renderer mit eigener Token-Syntax (z. B. Umschlag-PDFs
 * mit Umlaut-Keys und `__sender.`-Präfix) dieselbe Auflösungs-Kette
 * (Mapping → Regeln → Fallback → Direkt-Lookup) verwenden können.
 */
export function resolveValue(
  key: string,
  leadData: Record<string, string>,
  mapping: PlaceholderMapping | LegacyMapping | undefined,
  spanFallback?: string,
  inlineFallback?: string,
  system?: SubstitutionSystemContext,
): string {
  // System-Keys (z.B. `pageUrl`) gewinnen IMMER vor Lead-Daten — sie sind
  // reserviert und werden von der Pipeline berechnet, nicht aus dem CSV
  // gezogen. Wenn der System-Wert NICHT verfügbar ist (kein system-Arg
  // oder Wert ist null/leer), fällt der Lookup auf die normale Lead-
  // Daten-Kette zurück — so behält jeder bestehende Aufrufer ohne
  // `system` sein altes Verhalten.
  const sysVal = resolveSystemValue(key, system);
  if (sysVal != null) return sysVal;

  // Mapping in der neuen Form: { column?, fallback?, rules? }
  if (mapping && !isLegacyMapping(mapping)) {
    const entry = (mapping as PlaceholderMapping)[key];
    if (entry) {
      // Rohwert aus der Spalte lesen (leer, wenn keine Spalte / Zelle leer),
      // dann Wenn-Dann-Regeln anwenden. Trifft eine Regel, ist ihr Output
      // FINAL — auch wenn er leer ist („Feld leeren"). Der Fallback greift
      // nur, wenn KEINE Regel zutrifft und der Rohwert leer ist.
      const raw = entry.column
        ? (lookupLeadValueCI(leadData, entry.column) ?? "")
        : "";
      if (Array.isArray(entry.rules) && entry.rules.length > 0) {
        const hit = findMatchingRule(raw, entry.rules);
        if (hit) return hit.output;
      }
      if (raw.length > 0) return raw;
      if (typeof entry.fallback === "string" && entry.fallback.length > 0) {
        return entry.fallback;
      }
      // Mapping vorhanden aber leer → trotzdem Inline-/Span-Fallback gewähren
      if (inlineFallback && inlineFallback.length > 0) return inlineFallback;
      if (spanFallback && spanFallback.length > 0) return spanFallback;
      return "";
    }
    // Key nicht im Mapping → fallthrough zur Legacy-Logik unten
  }

  // Legacy-Logik / kein Mapping: key === column
  if (mapping && isLegacyMapping(mapping)) {
    const legacy = mapping as LegacyMapping;
    const column = legacy[key];
    if (column) {
      const v = lookupLeadValueCI(leadData, column);
      if (v != null && v.length > 0) return v;
    }
  }

  // Direkter Hit in leadData (key wird wie ein Column-Name behandelt)
  const direct = lookupLeadValueCI(leadData, key);
  if (direct != null && direct.length > 0) return direct;

  // Inline-Fallback aus `{{key|fallback}}`
  if (inlineFallback && inlineFallback.length > 0) return inlineFallback;
  // Tiptap-Span-Fallback aus data-fallback="…"
  if (spanFallback && spanFallback.length > 0) return spanFallback;

  return "";
}

/**
 * Escape-Helper für HTML-Kontexte (Tiptap-Span → Plain Text Replacement).
 */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Einheitliche Substitution. Akzeptiert das Format als expliziten Hint,
 * weil dasselbe Asset (z. B. Slide-HTML) mehrere Format-Varianten haben kann.
 *
 * Niemals werfend — unbekannte Keys / leere Werte werden zum leeren String
 * (oder zum Fallback, sofern vorhanden).
 *
 * Backward-Compat: der optionale `system`-Parameter wurde mit Paket A
 * eingeführt. Bestehende Aufrufer ohne `system` verhalten sich exakt wie
 * vorher; System-Keys (siehe `SYSTEM_PLACEHOLDERS`) werden in dem Fall
 * wie normale Lead-Keys aufgelöst (= leer, weil kein CSV-Feld so heißt).
 *
 * Resolution-Reihenfolge pro Token (kombiniert mit `resolveValue`):
 *   1. System-Key über `system.pageUrl` etc. (wenn `system` gesetzt + Key matched)
 *   2. Mapping-Eintrag (`column` → leadData, dann `fallback`)
 *   3. leadData direkt (key === column, CI)
 *   4. Inline-/Span-Fallback
 *   5. ""
 */
export function substitute(
  text: string | null | undefined,
  leadData: Record<string, string>,
  mapping: PlaceholderMapping | LegacyMapping | undefined,
  format: PlaceholderFormat,
  system?: SubstitutionSystemContext,
): string {
  if (!text) return "";

  switch (format) {
    case "double-brace": {
      // {{ key }} — Whitespace toleriert, Key: [a-zA-Z0-9_-]
      return text.replace(
        /\{\{\s*([\w-]+)\s*\}\}/g,
        (_m, key: string) =>
          resolveValue(key, leadData, mapping, undefined, undefined, system),
      );
    }

    case "double-brace-fallback": {
      // {{ key }} oder {{ key | fallback }} — Key erlaubt zusätzlich `.`
      return text.replace(
        /\{\{\s*([a-zA-Z0-9_.]+)\s*(?:\|\s*([^}]*?)\s*)?\}\}/g,
        (_m, key: string, rawFallback?: string) =>
          resolveValue(key, leadData, mapping, undefined, rawFallback, system),
      );
    }

    case "tiptap-span": {
      // 1. Tiptap-Spans ersetzen (Reihenfolge der Attribute beliebig).
      let out = text.replace(
        /<span\b([^>]*?)data-placeholder=["']([\w-]+)["']([^>]*)>([\s\S]*?)<\/span>/gi,
        (_match, before: string, key: string, after: string) => {
          const attrs = `${before} ${after}`;
          const fb = attrs.match(/data-fallback=["']([^"']*)["']/i);
          const value = resolveValue(
            key,
            leadData,
            mapping,
            fb ? fb[1] : undefined,
            undefined,
            system,
          );
          return escapeHtml(value);
        },
      );
      // 2. Roh-{{key}} im HTML zusätzlich auflösen (Backward-Compat).
      out = out.replace(
        /\{\{\s*([\w-]+)\s*\}\}/g,
        (_m, key: string) =>
          escapeHtml(
            resolveValue(key, leadData, mapping, undefined, undefined, system),
          ),
      );
      return out;
    }

    case "single-brace": {
      // { key } — Whitespace toleriert, Key: [a-zA-Z0-9_]
      return text.replace(
        /\{\s*([a-zA-Z0-9_]+)\s*\}/g,
        (_m, key: string) =>
          resolveValue(key, leadData, mapping, undefined, undefined, system),
      );
    }

    default: {
      const exhaustive: never = format;
      throw new Error(`Unbekanntes Placeholder-Format: ${String(exhaustive)}`);
    }
  }
}

/**
 * Hebt ein gemischtes / legacy Mapping aufs neue Format und merged optional
 * eine zusätzliche Fallback-Schicht (z. B. aus früheren Runs der Kampagne).
 *
 * Reihenfolge der Auflösung (späteres überschreibt früheres):
 *   1. `fallbacks` (z. B. Reuse aus voriger Runde)
 *   2. Legacy-Mapping aus `parsed.mapping` (alt → { column })
 *   3. Bestehende `placeholderMapping`-Entries
 */
export function resolveMapping(
  stored: {
    mapping?: LegacyMapping;
    placeholderMapping?: PlaceholderMapping;
  },
  fallbacks?: PlaceholderMapping,
): PlaceholderMapping {
  const out: PlaceholderMapping = {};

  if (fallbacks) {
    for (const [k, v] of Object.entries(fallbacks)) {
      out[k] = { ...v };
    }
  }

  if (stored.mapping) {
    for (const [key, column] of Object.entries(stored.mapping)) {
      if (typeof column === "string" && column.length > 0) {
        out[key] = { ...(out[key] ?? {}), column };
      }
    }
  }

  if (stored.placeholderMapping) {
    for (const [k, v] of Object.entries(stored.placeholderMapping)) {
      out[k] = { ...(out[k] ?? {}), ...v };
    }
  }

  return out;
}

/**
 * Reduziert ein PlaceholderMapping auf den Legacy-Record für DB-Pfade, die
 * (noch) das alte Format erwarten — z. B. das `start`-Endpoint, das beim
 * Lead-Insert pro Mapping-Key eine zusätzliche `data[key] = row[column]`-
 * Synthese schreibt, damit Worker-Code `lead.data.firstName` direkt findet.
 *
 * Keys ohne `column` werden NICHT in den Legacy-Record geschrieben.
 */
export function toLegacyMapping(mapping: PlaceholderMapping): LegacyMapping {
  const out: LegacyMapping = {};
  for (const [k, v] of Object.entries(mapping)) {
    if (v.column && v.column.length > 0) out[k] = v.column;
  }
  return out;
}

/**
 * `true`, wenn der Mapping-Eintrag eine LEERE CSV-Zelle abdeckt — d. h.
 * beim Rendern trotzdem ein (ggf. bewusst leerer) Wert entsteht:
 *   - nicht-leerer Fallback,
 *   - explizites „leer lassen" (`empty: true`),
 *   - eine `is_empty`-Wenn-Dann-Regel.
 * Validierungs-Schichten (Start-Import, Preflight) dürfen solche Leads
 * NICHT als „unvollständig" aussortieren.
 */
export function coversEmptyValue(
  entry: PlaceholderMappingEntry | undefined,
): boolean {
  return (
    entry !== undefined &&
    ((typeof entry.fallback === "string" && entry.fallback.length > 0) ||
      entry.empty === true ||
      (entry.rules ?? []).some((r) => r.op === "is_empty"))
  );
}

const FIRSTNAME_KEYS = new Set(["vorname", "firstname", "first_name"]);

/**
 * `true`, wenn IRGENDEIN Vorname-Platzhalter im Mapping eine leere Zelle
 * abdeckt (Fallback / „leer lassen" / is_empty-Regel). Dann darf die
 * Pflichtfeld-Prüfung `missing_firstName` nicht mehr hart greifen.
 */
export function firstNameCoveredWhenEmpty(
  mapping: PlaceholderMapping | null | undefined,
): boolean {
  if (!mapping) return false;
  for (const [key, entry] of Object.entries(mapping)) {
    if (!FIRSTNAME_KEYS.has(key.toLowerCase())) continue;
    if (coversEmptyValue(entry)) return true;
  }
  return false;
}

/**
 * Normalisiert einen String für Auto-Match. Niemals leer (mindestens
 * Original lowercased). Aufrufer benutzt das in beiden Richtungen: für
 * gefundene Keys UND für CSV-Spalten.
 */
export function normalizePlaceholderKey(input: string): string {
  return input
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/[_\-.\s]/g, "");
}
