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
import type {
  RadiusScale,
  SpacingScale,
  ThemeConfig,
} from "./types";

/** Section vertical padding (top + bottom) per spacing scale. */
const SPACING_PX: Record<SpacingScale, string> = {
  compact: "16px",
  cozy: "32px",
  spacious: "56px",
};

/** Corner-radius per radius scale. `pill` uses 999px so circular buttons "just work". */
const RADIUS_PX: Record<RadiusScale, string> = {
  sharp: "0px",
  rounded: "12px",
  pill: "999px",
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
  return {
    "--lp-color-primary": theme.colors.primary,
    "--lp-color-accent": theme.colors.accent,
    "--lp-color-bg": theme.colors.bg,
    "--lp-color-surface": theme.colors.surface,
    "--lp-color-text": theme.colors.text,
    "--lp-color-muted": theme.colors.muted,
    "--lp-font-heading": buildFontFamilyValue(theme.fonts.heading),
    "--lp-font-body": buildFontFamilyValue(theme.fonts.body),
    "--lp-radius": RADIUS_PX[theme.radius],
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
