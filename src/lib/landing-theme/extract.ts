import {
  DEFAULT_BRAND,
  DEFAULT_THEME,
  type BrandConfig,
  type ThemeConfig,
} from "@/lib/landing-theme/types";
import { themeFromPreset } from "@/lib/landing-theme/presets";

/**
 * Best-effort theme/brand extraction from the stored template JSON.
 *
 * The content column is JSONB and historically held v1 templates
 * (`{ headline, ctaText, … }`). v2 wraps that in
 * `{ version: 2, theme, brand, blocks, legacy }`. We accept both shapes:
 *   - v2 → use `theme` / `brand` directly (with defaults filling holes)
 *   - v1 → fall back to the stored `themeId` (preset) + default brand
 *
 * Tolerant of partial / hand-edited JSON: every missing key falls back
 * to the safe default so the page always renders something sensible.
 */
export function extractThemeAndBrand(
  templateContent: unknown,
  themeId: string | null | undefined,
): { theme: ThemeConfig; brand: BrandConfig } {
  if (templateContent && typeof templateContent === "object") {
    const root = templateContent as Record<string, unknown>;
    const version = root.version;
    if (version === 2 || version === "2") {
      const theme = mergeTheme(root.theme);
      const brand = mergeBrand(root.brand);
      return { theme, brand };
    }
  }
  // Legacy v1: only the column-level themeId is meaningful.
  return {
    theme: themeFromPreset(themeId as Parameters<typeof themeFromPreset>[0]),
    brand: { ...DEFAULT_BRAND },
  };
}

function mergeTheme(raw: unknown): ThemeConfig {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_THEME };
  const t = raw as Record<string, unknown>;
  const colors = (t.colors && typeof t.colors === "object"
    ? (t.colors as Record<string, unknown>)
    : {}) as Record<string, unknown>;
  const fonts = (t.fonts && typeof t.fonts === "object"
    ? (t.fonts as Record<string, unknown>)
    : {}) as Record<string, unknown>;
  const preset =
    typeof t.preset === "string"
      ? (t.preset as ThemeConfig["preset"])
      : DEFAULT_THEME.preset;
  return {
    preset,
    colors: {
      primary: pickStr(colors.primary, DEFAULT_THEME.colors.primary),
      accent: pickStr(colors.accent, DEFAULT_THEME.colors.accent),
      bg: pickStr(colors.bg, DEFAULT_THEME.colors.bg),
      surface: pickStr(colors.surface, DEFAULT_THEME.colors.surface),
      text: pickStr(colors.text, DEFAULT_THEME.colors.text),
      muted: pickStr(colors.muted, DEFAULT_THEME.colors.muted),
    },
    fonts: {
      heading: pickStr(fonts.heading, DEFAULT_THEME.fonts.heading),
      body: pickStr(fonts.body, DEFAULT_THEME.fonts.body),
    },
    spacing:
      t.spacing === "compact" || t.spacing === "spacious" || t.spacing === "cozy"
        ? t.spacing
        : DEFAULT_THEME.spacing,
    radius:
      t.radius === "sharp" || t.radius === "rounded" || t.radius === "pill"
        ? t.radius
        : DEFAULT_THEME.radius,
  };
}

function mergeBrand(raw: unknown): BrandConfig {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_BRAND };
  const b = raw as Record<string, unknown>;
  return {
    logoUrl:
      typeof b.logoUrl === "string" && b.logoUrl.length > 0
        ? b.logoUrl
        : null,
    logoAlign: b.logoAlign === "center" ? "center" : "left",
    showFooter:
      typeof b.showFooter === "boolean" ? b.showFooter : undefined,
    footerText: typeof b.footerText === "string" ? b.footerText : "",
  };
}

function pickStr(value: unknown, fallback: string): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}
