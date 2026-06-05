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
import { getInlineBridgeSource } from "./bridge-inline";

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
  /** HLS-Playlist-URL des Lead-Videos. */
  videoUrl?: string | null;
  /** MP4-Fallback (Bunny `play_720p.mp4`) für broad-compat. */
  videoMp4Url?: string | null;
  /** Thumbnail-URL fürs Poster-Attribut. */
  thumbnailUrl?: string | null;
  /**
   * Aspect-Ratio des Lead-Videos. Wird in eine `--vc-video-aspect`-CSS-
   * Variable übersetzt und in den `<head>` injiziert, damit Custom-LP-
   * Templates ihre Video-Container per `aspect-ratio: var(--vc-video-aspect)`
   * styling-driven steuern können. `null` = unbekannt → 16/9.
   */
  videoOrientation?: "landscape" | "portrait" | "square" | null;
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

/**
 * Returns the bridge bootstrap snippet — STEALTH version.
 *
 * Statt einem external `<script src="…bridge.js" defer>` betten wir den
 * Bridge-Code direkt inline ein. Vorteile:
 *
 *  - **Unsichtbar im Network-Tab** — kein zweiter HTTP-Request, der Code
 *    ist Teil des HTML-Body.
 *  - **AdBlocker-resistent** — Filter-Listen blocken Requests, nicht
 *    inline-Code. Selbst aggressive Listen wie EasyPrivacy lassen das
 *    Tracking durch.
 *  - **Faster** — keine zweite TCP-Roundtrip nötig bis Tracking startet.
 *
 * Der `trackingBridgeUrl`-Parameter wird IGNORIERT (für Kompatibilität).
 * Endpoint ist auf `/_e` hard-coded in der Bridge selbst und wird über
 * `getInlineBridgeSource()` reingepatched.
 */
export function buildBridgeSnippet(args: {
  slug: string;
  leadData: Record<string, string>;
  annotations: unknown;
  trackingBridgeUrl?: string;
}): string {
  const ctx = {
    slug: args.slug,
    lead: args.leadData,
    annotations: args.annotations ?? null,
  };
  // Two-script pattern: state-Dump FIRST damit die Bridge auf
  // `window.__videocomet` direkt zugreift, danach die Bridge inline.
  return (
    `<script>window.__videocomet=${safeScriptJson(ctx)};</script>` +
    `<script>${getInlineBridgeSource()}</script>`
  );
}

/**
 * Sucht `<video>`-Tags, deren `src` (oder erstes `<source src>`) leer ist,
 * und schreibt die Lead-Video-URLs hinein. Sonst bleibt das Template-Tag
 * unangetastet — Kunden mit hartkodierter Video-Source werden nicht
 * überschrieben.
 *
 * Wir suchen Video-Elemente die EINES dieser Kriterien erfüllen:
 *  - `data-vc-video` Attribut (Konvention aus dem Starter-Kit)
 *  - Vorfahre mit `data-vc-video="primary"` (Konvention im Finestsites-Template)
 *  - Erstes `<video>`-Element im Body (Fallback)
 *
 * Implementation: simple Regex-Pass mit zwei Layern — finde alle <video>...
 * </video>-Blöcke und entscheide pro Block via Kontext (vorhergehende ~400
 * Zeichen) ob es ein „unser" Video ist.
 */
function injectVideoSources(
  html: string,
  args: {
    videoUrl: string | null;
    videoMp4Url: string | null;
    thumbnailUrl: string | null;
  },
): string {
  const mp4 = args.videoMp4Url ?? args.videoUrl ?? null;
  if (!mp4) return html; // Nichts zu injizieren.

  const videoBlockRe = /<video\b([^>]*)>([\s\S]*?)<\/video\s*>/gi;
  let result = "";
  let lastIdx = 0;
  let match: RegExpExecArray | null;
  let injectedOnce = false;

  while ((match = videoBlockRe.exec(html)) !== null) {
    const [full, attrs, inner] = match;
    const blockStart = match.index;

    // Heuristik: nur "leere" Videos überschreiben — sonst riskieren wir,
    // dass der Kunde sein eigenes Video hartkodiert hat und wir es
    // ungewollt austauschen.
    const hasNonEmptySrcAttr =
      /\bsrc\s*=\s*("[^"]*\.[^"]*"|'[^']*\.[^']*')/i.test(attrs);
    const hasNonEmptySource =
      /<source\b[^>]*\bsrc\s*=\s*("[^"]*\.[^"]*"|'[^']*\.[^']*')/i.test(inner);
    if (hasNonEmptySrcAttr || hasNonEmptySource) {
      result += html.slice(lastIdx, blockStart + full.length);
      lastIdx = blockStart + full.length;
      continue;
    }

    // Check Marker im Block selbst ODER in den nähesten 400 Zeichen
    // davor (Wrapper mit data-vc-video).
    const contextBefore = html.slice(Math.max(0, blockStart - 400), blockStart);
    const isMarked =
      /\bdata-vc-video\b/i.test(attrs) ||
      /\bdata-vc-video\s*=\s*("primary"|'primary')/i.test(contextBefore);
    if (!isMarked && injectedOnce) {
      // Kein Marker UND wir haben schon das erste Video gefüllt → in Ruhe lassen.
      result += html.slice(lastIdx, blockStart + full.length);
      lastIdx = blockStart + full.length;
      continue;
    }

    // ── Re-build the <video> tag with src + poster injected. ──────────
    let newAttrs = attrs;
    // poster setzen wenn leer oder fehlend.
    if (args.thumbnailUrl) {
      if (/\bposter\s*=\s*("[^"]*"|'[^']*')/i.test(newAttrs)) {
        newAttrs = newAttrs.replace(
          /\bposter\s*=\s*("[^"]*"|'[^']*')/i,
          `poster="${htmlEscape(args.thumbnailUrl)}"`,
        );
      } else {
        newAttrs = ` poster="${htmlEscape(args.thumbnailUrl)}"` + newAttrs;
      }
    }

    // Inner: leere <source>-Tags ersetzen, sonst eine frische <source>
    // an den Anfang.
    let newInner = inner;
    const emptySourceRe =
      /<source\b([^>]*?)\bsrc\s*=\s*(""|'')([^>]*)>/i;
    if (emptySourceRe.test(newInner)) {
      newInner = newInner.replace(
        emptySourceRe,
        `<source$1src="${htmlEscape(mp4)}"$3>`,
      );
    } else {
      newInner =
        `<source src="${htmlEscape(mp4)}" type="video/mp4" />` + newInner;
      // Wenn HLS-Variante existiert UND vom mp4 verschieden, auch HLS
      // anbieten (Safari kann nativ).
      if (args.videoUrl && args.videoUrl !== mp4) {
        newInner =
          `<source src="${htmlEscape(args.videoUrl)}" type="application/vnd.apple.mpegurl" />` +
          newInner;
      }
    }

    const rebuilt = `<video${newAttrs}>${newInner}</video>`;
    result += html.slice(lastIdx, blockStart) + rebuilt;
    lastIdx = blockStart + full.length;
    injectedOnce = true;
  }

  result += html.slice(lastIdx);
  return result;
}

