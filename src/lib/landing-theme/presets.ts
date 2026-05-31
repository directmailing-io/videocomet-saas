/**
 * Five hand-picked theme presets for the Landing-Page editor.
 *
 * The colour values here are the canonical reference; the editor seeds new
 * templates from one of these and then lets the user diverge field-by-field
 * (at which point `preset` flips to "custom").
 *
 * Adding/removing entries here changes the editor preset-picker — keep the
 * IDs stable (existing templates store the ID by name).
 */

import type { ThemeColors, ThemeConfig, ThemePresetId } from "./types";

export interface ThemePreset {
  id: Exclude<ThemePresetId, "custom">;
  label: string;
  description: string;
  /** Short hint about the typography pairing — shown in the picker tile. */
  fontHint: string;
  colors: ThemeColors;
  fonts: ThemeConfig["fonts"];
  spacing: ThemeConfig["spacing"];
  radius: ThemeConfig["radius"];
}

export const THEME_PRESETS: Record<
  Exclude<ThemePresetId, "custom">,
  ThemePreset
> = {
  noir: {
    id: "noir",
    label: "Noir",
    description: "Schlichter Look mit lila Akzent — sehr ruhig, sehr modern.",
    fontHint: "Inter · Inter",
    colors: {
      primary: "#0f0f17",
      accent: "#AA8CF5",
      bg: "#fafafa",
      surface: "#ffffff",
      text: "#0f0f17",
      muted: "#717171",
    },
    fonts: { heading: "Inter", body: "Inter" },
    spacing: "cozy",
    radius: "rounded",
  },

  clean: {
    id: "clean",
    label: "Clean",
    description: "Klassisches SaaS-Blau, hell, neutral — der sichere Start.",
    fontHint: "Inter · Inter",
    colors: {
      primary: "#2563eb",
      accent: "#3b82f6",
      bg: "#ffffff",
      surface: "#f8fafc",
      text: "#0f172a",
      muted: "#64748b",
    },
    fonts: { heading: "Inter", body: "Inter" },
    spacing: "cozy",
    radius: "rounded",
  },

  warm: {
    id: "warm",
    label: "Warm",
    description: "Sand- und Bernsteintöne, einladend — für Coaches & Lifestyle.",
    fontHint: "Playfair Display · Lato",
    colors: {
      primary: "#dc2626",
      accent: "#f59e0b",
      bg: "#fef3c7",
      surface: "#fffbeb",
      text: "#451a03",
      muted: "#92400e",
    },
    fonts: { heading: "Playfair Display", body: "Lato" },
    spacing: "spacious",
    radius: "rounded",
  },

  bold: {
    id: "bold",
    label: "Bold",
    description: "Dunkel, kontrastreich, Magenta-Akzent — für Auftritte mit Wumms.",
    fontHint: "Space Grotesk · DM Sans",
    colors: {
      primary: "#7c3aed",
      accent: "#ec4899",
      bg: "#0a0a0a",
      surface: "#171717",
      text: "#fafafa",
      muted: "#a3a3a3",
    },
    fonts: { heading: "Space Grotesk", body: "DM Sans" },
    spacing: "spacious",
    radius: "pill",
  },

  editorial: {
    id: "editorial",
    label: "Editorial",
    description: "Magazinhaft, ruhig, seriös — Serif-Headline, weite Räume.",
    fontHint: "Cormorant Garamond · Source Sans 3",
    colors: {
      primary: "#1e293b",
      accent: "#475569",
      bg: "#fafaf9",
      surface: "#ffffff",
      text: "#1c1917",
      muted: "#78716c",
    },
    fonts: { heading: "Cormorant Garamond", body: "Source Sans 3" },
    spacing: "spacious",
    radius: "sharp",
  },
};

/** Ordered list — used by the editor for the preset picker. */
export const THEME_PRESET_ORDER: Array<Exclude<ThemePresetId, "custom">> = [
  "noir",
  "clean",
  "warm",
  "bold",
  "editorial",
];

/**
 * Resolve a preset ID to a full `ThemeConfig`. Returns the "clean" preset
 * if the ID is unknown (defensive — JSON could be hand-edited).
 */
export function themeFromPreset(id: ThemePresetId | null | undefined): ThemeConfig {
  if (id && id !== "custom" && id in THEME_PRESETS) {
    const p = THEME_PRESETS[id];
    return {
      preset: p.id,
      colors: { ...p.colors },
      fonts: { ...p.fonts },
      spacing: p.spacing,
      radius: p.radius,
    };
  }
  const clean = THEME_PRESETS.clean;
  return {
    preset: "clean",
    colors: { ...clean.colors },
    fonts: { ...clean.fonts },
    spacing: clean.spacing,
    radius: clean.radius,
  };
}
