/**
 * Turn a `ThemeConfig` into the CSS-custom-properties block that block
 * components consume via `var(--lp-color-primary)` etc.
 *
 * Why CSS vars instead of Tailwind tokens?
 *   - The values come from user-supplied JSON at render time. Tailwind
 *     compiles its classes at build time, so we can't express "user picked
 *     hex #abc123" without writing it as an inline-style variable.
 *   - It keeps the block components free of `style={{ color: theme.foo }}`
 *     spaghetti — they read everything through one stable contract.
 */

import { buildFontFamilyValue } from "./fonts";
import {
  borderTone,
  hoverTone,
  modeFromBackground,
  onColor,
  softTone,
} from "./derived-colors";
import {
  LEGACY_RADIUS_TO_SCALE,
  type RadiusScaleV3,
  type ShadowScale,
  type SpacingScale,
  type ThemeConfig,
  type ThemeMode,
} from "./types";

/** Section vertical padding (top + bottom) per spacing scale. */
const SPACING_PX: Record<SpacingScale, string> = {
  compact: "16px",
  cozy: "32px",
  spacious: "56px",
};

/**
 * v3-Rundungsskala: pro Stufe fest definierte Werte je Element-Rolle —
 * "round" macht Buttons zur Pille UND Karten weicher, konsistent überall
 * (Konzept Abschnitt 4). Kein Pixel-Input für User.
 */
const RADIUS_SCALE_PX: Record<
  RadiusScaleV3,
  { card: string; button: string; input: string; image: string }
> = {
  none: { card: "0px", button: "0px", input: "0px", image: "0px" },
  subtle: { card: "8px", button: "8px", input: "6px", image: "8px" },
  soft: { card: "16px", button: "12px", input: "10px", image: "14px" },
  round: { card: "24px", button: "9999px", input: "12px", image: "20px" },
};

/**
 * Schatten-Stile je Intensität und Modus. Dark-Schatten sind schwärzer,
 * aber dezenter gestreut — auf dunklem Grund tragen sonst schon kleine
 * Schatten zu dick auf.
 */
const SHADOWS: Record<
  ThemeMode,
  Record<ShadowScale, { card: string; cta: string }>
> = {
  light: {
    flat: { card: "none", cta: "none" },
    soft: {
      card: "0 1px 2px rgba(15, 23, 42, 0.06), 0 8px 24px rgba(15, 23, 42, 0.08)",
      cta: "0 2px 6px rgba(15, 23, 42, 0.10), 0 6px 16px rgba(15, 23, 42, 0.12)",
    },
    bold: {
      card: "0 2px 4px rgba(15, 23, 42, 0.10), 0 18px 44px rgba(15, 23, 42, 0.18)",
      cta: "0 4px 12px rgba(15, 23, 42, 0.18), 0 10px 28px rgba(15, 23, 42, 0.22)",
    },
  },
  dark: {
    flat: { card: "none", cta: "none" },
    soft: {
      card: "0 1px 2px rgba(0, 0, 0, 0.40), 0 8px 20px rgba(0, 0, 0, 0.35)",
      cta: "0 2px 6px rgba(0, 0, 0, 0.45)",
    },
    bold: {
      card: "0 2px 4px rgba(0, 0, 0, 0.50), 0 14px 36px rgba(0, 0, 0, 0.50)",
      cta: "0 4px 12px rgba(0, 0, 0, 0.55)",
    },
  },
};

/**
 * The full set of CSS custom properties exposed by `<LandingThemeProvider>`.
 * Keys are camelCase-free (`--lp-…`) for clarity in DevTools and to avoid
 * collisions with the rest of the app's tailwind theme.
 *
 * Returns a `Record<string, string>` so it can be spread straight into a
 * React `style={...}` prop — no extra wrapping needed.
 */
