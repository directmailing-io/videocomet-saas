/**
 * DOCX-Normalisierung — vor LibreOffice-Konvertierung.
 *
 * Hintergrund
 * -----------
 * Google Docs exportiert seine DOCX-Datei mit "floating" Bildern (text-
 * umfliessend), die als `<wp:anchor>`-Drawings im OOXML stehen. LibreOffice
 * hat bekanntermassen schwierigen Umgang mit `wp:anchor`-Wrapping in
 * Kombination mit dynamisch eingefuegten Bildern (QR + Thumbnail werden
 * von uns nach Layout-Erstellung gegen Marker getauscht). Praxis-Resultat:
 * im exportierten PDF rutscht das Bild ueber den Folgetext.
 *
 * Loesung
 * -------
 * Vor der PDF-Konvertierung normalisieren wir jede `wp:anchor`-Drawing
 * zu einer `wp:inline`-Drawing. Inline-Bilder werden von LibreOffice
 * deterministisch als Block-Level-Element zwischen die Text-Runs gesetzt
 * — keine Wrapping-Heuristik, keine Drift gegen Text-Reflow durch
 * Platzhalter-Substitution.
 *
 * Vorgehen
 * --------
 * 1. `<wp:anchor ...>`-Bloecke finden.
 * 2. Innerer `<a:graphic>`-Subtree und das `<wp:extent ...>` extrahieren
 *    (die behalten wir bei — Bild-Daten + Original-Groesse).
 * 3. Block durch `<wp:inline>` ersetzen, alle Anchor-spezifischen
 *    Properties (`wp:positionH`, `wp:positionV`, `wp:wrap*`, etc.) fallen
 *    weg.
 * 4. Document-XML zurueckschreiben.
 *
 * Die Funktion ist idempotent — eine bereits normalisierte DOCX bleibt
 * unveraendert.
 *
 * Limitations
 * -----------
 * - Regex-basierte XML-Manipulation. Wir parsen nicht den vollen DOM,
 *   weil Google-Docs-Export einen sehr begrenzten Subset emittiert. Bei
 *   handcrafteten DOCX mit verschachtelten Drawings koennte ein echter
 *   XML-Parser noetig werden. Lower-risk: wir matchen non-greedy mit
 *   `[\s\S]*?`, also keine inkorrekten Multi-Anchor-Captures.
 * - `wp:extent` ist optional — falls fehlend nutzen wir 1 Zoll (914400
 *   EMU) als sicheren Default, damit LibreOffice nicht crashed.
 */

import type PizZip from "pizzip";
import { getDocumentXml, setDocumentXml } from "./docx";

const ANCHOR_RE = /<wp:anchor\b[^>]*?>([\s\S]*?)<\/wp:anchor>/g;
const EXTENT_RE = /<wp:extent\b[^/]*?cx="(\d+)"\s+cy="(\d+)"[^/]*?\/?>/;
const GRAPHIC_RE = /<a:graphic\b[\s\S]*?<\/a:graphic>/;
const DEFAULT_EMU_PER_INCH = 914_400;

/**
 * Konvertiert alle `<wp:anchor>`-Drawings in `<wp:inline>`-Drawings.
 *
 * Gibt das modifizierte XML zurueck. Wenn keine Anchors gefunden wurden,
 * gibt es den Original-String unveraendert zurueck — der Caller kann sich
 * darauf verlassen dass das Schreiben optional ist.
 */
export function normalizeAnchorImagesXml(xml: string): {
  xml: string;
  anchorsConverted: number;
} {
  let count = 0;
  const result = xml.replace(ANCHOR_RE, (_full, inner: string) => {
    const graphicMatch = GRAPHIC_RE.exec(inner);
    if (!graphicMatch) {
      // Kein Graphic-Block → ungueltige Anchor, intakt lassen damit
      // LibreOffice die Original-Fehlermeldung produziert.
      return _full;
    }
    const graphic = graphicMatch[0];

    const extentMatch = EXTENT_RE.exec(inner);
    const cx = extentMatch?.[1] ?? String(DEFAULT_EMU_PER_INCH);
    const cy = extentMatch?.[2] ?? String(DEFAULT_EMU_PER_INCH);

    count += 1;
    // Minimal-Inline-Drawing. docPr-id wird mit einer pseudo-eindeutigen
    // Nummer befuellt — Word/LibreOffice akzeptieren auch nicht
    // eindeutige IDs, aber wir koennen mit dem Match-Index inkrementieren
    // falls sich das jemals als problematisch erweist.
    return (
      `<wp:inline distT="0" distB="0" distL="0" distR="0">` +
      `<wp:extent cx="${cx}" cy="${cy}"/>` +
      `<wp:effectExtent l="0" t="0" r="0" b="0"/>` +
      `<wp:docPr id="${1000 + count}" name="InlineImage${count}"/>` +
      `<wp:cNvGraphicFramePr/>` +
      `${graphic}` +
      `</wp:inline>`
    );
  });

  return { xml: result, anchorsConverted: count };
}

/**
 * Convenience-Wrapper: angewandt auf eine geladene PizZip-Instanz.
 * Schreibt das Ergebnis zurueck ins DOCX-ZIP (in-place).
 */
export function normalizeAnchorImagesInZip(
  zip: PizZip,
): { anchorsConverted: number } {
  const original = getDocumentXml(zip);
  const { xml, anchorsConverted } = normalizeAnchorImagesXml(original);
  if (anchorsConverted > 0) {
    setDocumentXml(zip, xml);
  }
  return { anchorsConverted };
}
