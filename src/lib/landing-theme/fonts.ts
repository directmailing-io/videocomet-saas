/**
 * Curated Google-Font list for the Landing-Page editor.
 *
 * We deliberately ship a tiny menu (12 families) so the picker stays
 * usable and so the request to fonts.googleapis.com always stays under the
 * URL-length budget. Adding a font here is a product decision — it must
 * pair well with at least one other font in the list and have a free
 * licence on Google Fonts.
 *
 * We do NOT use `next/font/google` so the font URL stays explicit and easy
 * to inspect in DevTools. Trade-off: no automatic subsetting / self-hosting,
 * but: zero build-time magic, no Next-version coupling, and the link tag
 * works in every renderer (including the SSR snapshot used by the worker).
 */

export type FontCategory = "sans" | "serif" | "display";
export type FontRole = "heading" | "body" | "both";

export interface FontDef {
  family: string;
  category: FontCategory;
  /** Which slot(s) the font is recommended for in the editor picker. */
  role: FontRole;
  /** Weights we load. Kept tight — every weight costs ~10–20 kB. */
  weights: number[];
  /** CSS fallback stack appended after the family name. */
  fallback: string;
}

const SANS_FALLBACK = "system-ui, -apple-system, Segoe UI, sans-serif";
const SERIF_FALLBACK = "Georgia, 'Times New Roman', serif";

/**
 * The full font menu. Order is intentional — the first entries are the
 * "safe" choices that match the default theme.
 */
export const LANDING_FONTS: FontDef[] = [
  // ── Universal (works as both heading and body) ───────────────────────────
  {
    family: "Inter",
    category: "sans",
    role: "both",
    weights: [400, 500, 600, 700, 800],
    fallback: SANS_FALLBACK,
  },
  {
    family: "Manrope",
    category: "sans",
    role: "both",
    weights: [400, 500, 600, 700, 800],
    fallback: SANS_FALLBACK,
  },

  // ── Heading-leaning ──────────────────────────────────────────────────────
  {
    family: "Playfair Display",
    category: "serif",
    role: "heading",
    weights: [400, 600, 700],
    fallback: SERIF_FALLBACK,
  },
  {
    family: "Space Grotesk",
    category: "sans",
    role: "heading",
    weights: [400, 500, 600, 700],
    fallback: SANS_FALLBACK,
  },
  {
    family: "DM Serif Display",
    category: "serif",
    role: "heading",
    weights: [400],
    fallback: SERIF_FALLBACK,
  },
  {
    family: "Poppins",
    category: "sans",
    role: "heading",
    weights: [400, 500, 600, 700],
    fallback: SANS_FALLBACK,
  },
  {
    family: "Cormorant Garamond",
    category: "serif",
    role: "heading",
    weights: [400, 500, 600, 700],
    fallback: SERIF_FALLBACK,
  },

  // ── Body-leaning ─────────────────────────────────────────────────────────
  {
    family: "Lato",
    category: "sans",
    role: "body",
    weights: [400, 700],
    fallback: SANS_FALLBACK,
  },
  {
    family: "Source Sans 3",
    category: "sans",
    role: "body",
    weights: [400, 600, 700],
    fallback: SANS_FALLBACK,
  },
  {
    family: "Nunito Sans",
    category: "sans",
    role: "body",
    weights: [400, 600, 700],
    fallback: SANS_FALLBACK,
  },
  {
    family: "DM Sans",
    category: "sans",
    role: "body",
    weights: [400, 500, 700],
    fallback: SANS_FALLBACK,
  },
];

/** Quick-lookup map keyed by family name. */
const FONT_INDEX: Map<string, FontDef> = new Map(
  LANDING_FONTS.map((f) => [f.family, f]),
);

export function getFontDef(family: string): FontDef | undefined {
  return FONT_INDEX.get(family);
}

/**
 * Convenience views for the editor — heading-slot vs. body-slot picker.
 * "both"-role fonts appear in both lists.
 */
export const HEADING_FONTS: FontDef[] = LANDING_FONTS.filter(
  (f) => f.role === "heading" || f.role === "both",
);
export const BODY_FONTS: FontDef[] = LANDING_FONTS.filter(
  (f) => f.role === "body" || f.role === "both",
);

/**
 * Build a single Google-Fonts CSS2 URL that loads both the heading and the
 * body family in their declared weights. Examples:
 *
 *   https://fonts.googleapis.com/css2?family=Inter:wght@400;500;700&display=swap
 *   https://fonts.googleapis.com/css2?family=Inter:wght@400;700&family=Lato:wght@400;700&display=swap
 *
 * Unknown families are silently skipped (rather than producing a 400 from
 * Google) — the renderer always has the CSS fallback stack to fall back on.
 * If neither font resolves, returns `null` so the caller can omit the tag.
 */
export function buildFontLinkHref(
  headingFamily: string,
  bodyFamily: string,
): string | null {
  const segments: string[] = [];
  const seen = new Set<string>();

  const families: Array<{ family: string }> =
    headingFamily === bodyFamily
      ? [{ family: headingFamily }]
      : [{ family: headingFamily }, { family: bodyFamily }];

  for (const { family } of families) {
    const def = FONT_INDEX.get(family);
    if (!def || seen.has(def.family)) continue;
    seen.add(def.family);
    const weights = [...def.weights].sort((a, b) => a - b).join(";");
    // Google Fonts CSS2 requires `+` for spaces in the family name.
    const encoded = def.family.replace(/ /g, "+");
    segments.push(`family=${encoded}:wght@${weights}`);
  }

  if (segments.length === 0) return null;
  return `https://fonts.googleapis.com/css2?${segments.join("&")}&display=swap`;
}

/**
 * Build the value for a CSS `font-family` declaration, e.g.
 *   `"Inter", system-ui, -apple-system, Segoe UI, sans-serif`
 *
 * Unknown families fall back to a sans stack — never undefined, so the
 * inline-style on the page root is always safe.
 */
export function buildFontFamilyValue(family: string): string {
  const def = FONT_INDEX.get(family);
  const fallback = def?.fallback ?? SANS_FALLBACK;
  // Wrap in quotes if the family name contains a space.
  const quoted = /\s/.test(family) ? `"${family}"` : family;
  return `${quoted}, ${fallback}`;
}
