/**
 * DOCX-Anker-Patches vor LibreOffice-PDF-Konvertierung.
 *
 * Hintergrund
 * -----------
 * Google Docs exportiert Bilder als `<wp:anchor>`-Drawings (floating). Das
 * Default-Attribut `allowOverlap="1"` erlaubt zwei Floating-Objekte (z.B.
 * floating image + floating table), sich frei zu ueberlappen. LibreOffice
 * 7.x rendert diese Ueberlappung mit kleinen Position-Drifts, das Bild
 * wird im Vergleich zu Word leicht verschoben dargestellt.
 *
 * Loesung
 * -------
 * **Konservativer, minimal-invasiver Patch**: nur `allowOverlap="1"` auf
 * `<wp:anchor>` zu `"0"` umsetzen. Damit deklarieren wir dass die
 * Floating-Objekte nicht ueberlappen sollen — LibreOffice clampt dann auf
 * die exakte `posOffset`-Koordinate ohne Drift.
 *
 * NICHT gemacht wird (bewusst):
 *   - `<wp:wrapNone/>` → `<wp:wrapTopAndBottom/>` — broke `{{landingpage-url}}`-
 *     Layout in lokalen Tests (Text-Wrap-Mode-Change verschiebt nachbarn Text).
 *   - `<wp:anchor>` → `<wp:inline>` — komplettes Layout-Bruch (Bild verliert
 *     Float-Position, rendert als Block irgendwo im Paragraph).
 *   - `relativeHeight`-Aenderung — Z-Order zwischen floating table und
 *     floating image ist LibreOffice-spezifisch nicht via OOXML-Attribut
 *     steuerbar.
 *
 * Idempotenz
 * ----------
 * Eine bereits gepatchte DOCX (`allowOverlap="0"`) bleibt unveraendert.
 *
 * Limitations
 * -----------
 * - Regex statt XML-DOM. Pattern matched ausschliesslich innerhalb
 *   `<wp:anchor ...>`-Tag-Heads, also kein False-Positive in Styles oder
 *   anderen Element-Attributen.
 * - Komplexe Google-Docs-Layouts mit floating tables + floating images
 *   (z.B. "Game-Changer-Tipp"-Kasten + iPhone-Foto darueber) werden
 *   prinzipiell von LibreOffice anders gerendert als von Word/Google Docs
 *   — KEIN OOXML-Patch behebt das vollstaendig. Fuer pixel-perfekte
 *   Briefe muesste der Template-Designer den Layout vereinfachen
 *   (z.B. ein einziges komposites PNG statt floating image + table).
 */

import type PizZip from "pizzip";
import { getDocumentXml, setDocumentXml } from "./docx";

/**
 * Matched `allowOverlap="1"` nur innerhalb eines `<wp:anchor ...>`-Tag-Heads.
 * `\s` vor allowOverlap stellt sicher dass wir nicht in der Mitte eines
 * anderen Attributnamens stehen.
 */
const ANCHOR_ALLOW_OVERLAP_RE =
  /(<wp:anchor[^>]*?\s)allowOverlap="1"([^>]*?>)/g;

export interface AnchorPatchResult {
  /** Anzahl `<wp:anchor>` deren `allowOverlap` von "1" auf "0" gesetzt wurde. */
  allowOverlapPatched: number;
}

/**
 * Patcht toxische Anchor-Attribute im OOXML-String. Idempotent.
 */
export function patchToxicAnchorAttributesXml(xml: string): {
  xml: string;
  patches: AnchorPatchResult;
} {
  let allowOverlapPatched = 0;
  const result = xml.replace(ANCHOR_ALLOW_OVERLAP_RE, (_full, before, after) => {
    allowOverlapPatched += 1;
    return `${before}allowOverlap="0"${after}`;
  });
  return {
    xml: result,
    patches: { allowOverlapPatched },
  };
}

/**
 * Convenience-Wrapper: angewandt auf eine geladene PizZip-Instanz.
 * Schreibt das Ergebnis zurueck ins DOCX-ZIP (in-place) wenn mindestens
 * ein Patch angewendet wurde.
 */
export function patchToxicAnchorAttributesInZip(
  zip: PizZip,
): AnchorPatchResult {
  const original = getDocumentXml(zip);
  const { xml, patches } = patchToxicAnchorAttributesXml(original);
  if (patches.allowOverlapPatched > 0) {
    setDocumentXml(zip, xml);
  }
  return patches;
}
