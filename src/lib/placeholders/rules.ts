/**
 * Wenn-Dann-Regel-Engine für das Platzhalter-Mapping.
 *
 * Pure Funktionen ohne Side-Effects — bewusst in einer eigenen Datei,
 * damit sowohl der Worker (via `substitute.ts`) als auch die Wizard-UI
 * (Live-Vorschau + Regel-Dialog) EXAKT dieselbe Logik verwenden. Eine
 * Abweichung zwischen Vorschau und Generierung wäre ein Support-Fall.
 *
 * Matching-Semantik (siehe `PlaceholderRule` in types.ts):
 *   - tolerant: trim, case-insensitive, Whitespace-Collapse, Unicode-NFC
 *     (CSV-Importe liefern teils NFD-Umlaute — "Österreich" ≠ "Österreich"
 *     ohne Normalisierung)
 *   - erste zutreffende Regel gewinnt
 *   - der Output triggert keine weitere Regel (keine Ketten)
 */

import type { PlaceholderRule } from "./types";

/** Normalisiert einen Wert für den toleranten Regel-Vergleich. */
export function normalizeForRuleMatch(s: string): string {
  return s.normalize("NFC").trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * Liefert die erste Regel, die auf den Rohwert zutrifft — oder `null`.
 * Defensive gegen malformte Persistenz (fehlende Felder werden übersprungen).
 */
export function findMatchingRule(
  rawValue: string,
  rules: ReadonlyArray<PlaceholderRule> | undefined,
): PlaceholderRule | null {
  if (!rules || rules.length === 0) return null;
  const isEmpty = rawValue.trim().length === 0;
  const normalized = isEmpty ? "" : normalizeForRuleMatch(rawValue);
  for (const rule of rules) {
    if (!rule || typeof rule.output !== "string") continue;
    if (rule.op === "is_empty") {
      if (isEmpty) return rule;
    } else if (rule.op === "equals") {
      if (
        !isEmpty &&
        typeof rule.match === "string" &&
        normalizeForRuleMatch(rule.match) === normalized
      ) {
        return rule;
      }
    }
  }
  return null;
}

/**
 * Wendet die Regeln auf einen Rohwert an. Trifft keine Regel, kommt der
 * Rohwert unverändert zurück.
 */
export function applyPlaceholderRules(
  rawValue: string,
  rules: ReadonlyArray<PlaceholderRule> | undefined,
): string {
  const hit = findMatchingRule(rawValue, rules);
  return hit ? hit.output : rawValue;
}
