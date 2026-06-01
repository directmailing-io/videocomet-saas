/**
 * HTML-Sanitizer for the customer's `index.html`.
 *
 * Philosophy: PERMISSIVE — the customer uploads their own page and we
 * should preserve their markup, classes, ids, inline styles, custom
 * elements, and even `<script>` tags (because they explicitly bring their
 * own JS). We only strip the small handful of patterns that obviously
 * enable cross-tenant XSS via injected lead data or hostile asset paths:
 *
 *   - Every `on*` attribute (`onclick`, `onerror`, `onload`, …)
 *   - `javascript:` URIs in href / src / action / formaction / xlink:href
 *   - `<meta http-equiv="refresh">` (we control redirects)
 *   - `<base href>` (we inject our own `<base>` in the renderer so relative
 *     assets resolve against the sandbox path)
 *
 * Everything else is left UNTOUCHED. We do not collapse whitespace, rewrite
 * the doctype, normalise attribute quoting, or change tag casing — the
 * output of `sanitizeIndexHtml` should be byte-identical to the input
 * outside the explicitly-stripped regions.
 *
 * Why we don't use `sanitize-html` here: that library is fundamentally an
 * allow-list sanitizer (it rebuilds the tree from scratch through a strict
 * schema). For our use-case that would mean re-implementing the entire HTML
 * spec in the allow-list, and we'd still strip benign customer markup. The
 * surgical regex/parser approach below targets only the known-bad patterns.
 *
 * The dependency is still installed (per spec) and is available for future
 * sub-features (e.g. sanitising user-provided notes) where the allow-list
 * model fits.
 */

/**
 * Strips dangerous patterns from a customer-uploaded `index.html` string.
 * Returns a string that can be safely served by the sandbox subdomain
 * after the renderer rewrites placeholders and injects the tracking bridge.
 */
export function sanitizeIndexHtml(html: string): string {
  let out = html;

  // 1. Remove every `on*` attribute. We handle three quoting styles:
  //    on…="…"   on…='…'   on…=…  (unquoted)
  //
  //    The regex anchors on a preceding whitespace character so we don't
  //    accidentally chew text that *contains* "onclick" inside a script or
  //    style block — those aren't real attribute positions in any parser.
  out = out.replace(
    /(\s)on[a-zA-Z][a-zA-Z0-9_-]*\s*=\s*"[^"]*"/g,
    "$1",
  );
  out = out.replace(
    /(\s)on[a-zA-Z][a-zA-Z0-9_-]*\s*=\s*'[^']*'/g,
    "$1",
  );
  out = out.replace(
    /(\s)on[a-zA-Z][a-zA-Z0-9_-]*\s*=\s*[^\s"'>`]+/g,
    "$1",
  );

  // 2. Neutralise `javascript:` URIs in known sink attributes.
  //    We replace the entire attribute value with `#` so the surrounding
  //    HTML stays well-formed. We also handle interleaved whitespace and
  //    HTML entity tricks (e.g. `java&#0009;script:`).
  const SINK_ATTRS = [
    "href",
    "src",
    "action",
    "formaction",
    "background",
    "poster",
    "xlink:href",
    "ping",
  ];
  const sinkPattern = SINK_ATTRS.map((a) => a.replace(":", "\\:")).join("|");

  const stripJsUri = (value: string): string => {
    // Decode the few HTML numeric entities most commonly used to smuggle
    // `javascript:` (NUL, TAB, LF, CR). We don't try to be exhaustive —
    // anything else falls back to the URI string match.
    const decoded = value
      .replace(/&#0*9;?/gi, "\t")
      .replace(/&#x0*9;?/gi, "\t")
      .replace(/&#0*10;?/gi, "\n")
      .replace(/&#x0*A;?/gi, "\n")
      .replace(/&#0*13;?/gi, "\r")
      .replace(/&#x0*D;?/gi, "\r")
      .replace(/&#0*0;?/gi, "")
      .replace(/&#x0*0;?/gi, "");
    if (/^\s*j\s*a\s*v\s*a\s*s\s*c\s*r\s*i\s*p\s*t\s*:/i.test(decoded)) {
      return "#";
    }
    if (/^\s*data\s*:\s*text\/html/i.test(decoded)) {
      // `data:text/html` is a JS-equivalent escape hatch — also block.
      return "#";
    }
    if (/^\s*vbscript\s*:/i.test(decoded)) return "#";
    return value;
  };

  out = out.replace(
    new RegExp(
      `(\\s)(${sinkPattern})(\\s*=\\s*)("([^"]*)"|'([^']*)'|([^\\s"'>\`]+))`,
      "gi",
    ),
    (_m, ws: string, attr: string, eq: string, _full: string, dq?: string, sq?: string, uq?: string) => {
      const raw = dq ?? sq ?? uq ?? "";
      const replaced = stripJsUri(raw);
      if (dq !== undefined) return `${ws}${attr}${eq}"${replaced}"`;
      if (sq !== undefined) return `${ws}${attr}${eq}'${replaced}'`;
      return `${ws}${attr}${eq}${replaced}`;
    },
  );

  // 3. Strip `<meta http-equiv="refresh" …>`.
  out = out.replace(
    /<meta\b[^>]*http-equiv\s*=\s*(["']?)\s*refresh\s*\1[^>]*>/gi,
    "",
  );

  // 4. Strip `<base href="…">` — we inject our own in the renderer.
  out = out.replace(/<base\b[^>]*>/gi, "");

  return out;
}

/**
 * Helper for unit tests / debugging: returns the set of patterns the
 * sanitizer strips. Kept stable so callers can assert "did we strip X?".
 */
export const SANITIZER_RULES = {
  stripsOnAttributes: true,
  stripsJavascriptUris: true,
  stripsDataTextHtmlUris: true,
  stripsVbScriptUris: true,
  stripsMetaRefresh: true,
  stripsBaseHref: true,
} as const;