/**
 * Übersetzt die Lead-Orientation (+ ggf. die `videoAspectStrategy`-
 * Annotation) in den `aspect-ratio`-CSS-Wert für die `--vc-video-aspect`-
 * Variable. `force-*`-Strategien überschreiben die Lead-Orientation.
 *
 * Default-Fallback ist `16 / 9` — kompatibel mit dem Bestand (vor Paket A).
 */
export function resolveVideoAspectValue(args: {
  videoOrientation: "landscape" | "portrait" | "square" | null | undefined;
  annotations: CustomLpAnnotations | Record<string, unknown> | null;
}): string {
  const rawStrategy =
    args.annotations && typeof args.annotations === "object"
      ? (args.annotations as Record<string, unknown>).videoAspectStrategy
      : undefined;
  const strategy =
    rawStrategy === "force-landscape" ||
    rawStrategy === "force-portrait" ||
    rawStrategy === "preserve"
      ? rawStrategy
      : "preserve";

  if (strategy === "force-landscape") return "16 / 9";
  if (strategy === "force-portrait") return "9 / 16";

  // preserve → Lead-Orientation
  switch (args.videoOrientation) {
    case "portrait":
      return "9 / 16";
    case "square":
      return "1 / 1";
    case "landscape":
      return "16 / 9";
    default:
      // Unknown — defensive 16/9, kompatibel mit Bestand.
      return "16 / 9";
  }
}

/**
 * Baut den `<style>:root { --vc-video-aspect: …; }</style>`-Snippet, der
 * im `<head>` der Custom-LP injiziert wird. Templates referenzieren die
 * Variable per `aspect-ratio: var(--vc-video-aspect, 16 / 9)`.
 */
function buildAspectStyleSnippet(aspect: string): string {
  // `aspect` ist ein kontrollierter Wert ("16 / 9", "9 / 16", "1 / 1") aus
  // `resolveVideoAspectValue`. Trotzdem defensiv escapen — vermeidet
  // jegliches CSS-Injection-Risiko, falls jemand die Helper-Signatur
  // missbraucht.
  const safe = aspect.replace(/[^0-9./\s]/g, "");
  return `<style data-vc-video-aspect>:root{--vc-video-aspect:${safe};}</style>`;
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

  // 2. Video-Inject: leere <video src> mit der Lead-Video-URL füllen.
  out = injectVideoSources(out, {
    videoUrl: args.videoUrl ?? null,
    videoMp4Url: args.videoMp4Url ?? null,
    thumbnailUrl: args.thumbnailUrl ?? null,
  });

  // 3. `<base href>` at the top of <head>. Doing this AFTER placeholder
  //    substitution avoids the (tiny) risk of a `{{…}}` inside an injected
  //    snippet being processed.
  out = injectIntoHead(out, `<base href="${htmlEscape(baseHref)}">`);

  // 4. Aspect-Ratio-CSS-Variable. Wird DIREKT nach `<base href>` in den
  //    `<head>` geschoben, damit auch die ersten Stylesheet-Regeln auf den
  //    Wert zugreifen koennen. Templates referenzieren ihn als
  //    `aspect-ratio: var(--vc-video-aspect)`.
  const aspectValue = resolveVideoAspectValue({
    videoOrientation: args.videoOrientation ?? null,
    annotations: args.annotations ?? null,
  });
  out = injectIntoHead(out, buildAspectStyleSnippet(aspectValue));

  // 5. Tracking-bridge bootstrap right before </body>.
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
  resolveVideoAspectValue,
  buildAspectStyleSnippet,
};
