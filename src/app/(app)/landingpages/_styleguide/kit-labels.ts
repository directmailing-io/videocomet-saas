/**
 * Deutsche UI-Labels + kuratierte Vorschläge für das Brand-Kit
 * (Einstiegs-Wizard + Styleguide-Panel). Reine Konstanten — server- und
 * client-safe.
 */

import type { BrandKit } from "@/lib/landing-theme/brand-kit";

export const RADIUS_LABELS: Record<BrandKit["radius"], string> = {
  none: "Eckig",
  subtle: "Dezent",
  soft: "Sanft",
  round: "Rund",
};

export const RADIUS_ORDER: BrandKit["radius"][] = [
  "none",
  "subtle",
  "soft",
  "round",
];

export const SHADOW_LABELS: Record<BrandKit["shadow"], string> = {
  flat: "Flach",
  soft: "Weich",
  bold: "Ausgeprägt",
};

export const SHADOW_ORDER: BrandKit["shadow"][] = ["flat", "soft", "bold"];

/** Button-Rundung je Stufe — gleiche Werte wie css-vars.ts (RADIUS_SCALE_PX). */
export const RADIUS_BUTTON_PX: Record<BrandKit["radius"], string> = {
  none: "0px",
  subtle: "8px",
  soft: "12px",
  round: "9999px",
};

/** Karten-Schatten je Stufe (Light-Mode) — gleiche Werte wie css-vars.ts. */
export const SHADOW_CARD_CSS: Record<BrandKit["shadow"], string> = {
  flat: "none",
  soft: "0 1px 2px rgba(15, 23, 42, 0.06), 0 8px 24px rgba(15, 23, 42, 0.08)",
  bold: "0 2px 4px rgba(15, 23, 42, 0.10), 0 18px 44px rgba(15, 23, 42, 0.18)",
};

/**
 * Acht kuratierte Primärfarben-Vorschläge (Konzept 3.4). Handverlesen:
 * kräftig genug für CTAs, alle auf Weiß lesbar (≥ 3:1).
 */
export const CURATED_PRIMARIES: Array<{ hex: string; label: string }> = [
  { hex: "#2563eb", label: "Blau" },
  { hex: "#7c3aed", label: "Violett" },
  { hex: "#0f766e", label: "Petrol" },
  { hex: "#16a34a", label: "Grün" },
  { hex: "#db2777", label: "Pink" },
  { hex: "#ea580c", label: "Orange" },
  { hex: "#b45309", label: "Bernstein" },
  { hex: "#0f172a", label: "Tinte" },
];

/**
 * Neutraler Start-Kit für den manuellen Weg (Weg B) — entspricht dem
 * „Clean"-Look: Blau, hell, Inter, sanfte Rundung, weicher Schatten.
 */
export function makeDefaultKit(): BrandKit {
  return {
    colors: { primary: "#2563eb", bg: "light" },
    fontPairId: "inter",
    radius: "soft",
    shadow: "soft",
  };
}
