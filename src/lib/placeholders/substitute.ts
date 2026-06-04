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
} from "./types";

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
 */
function resolveValue(
  key: string,
  leadData: Record<string, string>,
  mapping: PlaceholderMapping | LegacyMapping | undefined,
  spanFallback?: string,
  inlineFallback?: string,
): string {
  // Mapping in der neuen Form: { column?, fallback? }
  if (mapping && !isLegacyMapping(mapping)) {
    const entry = (mapping as PlaceholderMapping)[key];
    if (entry) {
      if (entry.column) {
        const v = lookupLeadValueCI(leadData, entry.column);
        if (v != null && v.length > 0) return v;
      }
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
 */
export function substitute(
  text: string | null | undefined,
  leadData: Record<string, string>,
  mapping: PlaceholderMapping | LegacyMapping | undefined,
  format: PlaceholderFormat,
): string {
  if (!text) return "";

  switch (format) {
    case "double-brace": {
      // {{ key }} — Whitespace toleriert, Key: [a-zA-Z0-9_-]
      return text.replace(
        /\{\{\s*([\w-]+)\s*\}\}/g,
        (_m, key: string) => resolveValue(key, leadData, mapping),
      );
    }

    case "double-brace-fallback": {
      // {{ key }} oder {{ key | fallback }} — Key erlaubt zusätzlich `.`
      return text.replace(
        /\{\{\s*([a-zA-Z0-9_.]+)\s*(?:\|\s*([^}]*?)\s*)?\}\}/g,
        (_m, key: string, rawFallback?: string) =>
          resolveValue(key, leadData, mapping, undefined, rawFallback),
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
          );
          return escapeHtml(value);
        },
      );
      // 2. Roh-{{key}} im HTML zusätzlich auflösen (Backward-Compat).
      out = out.replace(
        /\{\{\s*([\w-]+)\s*\}\}/g,
        (_m, key: string) => escapeHtml(resolveValue(key, leadData, mapping)),
      );
      return out;
    }

    case "single-brace": {
      // { key } — Whitespace toleriert, Key: [a-zA-Z0-9_]
      return text.replace(
        /\{\s*([a-zA-Z0-9_]+)\s*\}/g,
        (_m, key: string) => resolveValue(key, leadData, mapping),
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
