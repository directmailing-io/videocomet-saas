/**
 * Auto-Mapping-Vorschlag für die Mapping-Stage im Run-Wizard.
 *
 * Algorithmus (greedy):
 *   1. Normalisiere Key + Column-Namen
 *      (lowercase, Umlaute ä→ae, _/-/. entfernt) — gleiche Funktion wie
 *      im Collector / im Substituter (s. `normalizePlaceholderKey`).
 *   2. Exakt-Match auf normalisierten Strings.
 *   3. Substring-Match (Spalte enthält Key oder umgekehrt).
 *   4. Alias-Match: bekannte Aliases (firstName ↔ vorname ↔ first_name).
 *
 * Liefert pro Key die beste Spalte (oder gar keine, wenn nichts passt).
 */

import type { DetectedPlaceholder, PlaceholderMapping } from "./types";
import { normalizePlaceholderKey } from "./substitute";

/**
 * Vordefinierte Aliasse — gleiche Idee wie in `lib/slug.ts`. Wird in
 * normalisierter Form genutzt, deshalb sind beide Seiten lower+ohne-Sep.
 */
const ALIAS_GROUPS: Array<ReadonlyArray<string>> = [
  ["firstname", "vorname", "vornahme"],
  ["lastname", "nachname", "name"],
  ["fullname", "name"],
  ["email", "mail", "emailadresse"],
  ["company", "companyname", "firma", "unternehmen"],
  ["city", "stadt", "ort"],
  ["phone", "telefon", "tel"],
  ["website", "url", "webseite"],
  ["discountcode", "code", "gutschein"],
  ["landingpageurl", "landingpage"],
];

function normalize(s: string): string {
  return normalizePlaceholderKey(s);
}

/**
 * Findet die beste passende Spalte für einen normalisierten Key.
 * Liefert die Original-Schreibweise (nicht-normalisiert) oder null.
 */
function bestColumnFor(
  normalizedKey: string,
  columns: ReadonlyArray<{ original: string; normalized: string }>,
): string | null {
  // 1. exakt
  for (const c of columns) {
    if (c.normalized === normalizedKey) return c.original;
  }
  // 2. Alias-Gruppen
  for (const group of ALIAS_GROUPS) {
    if (!group.includes(normalizedKey)) continue;
    for (const c of columns) {
      if (group.includes(c.normalized)) return c.original;
    }
  }
  // 3. Substring
  for (const c of columns) {
    if (
      c.normalized.length >= 3 &&
      (c.normalized.includes(normalizedKey) ||
        normalizedKey.includes(c.normalized))
    ) {
      return c.original;
    }
  }
  return null;
}

/**
 * Baut ein `suggestedMapping` aus den gefundenen Platzhaltern + verfügbaren
 * CSV-Spalten. Optional kann ein `priorMapping` aus einem früheren Run der
 * Kampagne übergeben werden — dann werden seine Einträge bevorzugt
 * angewendet (sofern die jeweilige Spalte noch im aktuellen CSV existiert).
 */
export function suggestMapping(
  placeholders: ReadonlyArray<DetectedPlaceholder>,
  csvColumns: ReadonlyArray<string>,
  priorMapping?: PlaceholderMapping,
): PlaceholderMapping {
  const cols = csvColumns.map((c) => ({
    original: c,
    normalized: normalize(c),
  }));
  const out: PlaceholderMapping = {};

  for (const p of placeholders) {
    // 1. Reuse aus voriger Runde, sofern dort Column existiert & noch da
    const prior = priorMapping?.[p.key];
    if (prior) {
      const stillThere =
        prior.column &&
        csvColumns.some(
          (c) => c.toLowerCase() === prior.column!.toLowerCase(),
        );
      if (stillThere || prior.fallback) {
        out[p.key] = { ...prior };
        if (!stillThere) {
          // Spalte weg, aber Fallback behalten — der User sieht im UI eine
          // Warn-Pille und kann eine neue Spalte wählen.
          delete out[p.key].column;
        }
        continue;
      }
    }
    // 2. Auto-Match
    const col = bestColumnFor(p.normalized, cols);
    if (col) {
      out[p.key] = { column: col };
    }
  }

  return out;
}
