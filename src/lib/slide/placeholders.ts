/**
 * Auflösen von Platzhaltern in Slide-HTML.
 *
 * Tiptap rendert Platzhalter als
 *   <span data-placeholder="key">{{key}}</span>
 * Mit optionalem Fallback:
 *   <span data-placeholder="key" data-fallback="…">{{key}}</span>
 *
 * Beim Render eines Leads ersetzen wir diese Nodes durch den Wert aus
 * `leadData[key]` (case-insensitive fallback wie im gdocs-Flow). Wenn der
 * Wert leer ist, springt der Fallback ein — sonst eine leere Zeichenkette.
 */

const KEY_CANDIDATES_LOWER = (key: string): string[] => [
  key,
  key.toLowerCase(),
];

function pickValue(
  data: Record<string, string>,
  key: string,
): string | null {
  for (const k of KEY_CANDIDATES_LOWER(key)) {
    const v = data[k];
    if (typeof v === "string" && v.trim()) return v;
  }
  const lower = key.toLowerCase();
  for (const [k, v] of Object.entries(data)) {
    if (k.toLowerCase() === lower && typeof v === "string" && v.trim()) {
      return v;
    }
  }
  return null;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Ersetzt alle `<span data-placeholder>`-Nodes durch den entsprechenden Wert.
 * Verwendet ein Regex statt DOM-Parsing, damit die Funktion auf Node
 * (Worker) ohne DOM funktioniert.
 *
 * Akzeptiert dabei beliebige Attribut-Reihenfolge und zusätzliche
 * Klassen/Styles, weil Tiptap die Spans manchmal mit `class="placeholder"`
 * versieht. Greedy + lazy matching auf den inneren Body.
 */
export function resolvePlaceholders(
  html: string,
  leadData: Record<string, string>,
): string {
  // Außerdem die rohen {{key}}-Tokens (für rückwärtskompatible Texte)
  const withSpansResolved = html.replace(
    /<span\b([^>]*?)data-placeholder=["']([\w-]+)["']([^>]*)>([\s\S]*?)<\/span>/gi,
    (_match, before: string, key: string, after: string, _inner: string) => {
      const attrs = `${before} ${after}`;
      const fallbackMatch = attrs.match(/data-fallback=["']([^"']*)["']/i);
      const fallback = fallbackMatch ? fallbackMatch[1] : "";
      const value = pickValue(leadData, key) ?? fallback;
      return escapeHtml(value);
    },
  );
  return withSpansResolved.replace(
    /\{\{\s*([\w-]+)\s*\}\}/g,
    (_match, key: string) => {
      const value = pickValue(leadData, key) ?? "";
      return escapeHtml(value);
    },
  );
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
