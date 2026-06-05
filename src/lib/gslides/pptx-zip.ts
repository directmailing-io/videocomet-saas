/**
 * PPTX-Inspektion: Folien-XMLs auflisten + Text-Inhalte extrahieren.
 *
 * Ein PPTX-File ist ein ZIP mit folgender Struktur (Auszug):
 *
 *   ppt/slides/slide1.xml
 *   ppt/slides/slide2.xml
 *   ppt/slides/slide3.xml
 *   ppt/slides/_rels/slide1.xml.rels
 *   …
 *
 * Innerhalb von `slideN.xml` liegt der sichtbare Text in `<a:t>`-Elementen,
 * gewickelt in `<a:r>` (Run) + `<a:p>` (Paragraph). Wir lesen NUR die
 * `<a:t>`-Inhalte — alles andere (Geometrie, Farben, Animationen) ist für
 * unsere Zwecke uninteressant.
 *
 * Die Reihenfolge der Folien ergibt sich NICHT aus der numerischen
 * Sortierung der Dateinamen — Google nummeriert die Slides intern manchmal
 * anders, weil bei Edit-Operationen Lücken entstehen (slide1, slide2,
 * slide4 …). Die kanonische Quelle ist `ppt/presentation.xml.rels` plus
 * `ppt/presentation.xml`'s `<p:sldIdLst>`. Wir parsen das, fallen aber
 * bei Schäden auf die alphabetische Sortierung zurück (besser als Crash).
 */

import JSZip from "jszip";

export interface SlideTextEntry {
  /**
   * 0-basierter Index in der Präsentations-Reihenfolge (NICHT die Nummer
   * im Dateinamen — Folie 0 ist die erste sichtbare Folie im Deck).
   */
  slideIndex: number;
  /** Relativer Pfad im ZIP, z. B. `ppt/slides/slide1.xml`. */
  zipPath: string;
  /** Roh-XML der Folie, UTF-8 dekodiert. */
  xmlContent: string;
  /**
   * Alle `<a:t>`-Textstrings dieser Folie in Dokument-Reihenfolge.
   * KANN leere Strings enthalten (z. B. Platzhalter-Run ohne Text).
   */
  rawTexts: string[];
}

const SLIDE_PATH_RE = /^ppt\/slides\/slide(\d+)\.xml$/;
const TEXT_RUN_RE = /<a:t[^>]*>([\s\S]*?)<\/a:t>/g;

/**
 * Liest alle Folien aus einem PPTX-Buffer aus, in der korrekten
 * Präsentations-Reihenfolge.
 *
 * Wirft nur bei kaputtem ZIP — leere Decks (0 Folien) sind kein Fehler.
 */
export async function extractSlidesFromPptx(
  pptxBuf: Buffer,
): Promise<SlideTextEntry[]> {
  const zip = await JSZip.loadAsync(pptxBuf);

  // 1) Slide-Reihenfolge bestimmen.
  const orderedZipPaths = await resolveSlideOrder(zip);

  // 2) Pro Folie: XML lesen, `<a:t>`-Inhalte sammeln.
  const out: SlideTextEntry[] = [];
  for (let i = 0; i < orderedZipPaths.length; i += 1) {
    const zipPath = orderedZipPaths[i];
    const file = zip.file(zipPath);
    if (!file) continue;
    const xmlContent = await file.async("string");
    const rawTexts = extractTextRuns(xmlContent);
    out.push({
      slideIndex: i,
      zipPath,
      xmlContent,
      rawTexts,
    });
  }

  return out;
}

/**
 * Liefert die Pfade aller `ppt/slides/slideN.xml`-Dateien in der
 * Reihenfolge, in der sie im Deck angezeigt werden.
 *
 * Primär versuchen wir `ppt/presentation.xml` + `ppt/_rels/presentation.xml.rels`
 * zu parsen — das ist die offizielle Quelle der Wahrheit. Fällt das aus,
 * sortieren wir alphabetisch nach der Nummer im Dateinamen.
 */
async function resolveSlideOrder(zip: JSZip): Promise<string[]> {
  const presFile = zip.file("ppt/presentation.xml");
  const relsFile = zip.file("ppt/_rels/presentation.xml.rels");

  if (presFile && relsFile) {
    try {
      const presXml = await presFile.async("string");
      const relsXml = await relsFile.async("string");

      // `presentation.xml` hat `<p:sldIdLst>` mit `<p:sldId r:id="rIdN" …>`
      const sldIdMatches = Array.from(
        presXml.matchAll(
          /<p:sldId\b[^>]*\br:id\s*=\s*"([^"]+)"/g,
        ),
      ).map((m) => m[1]);

      if (sldIdMatches.length > 0) {
        // Im Rels-File matchen wir Id → Target.
        const relMap = new Map<string, string>();
        const relMatches = Array.from(
          relsXml.matchAll(
            /<Relationship\b[^>]*\bId\s*=\s*"([^"]+)"[^>]*\bTarget\s*=\s*"([^"]+)"/g,
          ),
        );
        for (const m of relMatches) {
          relMap.set(m[1], m[2]);
        }

        const ordered: string[] = [];
        for (const rid of sldIdMatches) {
          const target = relMap.get(rid);
          if (!target) continue;
          // Target ist relativ zum Rels-File: `slides/slide1.xml`.
          // Wir normalisieren zu `ppt/slides/slide1.xml`.
          const normalized = target.startsWith("/")
            ? target.replace(/^\/+/, "")
            : `ppt/${target}`;
          if (SLIDE_PATH_RE.test(normalized)) {
            ordered.push(normalized);
          }
        }
        if (ordered.length > 0) return ordered;
      }
    } catch {
      // Fall-through to alphabetic.
    }
  }

  // Fallback: alphabetische Sortierung nach Slide-Nummer.
  const all: { path: string; n: number }[] = [];
  zip.forEach((relPath) => {
    const m = relPath.match(SLIDE_PATH_RE);
    if (m) {
      all.push({ path: relPath, n: parseInt(m[1], 10) });
    }
  });
  all.sort((a, b) => a.n - b.n);
  return all.map((e) => e.path);
}

/**
 * Greift den sichtbaren Text aller `<a:t>`-Runs aus einem Folien-XML.
 * Die Inhalte sind XML-decoded (`&amp;` → `&`, `&lt;` → `<`, …).
 */
export function extractTextRuns(xmlContent: string): string[] {
  const out: string[] = [];
  TEXT_RUN_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TEXT_RUN_RE.exec(xmlContent)) !== null) {
    out.push(decodeXmlEntities(m[1]));
  }
  return out;
}

/**
 * Decodet die fünf XML-Standardentities. Ausreichend für PPTX-Inhalte —
 * Office encodet niemals andere Entities.
 */
export function decodeXmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

/**
 * Encodet die fünf XML-Standardentities zurück. Wird beim Re-Pack der
 * Substitution gebraucht: ein Lead-Wert wie „Müller & Söhne" muss als
 * „Müller &amp; Söhne" ins XML zurückgeschrieben werden, sonst kracht
 * LibreOffice beim Parsing.
 */
export function encodeXmlEntities(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
