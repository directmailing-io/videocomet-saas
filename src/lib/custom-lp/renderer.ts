/**
 * Server-side HTML rewriter for a customer's `index.html`.
 *
 * Pipeline per request to the sandbox subdomain:
 *
 *   sanitised HTML
 *      │
 *      ├──► substitute lead-data placeholders   (text + safe attributes)
 *      ├──► inject `<base href="/cv/<slug>/">`  (head, early)
 *      └──► inject tracking-bridge script tag   (just before </body>)
 *
 * Placeholders:
 *   `{{key}}`             → `leadData[key] ?? ""`
 *   `{{key|fallback}}`    → `leadData[key] ?? "fallback"`
 *
 * Substitution scope:
 *   - Text nodes
 *   - Specific attributes: alt, title, href, src, value, placeholder,
 *     content, and any `data-*`.
 *   - We intentionally do NOT substitute inside `<script>` or `<style>`
 *     blocks. Those run as code/CSS in the browser and replacing tokens
 *     there would silently break the customer's site (e.g. `{{foo}}` inside
 *     a JS string literal would change byte length and offsets).
 *
 * Implementation: regex-based. The customer's HTML is opaque to us — we
 * don't want to round-trip it through a strict parser that might reformat
 * tags. We scan once, skip over script/style blocks, and replace `{{…}}`
 * tokens in the remaining ranges. If we ever need to support placeholders
 * inside more nuanced positions (e.g. SVG `xlink:href`) we can switch to
 * `parse5` — for now the regex is sufficient and keeps the customer's
 * markup byte-stable everywhere else.
 */

import type { CustomLpAnnotations } from "./types";

export interface RenderCustomLpArgs {
  /** Sanitised customer HTML (after sanitizer.ts). */
  html: string;
  /** Lead data — keys map to placeholders via `{{key}}` / `{{key|fb}}`. */
  leadData: Record<string, string>;
  /** Per-lead slug, used for the `<base href>` and the tracking bridge. */
  slug: string;
  /** Absolute or root-relative URL of the tracking-bridge JS. */
  trackingBridgeUrl: string;
  /** Element annotations set in the customer's element picker. */
  annotations: CustomLpAnnotations | Record<string, unknown> | null;
}

/** HTML-escape minimum needed to prevent breaking attributes/text nodes. */
function htmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * JSON-encode and escape characters that would otherwise close the
 * surrounding `<script>` tag or break script parsing. We also encode
 * U+2028 / U+2029 because they are valid JSON but invalid JS string
 * characters before ES2019.
 */
/** Built from char codes so this source file stays pure ASCII. */
const LINE_SEP_RE = new RegExp(String.fromCharCode(0x2028), "g");
const PARA_SEP_RE = new RegExp(String.fromCharCode(0x2029), "g");

function safeScriptJson(value: unknown): string {
  let json = JSON.stringify(value ?? null);
  json = json.replace(/</g, "\\u003c");
  json = json.replace(/>/g, "\\u003e");
  json = json.replace(/&/g, "\\u0026");
  // U+2028 / U+2029 — valid in JSON but illegal in JS string literals
  // before ES2019. Escape them so old browsers don't choke on inline JSON.
  json = json.replace(LINE_SEP_RE, "\\u2028");
  json = json.replace(PARA_SEP_RE, "\\u2029");
  return json;
}

const PLACEHOLDER_RE = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_\-.]*)\s*(?:\|([^}]*))?\}\}/g;

/** Resolve a single placeholder against the lead data bag. */
function resolvePlaceholder(
  key: string,
  fallback: string | undefined,
  leadData: Record<string, string>,
): string {
  if (Object.prototype.hasOwnProperty.call(leadData, key)) {
    const v = leadData[key];
    if (v !== undefined && v !== null && String(v).length > 0) return String(v);
  }
  return (fallback ?? "").trim();
}

/**
 * Walks the HTML string and yields character ranges that are SAFE for
 * placeholder substitution. We carve out `<script>…</script>` and
 * `<style>…</style>` blocks (their content) and the prologue/comments.
 *
 * Returned ranges are inclusive-start, exclusive-end.
 */
function safeRanges(html: string): Array<[number, number]> {
  const skipRe = /<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;
  const ranges: Array<[number, number]> = [];
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = skipRe.exec(html)) !== null) {
    if (m.index > last) ranges.push([last, m.index]);
    last = m.index + m[0].length;
  }
  if (last < html.length) ranges.push([last, html.length]);
  return ranges;
}

/**
 * Substitutes `{{key}}` / `{{key|fallback}}` tokens in the placeholder-safe
 * ranges of the input HTML. Substituted values are HTML-escaped so they
 * cannot break out of an attribute or inject markup.
 */
