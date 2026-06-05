/**
 * PPTX-Placeholder-Extraktion: liefert pro Folie die dort verwendeten
 * `{{key}}`-Tokens.
 *
 * Wird vom Import-Endpoint benutzt, um pro Folie die Liste der Lead-
 * Spalten zu cachen, die für diese Folie relevant sind. Die Mapping-Stage
 * im Wizard zeigt darauf basierend die Auto-Suggest-Mappings.
 *
 * Heuristik: wir scannen alle `<a:t>`-Inhalte EINES Slide-XMLs in zwei
 * Modi:
 *
 *   1. Pro Run isoliert (Standard-Fall).
 *   2. Pro Paragraph konkateniert (für Multi-Run-zerlegte Tokens).
 *
 * Das deckt die gleichen Fälle ab wie `pptx-substitute.ts` — wenn der
 * Importer einen Key findet, kann der Renderer ihn auch ersetzen.
 */

import JSZip from "jszip";
import { extractTextRuns } from "./pptx-zip";

const SLIDE_PATH_RE = /^ppt\/slides\/slide(\d+)\.xml$/;
const PLACEHOLDER_RE = /\{\{\s*([a-zA-Z0-9_-]+)\s*\}\}/g;

export interface PptxPlaceholders {
  /** Slide-Pfad → sortierte, deduplizierte Key-Liste. */
  slidePlaceholders: Record<number, string[]>;
  /** Über alle Folien zusammengelegt, sortiert + dedupliziert. */
  allKeys: string[];
}

/**
 * Liest alle Folien aus dem PPTX und sammelt pro Folie die `{{key}}`-Treffer.
 *
 * Achtung: der Output ist auf den Slide-Index aus
 * `extractSlidesFromPptx` ausgerichtet (Reihenfolge wie im Deck) — NICHT
 * auf den numerischen Dateinamen-Suffix.
 */
export async function extractPlaceholdersFromPptx(
  pptxBuf: Buffer,
): Promise<PptxPlaceholders> {
  // Wir hosten die Reihenfolge-Auflösung in `pptx-zip` — hier wäre sonst
  // Code-Duplikation. Wir laden den ZIP zweimal nur dann, wenn der Caller
  // beide Lib-Funktionen separat ruft; in `import.ts` machen wir das aus
  // Performance-Gründen aber via `extractSlidesFromPptx` einmal vorab.
  const { extractSlidesFromPptx } = await import("./pptx-zip");
  const slides = await extractSlidesFromPptx(pptxBuf);

  const slidePlaceholders: Record<number, string[]> = {};
  const allKeys = new Set<string>();

  for (const slide of slides) {
    const keys = collectPlaceholdersFromXml(slide.xmlContent);
    slidePlaceholders[slide.slideIndex] = keys;
    for (const k of keys) allKeys.add(k);
  }

  return {
    slidePlaceholders,
    allKeys: Array.from(allKeys).sort(),
  };
}

/**
 * Sammelt `{{key}}`-Treffer aus dem XML eines einzelnen Slides. Beide
 * Pässe (Single-Run + Paragraph-konkatenert) werden ausgeführt; das
 * Ergebnis ist sortiert + dedupliziert.
 */
export function collectPlaceholdersFromXml(xml: string): string[] {
  const out = new Set<string>();

  // Pass 1: Single-Run.
  for (const t of extractTextRuns(xml)) {
    PLACEHOLDER_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = PLACEHOLDER_RE.exec(t)) !== null) {
      out.add(m[1].trim());
    }
  }

  // Pass 2: pro Paragraph konkatenert.
  const paragraphs = Array.from(xml.matchAll(/<a:p\b[^>]*>([\s\S]*?)<\/a:p>/g));
  for (const pm of paragraphs) {
    const inner = pm[1];
    const tParts: string[] = [];
    const tRuns = Array.from(inner.matchAll(/<a:t[^>]*>([\s\S]*?)<\/a:t>/g));
    for (const tr of tRuns) tParts.push(tr[1]);
    if (tParts.length < 2) continue;
    const joined = tParts.join("");
    if (!joined.includes("{{")) continue;
    PLACEHOLDER_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = PLACEHOLDER_RE.exec(joined)) !== null) {
      out.add(m[1].trim());
    }
  }

  return Array.from(out).sort();
}

/**
 * Helper: zählt Slides im PPTX-Buffer, ohne die Inhalte zu materialisieren.
 * Wird beim Import zur frühen Validierung (0 Folien → Fehler) genutzt.
 */
export async function countSlidesInPptx(pptxBuf: Buffer): Promise<number> {
  const zip = await JSZip.loadAsync(pptxBuf);
  let n = 0;
  zip.forEach((relPath) => {
    if (SLIDE_PATH_RE.test(relPath)) n += 1;
  });
  return n;
}
