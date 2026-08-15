/**
 * BrandKit — das kompakte Styleguide-Datenmodell aus Konzept v3 (3.5).
 *
 * Das Kit ist die Wahrheit, die der User sieht (Brand-Erkennung +
 * Styleguide-Panel); `ThemeConfig` bleibt die Wahrheit, die der Renderer
 * konsumiert. Dieses Modul übersetzt verlustarm in beide Richtungen:
 *
 *   BrandKit --brandKitToTheme--> { theme, brand }   (Renderer-Seite)
 *   ThemeConfig --themeToBrandKit--> BrandKit        (Bestand einlesen)
 */

import { z } from "zod";

import {
  LEGACY_RADIUS_TO_SCALE,
  type BrandConfig,
  type RadiusScale,
  type RadiusScaleV3,
  type ShadowScale,
  type ThemeColors,
  type ThemeConfig,
  type ThemeMode,
} from "./types";
import {
  deriveDarkColors,
  derivedSurfaces,
  ensureReadablePrimary,
  modeFromBackground,
} from "./derived-colors";
import {
  DEFAULT_FONT_PAIR_ID,
  findPairByFonts,
  getFontPair,
  matchFontToPair,
} from "./font-pairs";

export interface BrandKit {
  logo?: { url: string; height?: number };
  colors: { primary: string; accent?: string; bg: "light" | "dark" };
  fontPairId: string;
  radius: "none" | "subtle" | "soft" | "round";
  shadow: "flat" | "soft" | "bold";
  /** Woher extrahiert — für „Neu einlesen" im Styleguide. */
  sourceUrl?: string;
}

// ---------------------------------------------------------------------------
// Zod-Schema für die API-Validierung (POST /api/brand/extract etc.)
// ---------------------------------------------------------------------------

const HEX_COLOR_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const HEX_MESSAGE = "Bitte eine Hex-Farbe angeben, z. B. #2563eb";

export const brandKitSchema = z.object({
  logo: z
    .object({
      url: z.url("Bitte eine gültige Logo-URL angeben"),
      height: z.number().min(12).max(240).optional(),
    })
    .optional(),
  colors: z.object({
    primary: z.string().regex(HEX_COLOR_RE, HEX_MESSAGE),
    accent: z.string().regex(HEX_COLOR_RE, HEX_MESSAGE).optional(),
    bg: z.enum(["light", "dark"]),
  }),
  fontPairId: z.string().min(1),
  radius: z.enum(["none", "subtle", "soft", "round"]),
  shadow: z.enum(["flat", "soft", "bold"]),
  sourceUrl: z.url().optional(),
});

export type BrandKitInput = z.infer<typeof brandKitSchema>;

// ---------------------------------------------------------------------------
// BrandKit → ThemeConfig
// ---------------------------------------------------------------------------

/**
 * Rück-Mapping neue → alte Radius-Skala. "subtle" UND "soft" landen auf
 * "rounded" — die alte Skala hat schlicht weniger Stufen; alte Blöcke
 * lesen ohnehin nur noch die Card-Rundung.
 */
const SCALE_TO_LEGACY_RADIUS: Record<RadiusScaleV3, RadiusScale> = {
  none: "sharp",
  subtle: "rounded",
  soft: "rounded",
  round: "pill",
};

/**
 * Übersetzt ein BrandKit in das Renderer-Theme. Die Primärfarbe wird
 * dabei auf Lesbarkeit gegen den (abgeleiteten) Seitenhintergrund
 * geprüft und ggf. angepasst (Konzept 3.2) — die Original-Markenfarbe
 * bleibt im Kit erhalten.
 */
export function brandKitToTheme(kit: BrandKit): {
  theme: ThemeConfig;
  brand: Partial<BrandConfig>;
} {
  const mode: ThemeMode = kit.colors.bg === "dark" ? "dark" : "light";
  const surfaces = derivedSurfaces(mode);
  const { usable } = ensureReadablePrimary(kit.colors.primary, surfaces.bg);

  const colors: ThemeColors =
    mode === "dark"
      ? deriveDarkColors(usable, kit.colors.accent)
      : {
          primary: usable,
          accent: kit.colors.accent ?? usable,
          ...surfaces,
        };

  const pair =
    getFontPair(kit.fontPairId) ?? getFontPair(DEFAULT_FONT_PAIR_ID)!;

  const theme: ThemeConfig = {
    preset: "custom",
    colors,
    fonts: { heading: pair.heading, body: pair.body },
    spacing: "cozy",
    radius: SCALE_TO_LEGACY_RADIUS[kit.radius],
    mode,
    radiusScale: kit.radius,
    shadow: kit.shadow,
    fontPairId: pair.id,
  };

  const brand: Partial<BrandConfig> = {};
  if (kit.logo?.url) brand.logoUrl = kit.logo.url;

  return { theme, brand };
}

// ---------------------------------------------------------------------------
// ThemeConfig → BrandKit (best effort, für bestehende Vorlagen)
// ---------------------------------------------------------------------------

export function themeToBrandKit(
  theme: ThemeConfig,
  brand?: Partial<BrandConfig> | null,
): BrandKit {
  const mode: ThemeMode = theme.mode ?? modeFromBackground(theme.colors.bg);
  const radius: RadiusScaleV3 =
    theme.radiusScale ?? LEGACY_RADIUS_TO_SCALE[theme.radius];
  const shadow: ShadowScale = theme.shadow ?? "soft";

  const fontPairId =
    (theme.fontPairId && getFontPair(theme.fontPairId)?.id) ||
    findPairByFonts(theme.fonts.heading, theme.fonts.body)?.id ||
    matchFontToPair(theme.fonts.heading);

  const kit: BrandKit = {
    colors: { primary: theme.colors.primary, bg: mode },
    fontPairId,
    radius,
    shadow,
  };
  // Akzent nur mitnehmen, wenn er eine eigene Information trägt —
  // sonst wäre der Roundtrip (accent weggelassen → primary) nicht stabil.
  if (theme.colors.accent && theme.colors.accent !== theme.colors.primary) {
    kit.colors.accent = theme.colors.accent;
  }
  if (brand?.logoUrl) kit.logo = { url: brand.logoUrl };

  return kit;
}