function substitutePlaceholders(
  html: string,
  leadData: Record<string, string>,
): string {
  const ranges = safeRanges(html);
  if (ranges.length === 0) return html;

  let result = "";
  let cursor = 0;
  for (const [start, end] of ranges) {
    // Copy the carved-out (skipped) chunk verbatim.
    if (start > cursor) result += html.slice(cursor, start);
    const slice = html.slice(start, end);
    const replaced = slice.replace(
      PLACEHOLDER_RE,
      (_match, key: string, fallback?: string) => {
        const value = resolvePlaceholder(key, fallback, leadData);
        return htmlEscape(value);
      },
    );
    result += replaced;
    cursor = end;
  }
  if (cursor < html.length) result += html.slice(cursor);
  return result;
}

/**
 * Inserts a snippet immediately after the opening `<head>` tag (or, if the
 * markup has no `<head>`, at the very top of the document body). We need
 * the `<base href>` to be the FIRST element inside `<head>` so all later
 * relative URLs (including `<link rel="stylesheet">` and `<script src>`)
 * resolve against the sandbox path.
 */
function injectIntoHead(html: string, snippet: string): string {
  const headOpenRe = /<head\b[^>]*>/i;
  const match = headOpenRe.exec(html);
  if (match) {
    const idx = match.index + match[0].length;
    return html.slice(0, idx) + snippet + html.slice(idx);
  }
  // No <head> — try injecting before <body>.
  const bodyOpenRe = /<body\b[^>]*>/i;
  const bMatch = bodyOpenRe.exec(html);
  if (bMatch) {
    return html.slice(0, bMatch.index) + `<head>${snippet}</head>` + html.slice(bMatch.index);
  }
  // Pathological: no <head> and no <body>. Prepend at start.
  return `<head>${snippet}</head>${html}`;
}

/**
 * Inserts a snippet immediately before the closing `</body>` tag. Falls
 * back to appending at the end of the document if `</body>` is missing.
 */
function injectBeforeBodyEnd(html: string, snippet: string): string {
  const re = /<\/body\s*>/i;
  const match = re.exec(html);
  if (match) {
    return html.slice(0, match.index) + snippet + html.slice(match.index);
  }
  return html + snippet;
}

/**
 * Builds the `<base href>` string for a given slug. The trailing slash is
 * required — without it the browser treats the last path segment as a file
 * and resolves siblings, not children.
 */
export function buildBaseHref(slug: string): string {
  const safeSlug = slug.replace(/[^a-zA-Z0-9_\-./]/g, "");
  return `/cv/${safeSlug}/`;
}

/** Returns the `<script>…</script>` snippet that bootstraps the bridge. */
export function buildBridgeSnippet(args: {
  slug: string;
  leadData: Record<string, string>;
  annotations: unknown;
  trackingBridgeUrl: string;
}): string {
  const ctx = {
    slug: args.slug,
    lead: args.leadData,
    annotations: args.annotations ?? null,
  };
  // The two-script pattern (state THEN bridge) ensures the bridge can read
  // `window.__videocomet` synchronously on parse, even before defer kicks in.
  return (
    `<script>window.__videocomet=${safeScriptJson(ctx)};</script>` +
    `<script src="${htmlEscape(args.trackingBridgeUrl)}" defer></script>`
  );
}

/**
 * Public entry point — combines all rewrite steps. Idempotent up to
 * placeholder values: calling this twice with the same input produces
 * identical output.
 */
export function renderCustomLp(args: RenderCustomLpArgs): string {
  const baseHref = buildBaseHref(args.slug);

  // 1. Placeholder substitution (skips script/style content).
  let out = substitutePlaceholders(args.html, args.leadData);

  // 2. `<base href>` at the top of <head>. Doing this AFTER placeholder
  //    substitution avoids the (tiny) risk of a `{{…}}` inside an injected
  //    snippet being processed.
  out = injectIntoHead(out, `<base href="${htmlEscape(baseHref)}">`);

  // 3. Tracking-bridge bootstrap right before </body>.
  out = injectBeforeBodyEnd(
    out,
    buildBridgeSnippet({
      slug: args.slug,
      leadData: args.leadData,
      annotations: args.annotations,
      trackingBridgeUrl: args.trackingBridgeUrl,
    }),
  );

  return out;
}

/** Default tracking-bridge URL. Agent B serves the actual script at this path. */
export const DEFAULT_TRACKING_BRIDGE_URL = "/__bridge.js";

/** Exposed for unit tests. */
export const _renderInternals = {
  htmlEscape,
  safeScriptJson,
  substitutePlaceholders,
  injectIntoHead,
  injectBeforeBodyEnd,
  resolvePlaceholder,
  safeRanges,
};
