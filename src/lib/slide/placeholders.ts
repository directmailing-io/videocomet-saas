/**
 * Auflösen von Platzhaltern in Slide-HTML.
 *
 * Tiptap rendert Platzhalter als
 *   <span data-placeholder="key">{{key}}</span>
 * Mit optionalem Fallback:
 *   <span data-placeholder="key" data-fallback="…">{{key}}</span>
 *
 * Diese Datei ist ein dünner Wrapper um die zentrale `substitute()`-
 * Funktion in `@/lib/placeholders/substitute`. So bleiben bestehende
 * Aufrufer (SlideRender, slide-canvas) signaturgleich, während die
 * Lookup-Logik (case-insensitive Spalten-Resolution, Mapping-Support)
 * an EINER Stelle lebt.
 */

import {
  substitute,
  type SubstitutionSystemContext,
} from "../placeholders/substitute";
import type {
  LegacyMapping,
  PlaceholderMapping,
} from "../placeholders/types";

/**
 * Ersetzt alle `<span data-placeholder>`-Nodes und {{key}}-Tokens durch
 * den entsprechenden Wert. Optional kann ein `mapping` (neues Format ODER
 * Legacy-Record) übergeben werden — dann gewinnen die Mapping-Einträge
 * vor dem direkten Lookup in `leadData[key]`.
 */
export function resolvePlaceholders(
  html: string,
  leadData: Record<string, string>,
  mapping?: PlaceholderMapping | LegacyMapping,
  system?: SubstitutionSystemContext,
): string {
  return substitute(html, leadData, mapping, "tiptap-span", system);
}

/**
 * Sammelt alle eindeutigen Platzhalter-Keys, die in einer HTML-Zeichenkette
 * vorkommen. Wird vom Editor für die Lead-Vorschau benutzt.
 */
export function collectPlaceholderKeys(html: string): string[] {
  const out = new Set<string>();
  const spanRe = /data-placeholder=["']([\w-]+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = spanRe.exec(html))) out.add(m[1]);
  const tokRe = /\{\{\s*([\w-]+)\s*\}\}/g;
  while ((m = tokRe.exec(html))) out.add(m[1]);
  return Array.from(out);
}
