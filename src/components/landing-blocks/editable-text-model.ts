/**
 * Pure Modell-Helfer fuer die Inline-Textbearbeitung (editable-text.tsx).
 *
 * Ein Rohtext mit {{platzhaltern}} wird in eine flache Segmentliste
 * zerlegt (Text / Platzhalter-Chip) und wieder zurueck serialisiert.
 * Bewusst DOM-frei, damit die Logik in Vitest ohne Browser testbar ist —
 * die contentEditable-Schicht in editable-text.tsx baut auf diesen
 * Funktionen auf.
 *
 * Syntax (identisch zur Substitutions-Engine, siehe
 * lib/landing-blocks/placeholders.ts):
 *   {{key}}            → Platzhalter ohne Fallback
 *   {{key|fallback}}   → Platzhalter mit Fallback-Text (darf Leerzeichen
 *                        enthalten, z. B. "Lieber Kunde")
 *   Whitespace um den Key wird toleriert und beim Serialisieren
 *   normalisiert ({{ firstName }} → {{firstName}}).
 */

import type { PlaceholderOption } from "./editable-text";

export interface TextSegment {
  type: "text";
  text: string;
}

export interface PlaceholderSegment {
  type: "placeholder";
  key: string;
  /** Fallback-Text ("Falls leer: …"). undefined = kein Fallback. */
  fallback?: string;
}

export type Segment = TextSegment | PlaceholderSegment;

/** Marker-Regex — Key ohne { } |, optionaler Fallback nach "|". */
const MARKER_RE = /\{\{\s*([^{}|]+?)\s*(?:\|([^{}]*))?\}\}/g;

/**
 * Zerlegt einen Rohtext in Segmente. Ungueltige Marker (leerer Key wie
 * "{{}}" oder "{{ | x }}") bleiben als Klartext erhalten.
 */
export function parseRawToSegments(raw: string): Segment[] {
  const segments: Segment[] = [];
  const pushText = (text: string) => {
    if (!text) return;
    const last = segments[segments.length - 1];
    if (last && last.type === "text") last.text += text;
    else segments.push({ type: "text", text });
  };

  MARKER_RE.lastIndex = 0;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = MARKER_RE.exec(raw)) !== null) {
    if (match.index > lastIndex) pushText(raw.slice(lastIndex, match.index));
    const key = (match[1] ?? "").trim();
    const fallbackRaw = match[2];
    if (!key) {
      // Leerer Key: kein echter Platzhalter — Klartext lassen.
      pushText(match[0]);
    } else if (fallbackRaw !== undefined && fallbackRaw !== "") {
      segments.push({ type: "placeholder", key, fallback: fallbackRaw });
    } else {
      segments.push({ type: "placeholder", key });
    }
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < raw.length) pushText(raw.slice(lastIndex));
  return segments;
}

/** Serialisiert eine Segmentliste zurueck in den Rohtext. */
export function serializeSegments(segments: Segment[]): string {
  let out = "";
  for (const seg of segments) {
    if (seg.type === "text") {
      out += seg.text;
    } else if (seg.fallback) {
      out += "{{" + seg.key + "|" + seg.fallback + "}}";
    } else {
      out += "{{" + seg.key + "}}";
    }
  }
  return out;
}

/**
 * Klartext-Label eines Platzhalter-Keys fuer die Chip-Beschriftung.
 * Unbekannte Keys zeigen den Key selbst.
 */
export function placeholderLabel(
  key: string,
  placeholders: PlaceholderOption[],
): string {
  const hit = placeholders.find((p) => p.key === key);
  return hit ? hit.label : key;
}
