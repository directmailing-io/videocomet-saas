/**
 * PPTX-XML-Substitution: ersetzt `{{key}}`-Tokens durch Lead-Werte
 * direkt im Slide-XML.
 *
 * Wir operieren in zwei Pässen pro Folie:
 *
 *   1. **Single-Run-Pass**: jede `<a:t>…</a:t>` wird isoliert
 *      durchsucht. Steht ein vollständiges Token in einem einzelnen Run
 *      drin (häufiger Fall), wird es direkt ersetzt.
 *
 *   2. **Multi-Run-Pass**: ein Token kann durch Formatierungs-Wechsel auf
 *      mehrere `<a:r>` aufgeteilt sein — z. B. `{{` in Bold, `firstName`
 *      in Normal, `}}` in Bold. Wir packen pro `<a:p>` alle `<a:t>`-Inhalte
 *      in einen virtuellen Buffer, machen die Ersetzung dort und
 *      verteilen das Ergebnis zurück auf den ERSTEN Run (die anderen
 *      Runs im selben Paragraph werden geleert, falls sie zum Token
 *      gehören). Das verliert Formatierungs-Information INNERHALB des
 *      Tokens — was OK ist, weil ein Lead-Wert sowieso einheitlich
 *      formatiert sein sollte.
 *
 * Edge-Cases bewusst ausgeklammert:
 *   - Token, das sich über mehrere `<a:p>` (Paragraphs) erstreckt: kommt
 *     in der Praxis nicht vor, weil Google bei Eingabe immer einen
 *     Linebreak setzt. Würde im Multi-Run-Pass nicht erfasst.
 *   - Token mit XML-Entities im Key (`{{first&amp;Name}}`): unmöglich,
 *     weil der Key alphanumerisch ist.
 */

import JSZip from "jszip";
import { encodeXmlEntities } from "./pptx-zip";

const SLIDE_PATH_RE = /^ppt\/slides\/slide\d+\.xml$/;
const PLACEHOLDER_RE = /\{\{\s*([a-zA-Z0-9_-]+)\s*\}\}/g;

/**
 * Ersetzt alle `{{key}}`-Tokens in allen Slide-XMLs durch die im Mapping
 * angegebenen Werte und liefert einen neuen PPTX-Buffer zurück.
 *
 * Nicht-bekannte Keys bleiben im Output als Roh-Tokens erhalten —
 * Substitution ist „best-effort". Caller, der unbekannte Keys leeren
 * will, sollte sie vorher mit `""` ins Mapping packen.
 */
export async function substitutePptxPlaceholders(
  pptxBuf: Buffer,
  mapping: Record<string, string>,
): Promise<Buffer> {
  const zip = await JSZip.loadAsync(pptxBuf);

  // Pro Slide-XML beide Pässe ausführen.
  const slidePaths: string[] = [];
  zip.forEach((relPath) => {
    if (SLIDE_PATH_RE.test(relPath)) slidePaths.push(relPath);
  });

  for (const slidePath of slidePaths) {
    const file = zip.file(slidePath);
    if (!file) continue;
    const original = await file.async("string");
    const substituted = substituteSlideXml(original, mapping);
    if (substituted !== original) {
      zip.file(slidePath, substituted);
    }
  }

  // Re-pack ZIP. DEFLATE wie das Original.
  const out = await zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });
  return out;
}

/**
 * Führt beide Pässe auf einem einzelnen Slide-XML aus.
 *
 * Exportiert für Tests und für `extractPlaceholdersFromPptx`-Vorberechnung.
 */
export function substituteSlideXml(
  xml: string,
  mapping: Record<string, string>,
): string {
  // ── Pass 1: einzelne <a:t>-Inhalte ─────────────────────────────────────
  let pass1 = xml.replace(
    /(<a:t[^>]*>)([\s\S]*?)(<\/a:t>)/g,
    (_match, open: string, body: string, close: string) => {
      const replaced = replaceTokens(body, mapping);
      return `${open}${replaced}${close}`;
    },
  );

  // ── Pass 2: über mehrere Runs verteilte Tokens ──────────────────────────
  //
  // Wir splitten den XML in `<a:p>…</a:p>`-Paragraphen. Pro Paragraph
  // sammeln wir alle `<a:t>`-Inhalte in einen virtuellen Buffer, machen
  // dort die Ersetzung, und prüfen, ob sich das Ergebnis vom Original
  // unterscheidet. Wenn ja, packen wir das ganze Ergebnis in den ERSTEN
  // Run-Text und leeren den Inhalt aller anderen `<a:t>`-Elemente, die
  // zu dem Tokenfragment beigetragen haben.
  //
  // Vereinfachung: wir leeren ALLE anderen `<a:t>` des Paragraphs.
  // Das bedeutet: falls ein Paragraph drei Tokens und Text dazwischen hat,
  // und nur eins davon Multi-Run-zerlegt ist, würden wir trotzdem den
  // ganzen Paragraph kollabieren. Wir akzeptieren das, weil:
  //   a) Pass-1 hat einfache Fälle bereits abgegriffen.
  //   b) Multi-Run-Tokens entstehen fast immer in einfachen Boxen.
  pass1 = pass1.replace(
    /(<a:p\b[^>]*>)([\s\S]*?)(<\/a:p>)/g,
    (_match, open: string, inner: string, close: string) => {
      // Schritt A: Original-`<a:t>`-Inhalte einsammeln.
      const tMatches = Array.from(
        inner.matchAll(/(<a:t[^>]*>)([\s\S]*?)(<\/a:t>)/g),
      );
      if (tMatches.length < 2) return _match; // Single-Run → schon in Pass 1
      const joined = tMatches.map((m) => m[2]).join("");
      if (!joined.includes("{{")) return _match;

      // Schritt B: Replace im joined Text.
      const replaced = replaceTokens(joined, mapping);
      if (replaced === joined) return _match;

      // Schritt C: alles Replaced in den ersten Run, andere Runs leeren.
      let idx = 0;
      const newInner = inner.replace(
        /(<a:t[^>]*>)([\s\S]*?)(<\/a:t>)/g,
        (_full, openT: string, _body: string, closeT: string) => {
          if (idx++ === 0) {
            return `${openT}${replaced}${closeT}`;
          }
          return `${openT}${closeT}`;
        },
      );
      return `${open}${newInner}${close}`;
    },
  );

  return pass1;
}

/**
 * Ersetzt `{{key}}`-Tokens im Input-String. Werte werden XML-encoded,
 * damit Sonderzeichen das umgebende XML nicht zerschießen.
 *
 * Nicht-bekannte Keys werden NICHT angefasst — das Token bleibt als
 * Roh-Text stehen.
 */
function replaceTokens(
  input: string,
  mapping: Record<string, string>,
): string {
  PLACEHOLDER_RE.lastIndex = 0;
  return input.replace(PLACEHOLDER_RE, (full, key: string) => {
    const k = key.trim();
    if (Object.prototype.hasOwnProperty.call(mapping, k)) {
      return encodeXmlEntities(mapping[k] ?? "");
    }
    return full;
  });
}
