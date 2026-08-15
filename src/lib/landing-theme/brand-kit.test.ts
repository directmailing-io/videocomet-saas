import { describe, expect, it } from "vitest";

import {
  brandKitSchema,
  brandKitToTheme,
  themeToBrandKit,
  type BrandKit,
} from "@/lib/landing-theme/brand-kit";
import { contrastRatio, modeFromBackground } from "@/lib/landing-theme/derived-colors";
import { buildThemeCssVars } from "@/lib/landing-theme/css-vars";
import { extractThemeAndBrand } from "@/lib/landing-theme/extract";
import { matchFontToPair, FONT_PAIRS } from "@/lib/landing-theme/font-pairs";
import { getFontDef } from "@/lib/landing-theme/fonts";
import { DEFAULT_THEME, type ThemeConfig } from "@/lib/landing-theme/types";

describe("brandKitToTheme", () => {
  const lightKit: BrandKit = {
    colors: { primary: "#2563eb", bg: "light" },
    fontPairId: "playfair-source",
    radius: "round",
    shadow: "bold",
    logo: { url: "https://cdn.example.com/logo.svg" },
  };

  it("mappt ein helles Kit auf ThemeConfig + Brand", () => {
    const { theme, brand } = brandKitToTheme(lightKit);
    expect(theme.mode).toBe("light");
    expect(theme.colors.primary).toBe("#2563eb");
    expect(theme.colors.accent).toBe("#2563eb");
    expect(modeFromBackground(theme.colors.bg)).toBe("light");
    expect(theme.fonts).toEqual({
      heading: "Playfair Display",
      body: "Source Sans 3",
    });
    expect(theme.fontPairId).toBe("playfair-source");
    expect(theme.radiusScale).toBe("round");
    expect(theme.radius).toBe("pill");
    expect(theme.shadow).toBe("bold");
    expect(theme.preset).toBe("custom");
    expect(brand.logoUrl).toBe("https://cdn.example.com/logo.svg");
  });

  it("mappt Rundungen alt→neu über alle Stufen", () => {
    const radius = (r: BrandKit["radius"]): ThemeConfig["radius"] =>
      brandKitToTheme({ ...lightKit, radius: r }).theme.radius;
    expect(radius("none")).toBe("sharp");
    expect(radius("subtle")).toBe("rounded");
    expect(radius("soft")).toBe("rounded");
    expect(radius("round")).toBe("pill");
  });

  it("leitet bei bg dark komplette Dark-Flächen ab", () => {
    const { theme } = brandKitToTheme({
      ...lightKit,
      colors: { primary: "#a78bfa", bg: "dark" },
    });
    expect(theme.mode).toBe("dark");
    expect(modeFromBackground(theme.colors.bg)).toBe("dark");
    expect(contrastRatio(theme.colors.text, theme.colors.bg)).toBeGreaterThanOrEqual(7);
  });

  it("macht unlesbare Primärfarben auf hellem Grund nutzbar", () => {
    const { theme } = brandKitToTheme({
      ...lightKit,
      colors: { primary: "#facc15", bg: "light" },
    });
    expect(theme.colors.primary).not.toBe("#facc15");
    expect(
      contrastRatio(theme.colors.primary, theme.colors.bg),
    ).toBeGreaterThanOrEqual(3);
  });

  it("fällt bei unbekannter fontPairId auf Inter zurück", () => {
    const { theme } = brandKitToTheme({ ...lightKit, fontPairId: "gibt-es-nicht" });
    expect(theme.fontPairId).toBe("inter");
    expect(theme.fonts.heading).toBe("Inter");
  });
});

