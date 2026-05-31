/**
 * Placeholder substitution engine for landing-page block content.
 *
 * Syntax:
 *   {{firstName}}           -> data.firstName, empty string if missing
 *   {{firstName|Hallo}}     -> data.firstName OR "Hallo" if missing
 *   {{any.csvKey}}          -> data["any.csvKey"] (dots are part of the key)
 *
 * Design notes:
 *   - Pure function. Server-safe + client-safe (used by the public-page
 *     renderer on the server and by the editor preview on the client).
 *   - Never throws. Unknown keys collapse to "" or the fallback.
 *   - Whitespace inside {{ ... }} is tolerated.
 *   - The fallback may itself contain whitespace ("Lieber Kunde").
 */

import type { LeadData } from "./types";

/**
 * Replace `{{key}}` and `{{key|fallback}}` markers in `text` using
 * `data`. Returns the original string unchanged when no markers exist.
 */
export function renderPlaceholders(
  text: string | null | undefined,
  data: LeadData,
): string {
  if (!text) return "";
  // Match {{ key }} or {{ key | fallback }}. Key allows letters,
  // digits, underscore and dot (CSV columns sometimes use dotted names).
  return text.replace(
    /\{\{\s*([a-zA-Z0-9_.]+)\s*(?:\|\s*([^}]*?)\s*)?\}\}/g,
    (_match, rawKey: string, rawFallback?: string) => {
      const value = data[rawKey];
      if (typeof value === "string" && value.length > 0) return value;
      return rawFallback ?? "";
    },
  );
}

/**
 * Convenience helper for places that want a guaranteed non-empty string.
 * Returns `defaultValue` when the substitution result is empty.
 */
export function renderPlaceholdersOr(
  text: string | null | undefined,
  data: LeadData,
  defaultValue: string,
): string {
  const out = renderPlaceholders(text, data);
  return out.length > 0 ? out : defaultValue;
}
