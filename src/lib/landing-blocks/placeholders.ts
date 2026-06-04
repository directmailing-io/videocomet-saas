/**
 * Placeholder substitution engine for landing-page block content.
 *
 * Syntax:
 *   {{firstName}}           -> data.firstName, empty string if missing
 *   {{firstName|Hallo}}     -> data.firstName OR "Hallo" if missing
 *   {{any.csvKey}}          -> data["any.csvKey"] (dots are part of the key)
 *
 * Diese Datei ist seit der Vereinheitlichung (2026-06-02) ein dünner
 * Wrapper um die zentrale `substitute()`-Funktion in
 * `@/lib/placeholders/substitute`. Damit greifen Lookup-Mechanismen
 * (case-insensitive, Mapping-Auflösung) identisch wie im Video- und
 * PDF-Pfad. Bestehende Block-Komponenten rufen `renderPlaceholders()`
 * weiterhin mit der alten zweistelligen Signatur auf — wer das neue
 * Mapping nutzen möchte, übergibt es als dritten Parameter.
 *
 * Design notes:
 *   - Pure function. Server-safe + client-safe (used by the public-page
 *     renderer on the server and by the editor preview on the client).
 *   - Never throws. Unknown keys collapse to "" or the fallback.
 *   - Whitespace inside {{ ... }} is tolerated.
 *   - The fallback may itself contain whitespace ("Lieber Kunde").
 */

import type { LeadData } from "./types";
import { substitute } from "../placeholders/substitute";
import type {
  LegacyMapping,
  PlaceholderMapping,
} from "../placeholders/types";

/**
 * Stellt sicher, dass `data` immer ein Record<string,string> ist —
 * die Block-Komponenten geben uns ein `LeadData` mit `string | undefined`,
 * was die zentrale `substitute()` (rein Record<string,string>) nicht
 * akzeptiert. Wir filtern undefined-Werte raus.
 */
function toStringMap(data: LeadData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(data)) {
    if (typeof v === "string") out[k] = v;
  }
  return out;
}

/**
 * Replace `{{key}}` and `{{key|fallback}}` markers in `text` using `data`.
 * Returns the original string unchanged when no markers exist.
 */
export function renderPlaceholders(
  text: string | null | undefined,
  data: LeadData,
  mapping?: PlaceholderMapping | LegacyMapping,
): string {
  if (!text) return "";
  return substitute(text, toStringMap(data), mapping, "double-brace-fallback");
}

/**
 * Convenience helper for places that want a guaranteed non-empty string.
 * Returns `defaultValue` when the substitution result is empty.
 */
export function renderPlaceholdersOr(
  text: string | null | undefined,
  data: LeadData,
  defaultValue: string,
  mapping?: PlaceholderMapping | LegacyMapping,
): string {
  const out = renderPlaceholders(text, data, mapping);
  return out.length > 0 ? out : defaultValue;
}