describe("themeToBrandKit", () => {
  it("Roundtrip Kit → Theme → Kit bleibt stabil", () => {
    const kit: BrandKit = {
      colors: { primary: "#2563eb", accent: "#f59e0b", bg: "light" },
      fontPairId: "grotesk-inter",
      radius: "subtle",
      shadow: "flat",
      logo: { url: "https://cdn.example.com/logo.png" },
    };
    const { theme, brand } = brandKitToTheme(kit);
    const back = themeToBrandKit(theme, brand);
    expect(back.colors.primary).toBe("#2563eb");
    expect(back.colors.accent).toBe("#f59e0b");
    expect(back.colors.bg).toBe("light");
    expect(back.fontPairId).toBe("grotesk-inter");
    expect(back.radius).toBe("subtle");
    expect(back.shadow).toBe("flat");
    expect(back.logo?.url).toBe("https://cdn.example.com/logo.png");
  });

  it("lässt einen ohne Akzent gebauten Roundtrip ohne Akzent", () => {
    const kit: BrandKit = {
      colors: { primary: "#2563eb", bg: "light" },
      fontPairId: "inter",
      radius: "soft",
      shadow: "soft",
    };
    const back = themeToBrandKit(brandKitToTheme(kit).theme);
    expect(back.colors.accent).toBeUndefined();
    expect(back.logo).toBeUndefined();
  });

  it("mappt Bestands-Themes ohne v3-Felder (radius alt→neu, Fonts best effort)", () => {
    const legacy: ThemeConfig = {
      ...DEFAULT_THEME,
      radius: "pill",
      colors: { ...DEFAULT_THEME.colors, bg: "#0a0a0a" },
      fonts: { heading: "Playfair Display", body: "Lato" },
    };
    const kit = themeToBrandKit(legacy);
    expect(kit.radius).toBe("round");
    expect(kit.shadow).toBe("soft");
    expect(kit.colors.bg).toBe("dark");
    // kein exaktes Paar (Playfair/Lato) → Heading-Match auf das Playfair-Paar
    expect(kit.fontPairId).toBe("playfair-source");
  });

  it("mappt sharp→none und rounded→soft", () => {
    expect(themeToBrandKit({ ...DEFAULT_THEME, radius: "sharp" }).radius).toBe("none");
    expect(themeToBrandKit({ ...DEFAULT_THEME, radius: "rounded" }).radius).toBe("soft");
  });
});

describe("brandKitSchema", () => {
  const valid = {
    colors: { primary: "#2563eb", bg: "light" },
    fontPairId: "inter",
    radius: "soft",
    shadow: "soft",
  };

  it("akzeptiert ein gültiges Kit", () => {
    expect(brandKitSchema.safeParse(valid).success).toBe(true);
  });

  it("akzeptiert Kurz-Hex und optionale Felder", () => {
    const result = brandKitSchema.safeParse({
      ...valid,
      colors: { primary: "#0af", accent: "#facc15", bg: "dark" },
      logo: { url: "https://cdn.example.com/logo.svg", height: 48 },
      sourceUrl: "https://example.com",
    });
    expect(result.success).toBe(true);
  });

  it("lehnt Nicht-Hex-Farben ab", () => {
    const result = brandKitSchema.safeParse({
      ...valid,
      colors: { primary: "blau", bg: "light" },
    });
    expect(result.success).toBe(false);
  });

  it("lehnt unbekannte radius/shadow-Werte ab", () => {
    expect(brandKitSchema.safeParse({ ...valid, radius: "pill" }).success).toBe(false);
    expect(brandKitSchema.safeParse({ ...valid, shadow: "hart" }).success).toBe(false);
  });
});

describe("extractThemeAndBrand (v3-Defaults)", () => {
  it("füllt v2-Content ohne neue Felder mit sinnvollen Defaults", () => {
    const { theme } = extractThemeAndBrand(
      { version: 2, theme: { radius: "pill" }, blocks: [] },
      null,
    );
    expect(theme.mode).toBe("light");
    expect(theme.radiusScale).toBe("round");
    expect(theme.shadow).toBe("soft");
    expect(theme.fontPairId).toBeUndefined();
  });

  it("erkennt dunkle Hintergründe als mode dark", () => {
    const { theme } = extractThemeAndBrand(
      { version: 2, theme: { colors: { bg: "#0a0a0a" } }, blocks: [] },
      null,
    );
    expect(theme.mode).toBe("dark");
  });

  it("behält explizit gespeicherte v3-Felder", () => {
    const { theme } = extractThemeAndBrand(
      {
        version: 2,
        theme: { mode: "dark", radiusScale: "subtle", shadow: "bold", fontPairId: "manrope" },
        blocks: [],
      },
      null,
    );
    expect(theme.mode).toBe("dark");
    expect(theme.radiusScale).toBe("subtle");
    expect(theme.shadow).toBe("bold");
    expect(theme.fontPairId).toBe("manrope");
  });

  it("leitet auch für Legacy-v1-Presets die neuen Felder ab", () => {
    const { theme } = extractThemeAndBrand({ headline: "Alt" }, "bold");
    expect(theme.mode).toBe("dark");
    expect(theme.radiusScale).toBe("round");
    expect(theme.shadow).toBe("soft");
  });
});

