/**
 * Theme + brand types for the block-based Landing-Page system (v2).
 *
 * The content JSON shape lives in `landing_page_templates.content` and follows:
 *   { version: 2, theme, brand, blocks, legacy? }
 *
 * This module owns the THEME and BRAND parts only. Blocks are owned by
 * Agent A; schema/worker/middleware live elsewhere.
 *
 * All values are intentionally simple JSON primitives so the JSONB column
 * can be serialised / deserialised without custom revivers.
 */

export type ThemePresetId =
  | "noir"
  | "clean"
  | "warm"
  | "bold"
  | "editorial"
  | "custom";

export type SpacingScale = "compact" | "cozy" | "spacious";
export type RadiusScale = "sharp" | "rounded" | "pill";

/** Hell/Dunkel-Modus der Seite (v3 Brand-Kit). */
export type ThemeMode = "light" | "dark";

/**
 * Neue 4-Stufen-Rundungsskala (v3). Das alte 3-stufige `radius` bleibt
 * für Bestandsdaten erhalten — `LEGACY_RADIUS_TO_SCALE` mappt alt → neu.
 */
export type RadiusScaleV3 = "none" | "subtle" | "soft" | "round";

/** Schatten-Intensität (v3): Flach / Weich / Ausgeprägt. */
export type ShadowScale = "flat" | "soft" | "bold";

/**
 * Mapping der alten Radius-Skala auf die neue. "rounded" landet bewusst
 * auf "soft" (nicht "subtle") — das entspricht dem bisherigen 12px-Look
 * am ehesten.
 */
export const LEGACY_RADIUS_TO_SCALE: Record<RadiusScale, RadiusScaleV3> = {
  sharp: "none",
  rounded: "soft",
  pill: "round",
};

/**
 * Six semantic colour roles. Every block must reference these via the
 * CSS custom properties (`--lp-color-*`) — never via Tailwind brand tokens —
 * so that user-supplied palettes flow through end-to-end.
 *
 * Values are CSS colour strings; hex is the canonical form, but any valid
 * CSS colour ( rgb(), hsl(), named ) is accepted and passed through verbatim.
 */
export interface ThemeColors {
  /** Primary brand colour — used for CTAs, focus rings, accents-on-light. */
  primary: string;
  /** Secondary accent — used for hover-states, highlights, callouts. */
  accent: string;
  /** Page background — outermost canvas behind every block. */
  bg: string;
  /** Card / section background — sits on top of `bg`. */
  surface: string;
  /** Body-copy / heading text colour. */
  text: string;
  /** Muted text — captions, footnotes, secondary labels. */
  muted: string;
}

/**
 * Google Font family names. The font loader takes care of building the
 * `<link>` href; only the bare family name (without weights) is stored here
 * so users can switch fonts without re-encoding the URL.
 */
export interface ThemeFonts {
  heading: string;
  body: string;
}

/**
 * The full theme object stored under `content.theme`. `preset` is metadata
 * only — the actual values used at render time always come from `colors` /
 * `fonts` / `spacing` / `radius` so the editor can "fork" a preset by
 * editing any field without losing the others.
 */
export interface ThemeConfig {
  preset?: ThemePresetId;
  colors: ThemeColors;
  fonts: ThemeFonts;
  spacing: SpacingScale;
  radius: RadiusScale;

  // ── v3 Brand-Kit-Felder — alle optional, damit Bestandsdaten ohne
  //    Migration weiter funktionieren. Fehlende Werte werden beim Lesen
  //    (extract.ts) bzw. Rendern (css-vars.ts) aus den alten abgeleitet. ──

  /** Hell/Dunkel-Modus. Fehlt er, wird er aus der Luminanz von `colors.bg` erkannt. Default "light". */
  mode?: ThemeMode;
  /** Neue 4-Stufen-Rundungsskala. Fehlt sie, greift `LEGACY_RADIUS_TO_SCALE[radius]`. */
  radiusScale?: RadiusScaleV3;
  /** Schatten-Stil. Default "soft". */
  shadow?: ShadowScale;
  /** ID eines kuratierten Font-Paars (font-pairs.ts). Metadaten — gerendert wird immer `fonts`. */
  fontPairId?: string;
}

/**
 * Brand slots — logo + footer behaviour. Footer visibility is computed at
 * render time using both `showFooter` (user intent, optional) and the
 * domain type (custom vs. default) — see `src/app/v/[slug]/page.tsx`.
 */
export interface BrandConfig {
  /** Public URL of a logo asset (uploaded to the mediathek as type=logo). */
  logoUrl?: string | null;
  /** Logo alignment in the header. Defaults to "left". */
  logoAlign?: "left" | "center";
  /**
   * Tri-state:
   *   - `true`  → always show footer (overrides domain default)
   *   - `false` → always hide footer (overrides domain default)
   *   - `undefined` → fall back to domain default (custom → hide, default → show)
   */
  showFooter?: boolean;
  /**
   * Optional plain-text footer. If empty AND on default domain, the public
   * page falls back to the VIDEOCOMET logo footer (cf. `BrandFooter`).
   */
  footerText?: string;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

/**
 * Safe defaults used when the stored JSON omits the theme key entirely —
 * e.g. legacy v1 templates that only have `{headline, ctaText, …}`.
 * Mirrors the "clean" preset (white / blue / Inter / cozy / rounded).
 */
export const DEFAULT_THEME: ThemeConfig = {
  preset: "clean",
  colors: {
    primary: "#2563eb",
    accent: "#3b82f6",
    bg: "#ffffff",
    surface: "#f8fafc",
    text: "#0f172a",
    muted: "#64748b",
  },
  fonts: {
    heading: "Inter",
    body: "Inter",
  },
  spacing: "cozy",
  radius: "rounded",
};

/**
 * Safe brand defaults — no logo, left-aligned, footer left to the page-level
 * domain heuristic, no custom footer text.
 */
export const DEFAULT_BRAND: BrandConfig = {
  logoUrl: null,
  logoAlign: "left",
  showFooter: undefined,
  footerText: "",
};