export function buildThemeCssVars(
  theme: ThemeConfig,
): Record<string, string> {
  // v3-Felder sind optional — fehlende Werte werden hier (nicht nur in
  // extract.ts) abgeleitet, weil Presets/hand-gebaute Themes auch direkt
  // an den Renderer gehen können.
  const mode: ThemeMode = theme.mode ?? modeFromBackground(theme.colors.bg);
  const radiusScale: RadiusScaleV3 =
    theme.radiusScale ?? LEGACY_RADIUS_TO_SCALE[theme.radius];
  const shadow: ShadowScale = theme.shadow ?? "soft";
  const radius = RADIUS_SCALE_PX[radiusScale];
  const shadows = SHADOWS[mode][shadow];

  return {
    "--lp-color-primary": theme.colors.primary,
    "--lp-color-accent": theme.colors.accent,
    "--lp-color-bg": theme.colors.bg,
    "--lp-color-surface": theme.colors.surface,
    "--lp-color-text": theme.colors.text,
    "--lp-color-muted": theme.colors.muted,
    "--lp-color-on-primary": onColor(theme.colors.primary),
    "--lp-color-primary-soft": softTone(theme.colors.primary, mode),
    "--lp-color-primary-hover": hoverTone(theme.colors.primary, mode),
    "--lp-color-border": borderTone(theme.colors.bg, mode),
    "--lp-font-heading": buildFontFamilyValue(theme.fonts.heading),
    "--lp-font-body": buildFontFamilyValue(theme.fonts.body),
    // Bestand: alte Blöcke lesen weiter --lp-radius — ab v3 einheitlich
    // der Card-Wert. Legacy "pill" wandert damit bewusst von 999px auf
    // 24px: Karten mit 999px waren nie gewollt, Buttons holen sich die
    // Pille jetzt über --lp-radius-button.
    "--lp-radius": radius.card,
    "--lp-radius-card": radius.card,
    "--lp-radius-button": radius.button,
    "--lp-radius-input": radius.input,
    "--lp-radius-image": radius.image,
    "--lp-shadow-card": shadows.card,
    "--lp-shadow-cta": shadows.cta,
    "--lp-space-y": SPACING_PX[theme.spacing],
  };
}

/**
 * Convenience inline-style for the outermost wrapper. Combines the CSS-var
 * block with the three "always wanted" page-level defaults (background,
 * foreground text, body font). Block components inherit `font-family` from
 * here and pick `--lp-font-heading` explicitly for headings.
 */
export function buildThemeRootStyle(theme: ThemeConfig): React.CSSProperties {
  const vars = buildThemeCssVars(theme);
  return {
    ...(vars as React.CSSProperties),
    background: "var(--lp-color-bg)",
    color: "var(--lp-color-text)",
    fontFamily: "var(--lp-font-body)",
  };
}

// ---------------------------------------------------------------------------
// Tailwind-class helpers
// ---------------------------------------------------------------------------
//
// Block components occasionally need the spacing / radius scale as a Tailwind
// utility class (e.g. for `gap-` or `mb-`). These helpers translate the scale
// to the matching Tailwind token without forcing every block to repeat the
// switch statement.

/** Section vertical padding as a `py-…` Tailwind class. */
export function spacingPyClass(spacing: SpacingScale): string {
  switch (spacing) {
    case "compact":
      return "py-4";
    case "spacious":
      return "py-14";
    case "cozy":
    default:
      return "py-8";
  }
}

/** Section vertical gap (between stacked sub-elements) as a `gap-…` class. */
export function spacingGapClass(spacing: SpacingScale): string {
  switch (spacing) {
    case "compact":
      return "gap-3";
    case "spacious":
      return "gap-8";
    case "cozy":
    default:
      return "gap-5";
  }
}

/**
 * Outermost-container max-width per spacing scale — `cozy` is the default
 * SaaS landing-page width, `compact` packs tighter, `spacious` opens up.
 */
export function containerMaxWidthClass(spacing: SpacingScale): string {
  switch (spacing) {
    case "compact":
      return "max-w-2xl";
    case "spacious":
      return "max-w-4xl";
    case "cozy":
    default:
      return "max-w-3xl";
  }
}