describe("buildThemeCssVars (v3-Tokens)", () => {
  it("setzt Radius-, Schatten- und abgeleitete Farb-Variablen", () => {
    const vars = buildThemeCssVars({ ...DEFAULT_THEME, radiusScale: "soft" });
    expect(vars["--lp-radius-card"]).toBe("16px");
    expect(vars["--lp-radius-button"]).toBe("12px");
    expect(vars["--lp-radius-input"]).toBe("10px");
    expect(vars["--lp-radius-image"]).toBe("14px");
    expect(vars["--lp-shadow-card"]).toContain("rgba");
    expect(vars["--lp-shadow-cta"]).toContain("rgba");
    expect(vars["--lp-color-on-primary"]).toBe("#ffffff");
    expect(vars["--lp-color-primary-soft"]).toMatch(/^#[0-9a-f]{6}$/);
    expect(vars["--lp-color-primary-hover"]).toMatch(/^#[0-9a-f]{6}$/);
    expect(vars["--lp-color-border"]).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("macht Buttons bei round zur Pille, --lp-radius bleibt gesetzt", () => {
    const vars = buildThemeCssVars({ ...DEFAULT_THEME, radiusScale: "round" });
    expect(vars["--lp-radius-button"]).toBe("9999px");
    expect(vars["--lp-radius"]).toBe("24px");
  });

  it("leitet die Skala für Bestands-Themes aus dem alten radius ab", () => {
    const vars = buildThemeCssVars({ ...DEFAULT_THEME, radius: "sharp" });
    expect(vars["--lp-radius"]).toBe("0px");
    expect(vars["--lp-radius-button"]).toBe("0px");
  });

  it("flat: keine Schatten; dark: eigene Schattenwerte", () => {
    const flat = buildThemeCssVars({ ...DEFAULT_THEME, shadow: "flat" });
    expect(flat["--lp-shadow-card"]).toBe("none");
    const light = buildThemeCssVars({ ...DEFAULT_THEME, shadow: "soft" });
    const dark = buildThemeCssVars({ ...DEFAULT_THEME, mode: "dark", shadow: "soft" });
    expect(dark["--lp-shadow-card"]).not.toBe(light["--lp-shadow-card"]);
  });
});

describe("Font-Paare", () => {
  it("es gibt genau 8 Paare, alle Familien existieren in fonts.ts", () => {
    expect(FONT_PAIRS).toHaveLength(8);
    for (const pair of FONT_PAIRS) {
      expect(getFontDef(pair.heading), pair.heading).toBeDefined();
      expect(getFontDef(pair.body), pair.body).toBeDefined();
      expect(pair.vibe.length).toBeGreaterThan(0);
    }
  });

  it("matchFontToPair: exakter Heading-Treffer", () => {
    expect(matchFontToPair("Space Grotesk")).toBe("grotesk-inter");
    expect(matchFontToPair('"Playfair Display", serif')).toBe("playfair-source");
  });

  it("matchFontToPair: Serif-Heuristik für fremde Serifen", () => {
    expect(matchFontToPair("Merriweather")).toBe("playfair-source");
    expect(matchFontToPair('"EB Garamond", Georgia, serif')).toBe("playfair-source");
  });

  it("matchFontToPair: sans-serif-Stacks landen nicht im Serif-Paar", () => {
    expect(matchFontToPair("sans-serif")).toBe("inter");
    expect(matchFontToPair('"Open Sans", sans-serif')).toBe("inter");
  });

  it("matchFontToPair: Unbekanntes → inter", () => {
    expect(matchFontToPair("Comic Sans MS")).toBe("inter");
    expect(matchFontToPair("")).toBe("inter");
  });
});
