/**
 * Automatisch abgeleitete Farben für das Token-System (Landingpage v3).
 *
 * Sektionen kennen nur Farb-Rollen — alles, was sich aus Primärfarbe,
 * Hintergrund und Modus ableiten lässt (Text-auf-Farbe, Soft-Ton, Hover,
 * Linien), wird hier berechnet statt vom User eingestellt. Reine
 * Funktionen, hex rein / hex raus, keine Dependencies.
 *
 * Nicht-parsebare Eingaben (z. B. `hsl(...)`, benannte Farben) führen nie
 * zu Fehlern — jede Funktion hat einen dokumentierten, sicheren Fallback,
 * weil die Theme-JSON hand-editiert sein kann.
 */

import type { ThemeColors, ThemeMode } from "./types";

interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** h: 0–360, s/l: 0–100 */
interface Hsl {
  h: number;
  s: number;
  l: number;
}

// ---------------------------------------------------------------------------
// Hex / HSL Helfer
// ---------------------------------------------------------------------------

const HEX_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

function parseHex(value: string): Rgb | null {
  const hex = value.trim();
  if (!HEX_RE.test(hex)) return null;
  const body = hex.slice(1);
  if (body.length === 3) {
    return {
      r: parseInt(body[0] + body[0], 16),
      g: parseInt(body[1] + body[1], 16),
      b: parseInt(body[2] + body[2], 16),
    };
  }
  return {
    r: parseInt(body.slice(0, 2), 16),
    g: parseInt(body.slice(2, 4), 16),
    b: parseInt(body.slice(4, 6), 16),
  };
}

function toHex(rgb: Rgb): string {
  const channel = (v: number): string => {
    const clamped = Math.max(0, Math.min(255, Math.round(v)));
    return clamped.toString(16).padStart(2, "0");
  };
  return `#${channel(rgb.r)}${channel(rgb.g)}${channel(rgb.b)}`;
}

function rgbToHsl(rgb: Rgb): Hsl {
  const r = rgb.r / 255;
  const g = rgb.g / 255;
  const b = rgb.b / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l: l * 100 };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return { h: h * 60, s: s * 100, l: l * 100 };
}

