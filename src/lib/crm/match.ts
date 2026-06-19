/**
 * Auflösung von Lead-Daten gegen die `leadMatch`-Konfiguration einer
 * Campaign-CRM-Settings-Zeile.
 *
 * `leadMatch` ist eine geordnete Liste von Fallback-Regeln:
 *   [{ source: "data.email", target: "email" }, { source: "data.phone", target: "phone" }]
 *
 * Wir laufen die Liste in Order durch und nehmen den ersten Eintrag, dessen
 * `source` einen nicht-leeren Wert im Lead liefert. `source` startet aktuell
 * immer mit `data.` — der Rest ist der Spaltenname im Mapping (z.B. die
 * Original-CSV-Spaltenüberschrift). Lookup ist case-insensitive, weil
 * User-Mappings gerne mal mit Großbuchstaben kommen ("Email" vs. "email").
 *
 * Phase 2 (Worker + Test-Sync-Endpoint) nutzt das hier, um die
 * `findContactByField`-Argumente zu bauen.
 */

export interface LeadMatchRule {
  source: string;
  target: "email" | "phone";
}

export interface LeadMatchResult {
  target: "email" | "phone";
  value: string;
}

/**
 * Case-insensitive Lookup in einem Lead-Data-Object. Erst der Literal-Key,
 * dann ein linearer Scan auf `.toLowerCase()`. Lead-Data ist im Schnitt
 * 10-30 Spalten breit, deshalb ist der Scan akzeptabel.
 */
function lookupCaseInsensitive(
  data: Record<string, string>,
  key: string,
): string | undefined {
  if (Object.prototype.hasOwnProperty.call(data, key)) {
    return data[key];
  }
  const needle = key.toLowerCase();
  for (const k of Object.keys(data)) {
    if (k.toLowerCase() === needle) return data[k];
  }
  return undefined;
}

export function resolveLeadMatchValue(
  leadData: Record<string, string>,
  leadMatch: LeadMatchRule[],
): LeadMatchResult | null {
  for (const rule of leadMatch) {
    if (!rule || typeof rule.source !== "string") continue;
    if (rule.target !== "email" && rule.target !== "phone") continue;
    if (!rule.source.startsWith("data.")) continue;
    const path = rule.source.slice("data.".length);
    if (!path) continue;
    const raw = lookupCaseInsensitive(leadData, path);
    if (typeof raw !== "string") continue;
    const value = raw.trim();
    if (value.length === 0) continue;
    return { target: rule.target, value };
  }
  return null;
}
