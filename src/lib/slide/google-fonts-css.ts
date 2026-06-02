/**
 * Hilfsfunktionen für Google-Fonts-CSS-URLs.
 *
 * Pro Folie sammeln wir alle font-family-Werte aus dem Tiptap-HTML der
 * Text-Layer und bauen daraus eine einzige Google-Fonts-CSS-URL. Der
 * Browser (Editor) und Puppeteer (Worker) laden die gleiche URL — keine
 * Drift zwischen Vorschau und Render.
 */

/** Liest alle font-family-Werte aus einem HTML-String aus. */
export function extractFontFamilies(html: string): string[] {
  const out = new Set<string>();
  // style="…; font-family: 'Foo Bar', …;"
  const styleRe = /style=["']([^"']*)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = styleRe.exec(html))) {
    const ff = /font-family\s*:\s*([^;"']+)/i.exec(m[1]);
    if (!ff) continue;
    const families = ff[1]
      .split(",")
      .map((s) => s.trim().replace(/^["']|["']$/g, ""))
      .filter((s) => s.length > 0 && !/^(?:serif|sans-serif|monospace|cursive|system-ui|inherit)$/i.test(s));
    for (const f of families) out.add(f);
  }
  return Array.from(out);
}

/**
 * Baut eine einzige Google-Fonts-CSS-URL für eine Familien-Liste.
 * Jede Familie kommt mit allen Standard-Weights + Italics. Das ist
 * etwas grosszügig, aber Google liefert nur die tatsächlich benötigten
 * Glyphen-Subsets nach.
 */
export function buildGoogleFontsCssUrl(families: string[]): string | null {
  const cleaned = Array.from(new Set(families.map((f) => f.trim()).filter(Boolean)));
  if (cleaned.length === 0) return null;
  const params = cleaned
    .map((f) => `family=${encodeURIComponent(f)}:ital,wght@0,400;0,500;0,600;0,700;1,400;1,700`)
    .join("&");
  return `https://fonts.googleapis.com/css2?${params}&display=swap`;
}