function hslToRgb(hsl: Hsl): Rgb {
  const s = Math.max(0, Math.min(100, hsl.s)) / 100;
  const l = Math.max(0, Math.min(100, hsl.l)) / 100;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = (((hsl.h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r1 = 0;
  let g1 = 0;
  let b1 = 0;
  if (hp < 1) {
    r1 = c;
    g1 = x;
  } else if (hp < 2) {
    r1 = x;
    g1 = c;
  } else if (hp < 3) {
    g1 = c;
    b1 = x;
  } else if (hp < 4) {
    g1 = x;
    b1 = c;
  } else if (hp < 5) {
    r1 = x;
    b1 = c;
  } else {
    r1 = c;
    b1 = x;
  }
  const m = l - c / 2;
  return {
    r: (r1 + m) * 255,
    g: (g1 + m) * 255,
    b: (b1 + m) * 255,
  };
}

// ---------------------------------------------------------------------------
// WCAG-Luminanz + Kontrast
// ---------------------------------------------------------------------------

/**
 * Relative Luminanz nach WCAG 2.x — mit echter sRGB-Linearisierung
 * (Gamma-Kurve), NICHT die simple 0.2126*r+…-auf-255-Näherung. Nur die
 * echte Formel liefert bei Gelbtönen die korrekte "dunkler Text"-Antwort.
 */
function relativeLuminance(rgb: Rgb): number {
  const linear = (v: number): number => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return (
    0.2126 * linear(rgb.r) + 0.7152 * linear(rgb.g) + 0.0722 * linear(rgb.b)
  );
}

/**
 * WCAG-Kontrastverhältnis zweier Hex-Farben (1–21). Nicht parsebare
 * Eingaben ergeben 1 (schlechtester Wert), damit Aufrufer defensiv bleiben.
 */
export function contrastRatio(hexA: string, hexB: string): number {
  const a = parseHex(hexA);
  const b = parseHex(hexB);
  if (!a || !b) return 1;
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}

// ---------------------------------------------------------------------------
// Abgeleitete Farben
// ---------------------------------------------------------------------------

/** Fast-Schwarz für Text auf hellen Flächen — reines #000 wirkt hart. */
const INK = "#111111";
const WHITE = "#ffffff";

/**
 * Textfarbe auf einer gegebenen Fläche: weiß oder fast-schwarz — je nachdem,
 * was den höheren WCAG-Kontrast erreicht (Ziel ≥ 4.5:1). Fallback bei
 * nicht parsebarer Eingabe: weiß (sicher für kräftige Markenfarben).
 */
export function onColor(hex: string): string {
  const rgb = parseHex(hex);
  if (!rgb) return WHITE;
  const lum = relativeLuminance(rgb);
  const contrastWhite = 1.05 / (lum + 0.05);
  const contrastInk = (lum + 0.05) / (relativeLuminance(parseHex(INK)!) + 0.05);
  return contrastWhite >= contrastInk ? WHITE : INK;
}

/**
 * Sehr helle (light) bzw. sehr dunkle (dark) Tönung der Primärfarbe —
 * für Flächen hinter Icons, Badges, Soft-Sektionen. Die Sättigung wird
 * gedeckelt, damit Neonfarben keine grellen Flächen erzeugen.
 * Fallback: neutrales Slate-Hell/Dunkel.
 */
export function softTone(primary: string, mode: ThemeMode): string {
  const rgb = parseHex(primary);
  if (!rgb) return mode === "dark" ? "#1e2530" : "#f1f5f9";
  const hsl = rgbToHsl(rgb);
  if (mode === "dark") {
    return toHex(hslToRgb({ h: hsl.h, s: Math.min(hsl.s, 40), l: 15 }));
  }
  return toHex(hslToRgb({ h: hsl.h, s: Math.min(hsl.s, 65), l: 96 }));
}

/**
 * Hover-Variante der Primärfarbe: light → leicht abgedunkelt,
 * dark → leicht aufgehellt. Fallback: Eingabe unverändert.
 */
export function hoverTone(primary: string, mode: ThemeMode): string {
  const rgb = parseHex(primary);
  if (!rgb) return primary;
  const hsl = rgbToHsl(rgb);
  const l =
    mode === "dark" ? Math.min(hsl.l + 8, 100) : Math.max(hsl.l - 8, 0);
  return toHex(hslToRgb({ h: hsl.h, s: hsl.s, l }));
}

/**
 * Dezente Linienfarbe aus dem Seitenhintergrund abgeleitet — hell:
 * etwas dunkler als bg, dunkel: etwas heller. Fallback: neutrale
 * Slate-Linien passend zum Modus.
 */
export function borderTone(bg: string, mode: ThemeMode): string {
  const rgb = parseHex(bg);
  if (!rgb) return mode === "dark" ? "#2a2e37" : "#e2e8f0";
  const hsl = rgbToHsl(rgb);
  if (mode === "dark") {
    return toHex(hslToRgb({ h: hsl.h, s: hsl.s, l: Math.min(hsl.l + 10, 100) }));
  }
  return toHex(hslToRgb({ h: hsl.h, s: hsl.s, l: Math.max(hsl.l - 10, 0) }));
}

/**
 * Hell/Dunkel-Erkennung eines Hintergrunds über die WCAG-Luminanz.
 * Schwelle 0.179 = der Punkt, an dem weißer und schwarzer Text gleich
 * viel Kontrast hätten — darunter ist die Fläche "dunkel".
 * Fallback bei nicht parsebarer Eingabe: "light".
 */
export function modeFromBackground(bg: string): ThemeMode {
  const rgb = parseHex(bg);
  if (!rgb) return "light";
  return relativeLuminance(rgb) < 0.179 ? "dark" : "light";
}

/**
 * Neutrale Flächen-/Textfarben je Modus. Dark ist kein invertiertes Light,
 * sondern ein eigener abgestimmter Satz (bg fast-schwarz mit leichtem
 * Blaustich, surface eine Stufe heller, muted gedämpft).
 */
export function derivedSurfaces(
  mode: ThemeMode,
): Pick<ThemeColors, "bg" | "surface" | "text" | "muted"> {
  if (mode === "dark") {
    return {
      bg: "#0b0c10",
      surface: "#15171c",
      text: "#f4f5f7",
      muted: "#9ba1ad",
    };
  }
  return {
    bg: "#ffffff",
    surface: "#f8fafc",
    text: "#0f172a",
    muted: "#64748b",
  };
}

/**
 * Kompletter `ThemeColors`-Satz für dunkle Seiten aus Primär- (und optional
 * Akzent-)Farbe. Die Lesbarkeit der Primärfarbe auf dunklem Grund stellt
 * der Aufrufer über `ensureReadablePrimary` sicher — diese Funktion bleibt
 * ein reines Mapping.
 */
export function deriveDarkColors(
  primary: string,
  accent?: string,
): ThemeColors {
  return {
    primary,
    accent: accent ?? primary,
    ...derivedSurfaces("dark"),
  };
}

/**
 * Stellt sicher, dass die Primärfarbe auf dem gegebenen Hintergrund
 * mindestens 3:1 Kontrast erreicht (WCAG-Grenze für großflächige
 * UI-Elemente wie Buttons, vgl. Konzept 3.2). Auf hellem Grund wird
 * schrittweise abgedunkelt, auf dunklem aufgehellt. Wir geben beides
 * zurück, damit die Original-Markenfarbe erhalten bleibt („Neu einlesen").
 */
export function ensureReadablePrimary(
  primary: string,
  bg: string,
): { usable: string; original: string } {
  const primaryRgb = parseHex(primary);
  const bgRgb = parseHex(bg);
  if (!primaryRgb || !bgRgb) return { usable: primary, original: primary };

  if (contrastRatio(primary, bg) >= 3) {
    return { usable: primary, original: primary };
  }

  const darkenOnLight = relativeLuminance(bgRgb) >= 0.179;
  const hsl = rgbToHsl(primaryRgb);
  let usable = primary;
  // 4 %-Schritte: fein genug, um den Farbton zu erhalten, grob genug,
  // um in wenigen Iterationen die 3:1-Grenze zu erreichen.
  for (let i = 0; i < 25; i++) {
    hsl.l = darkenOnLight ? Math.max(hsl.l - 4, 0) : Math.min(hsl.l + 4, 100);
    usable = toHex(hslToRgb(hsl));
    if (contrastRatio(usable, bg) >= 3) break;
    if (hsl.l === 0 || hsl.l === 100) break;
  }
  return { usable, original: primary };
}
