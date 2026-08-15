/**
 * Brand-Extraktion — reine Auswertungs-Logik (Konzept v3, 3.1/3.2).
 *
 * Der Worker sammelt mit Puppeteer ein Roh-JSON von der Kunden-Website
 * (`RawExtraction`, siehe src/worker/lib/brand-extract.ts) — dieses Modul
 * macht daraus ein BrandKit + sortierte Logo-Kandidaten. Bewusst OHNE
 * Puppeteer-/Node-Abhängigkeiten, damit vitest die Heuristiken direkt
 * testen kann (analyze.test.ts).
 */

import type { BrandKit } from "@/lib/landing-theme/brand-kit";
import {
  contrastRatio,
  ensureReadablePrimary,
  modeFromBackground,
} from "@/lib/landing-theme/derived-colors";
import { matchFontToPair } from "@/lib/landing-theme/font-pairs";

// ---------------------------------------------------------------------------
// Roh-Datentypen (kommen 1:1 aus page.evaluate)
// ---------------------------------------------------------------------------

export type LogoKind = "svg" | "header-img" | "og" | "icon";

export interface RawButtonStyle {
  backgroundColor: string;
  color: string;
  borderRadius: string;
  boxShadow: string;
}

export interface RawLogoCandidate {
  url: string;
  width?: number;
  height?: number;
  kind: LogoKind;
}

export interface RawExtraction {
  /** Computed styles aller Button-artigen Elemente (max. 200). */
  buttons: RawButtonStyle[];
  /** backgroundColor von body + großen Sections/Containern. */
  backgrounds: string[];
  /** Computed fontFamily der ersten h1 (bzw. h2). Leer wenn keine da. */
  headingFontFamily: string;
  /** Computed fontFamily des ersten p. Leer wenn keiner da. */
  bodyFontFamily: string;
  /** Ungefilterte Logo-Kandidaten mit absoluten URLs. */
  logoCandidates: RawLogoCandidate[];
  /** Länge des sichtbaren Body-Texts — für Leere-Seite-Erkennung. */
  textLength: number;
}

export interface BrandAnalysis {
  /** BrandKit ohne Logo (das wählt der User aus den Kandidaten). */
  kit: BrandKit;
  /** Dedupliziert, sortiert, max. 6. */
  logoCandidates: RawLogoCandidate[];
}

// ---------------------------------------------------------------------------
// Farb-Parsing: rgb()/rgba()/hex → hex
// ---------------------------------------------------------------------------

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

const HEX_RE = /^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

// Chromium liefert computed colors klassisch als "rgb(r, g, b)" bzw.
// "rgba(r, g, b, a)" — wir akzeptieren zusätzlich die moderne
// Space-Syntax "rgb(r g b / a)", falls sie doch mal durchkommt.
const RGB_RE =
  /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/;

/** Werte, die niemals eine echte Farbe sind. */
const NON_COLORS = new Set([
  "",
  "none",
  "transparent",
  "inherit",
  "initial",
  "unset",
  "currentcolor",
]);

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

/**
 * Parst einen CSS-Farbwert (computed style) zu `#rrggbb`.
 *
 * `null` bei: transparent/inherit/none, nicht parsebaren Werten und
 * (halb-)transparenten Farben mit alpha < 0.5 — eine Fläche, die zur
 * Hälfte durchscheint, sagt nichts Verlässliches über die Markenfarbe.
 */
export function parseCssColor(value: string): string | null {
  const v = value.trim().toLowerCase();
  if (NON_COLORS.has(v)) return null;

  if (HEX_RE.test(v)) {
    const body = v.slice(1);
    if (body.length === 4 || body.length === 8) {
      // Alpha-Hex: letzte 1–2 Stellen sind der Alpha-Kanal.
      const alphaHex = body.length === 4 ? body.slice(3) + body.slice(3) : body.slice(6);
      if (parseInt(alphaHex, 16) / 255 < 0.5) return null;
    }
    const rgbBody = body.length <= 4 ? body.slice(0, 3) : body.slice(0, 6);
    if (rgbBody.length === 3) {
      return toHex({
        r: parseInt(rgbBody[0] + rgbBody[0], 16),
        g: parseInt(rgbBody[1] + rgbBody[1], 16),
        b: parseInt(rgbBody[2] + rgbBody[2], 16),
      });
    }
    return toHex({
      r: parseInt(rgbBody.slice(0, 2), 16),
      g: parseInt(rgbBody.slice(2, 4), 16),
      b: parseInt(rgbBody.slice(4, 6), 16),
    });
  }

  const m = RGB_RE.exec(v);
  if (!m) return null;
  if (m[4] !== undefined) {
    const alpha = m[4].endsWith("%")
      ? parseFloat(m[4]) / 100
      : parseFloat(m[4]);
    if (!Number.isFinite(alpha) || alpha < 0.5) return null;
  }
  const r = parseFloat(m[1]);
  const g = parseFloat(m[2]);
  const b = parseFloat(m[3]);
  if (![r, g, b].every((n) => Number.isFinite(n) && n <= 255)) return null;
  return toHex({ r, g, b });
}

// ---------------------------------------------------------------------------
// Primär-/Akzentfarbe: Clustering über HSL-Buckets
// ---------------------------------------------------------------------------

/** Sättigungs-Grenze: darunter gilt eine Farbe als Grau/Weiß/Schwarz. */
const MIN_SATURATION = 12;
/** Fast-Weiß/Fast-Schwarz zusätzlich raus — auch wenn leicht gesättigt. */
const MIN_LIGHTNESS = 8;
const MAX_LIGHTNESS = 92;
/** Hue-Bucket-Breite in Grad ("Runden auf HSL-Buckets"). */
const HUE_BUCKET_DEG = 30;
/** Mindest-Hue-Abstand Primär ↔ Akzent. */
const MIN_ACCENT_HUE_DISTANCE = 30;
/** Ein Akzent muss mindestens 2× vorkommen — sonst ist es Rauschen. */
const MIN_ACCENT_COUNT = 2;

function parseHexToHsl(hex: string): Hsl {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return rgbToHsl({ r, g, b });
}

/** Zirkulärer Hue-Abstand in Grad (0–180). */
function hueDistance(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

interface HueBucket {
  count: number;
  /** Exakte hex-Häufigkeiten innerhalb des Buckets. */
  byHex: Map<string, number>;
  /** Hue des häufigsten Vertreters (für den Akzent-Abstand). */
  hue: number;
}

/**
 * Wählt aus geparsten (!) CSS-Farbwerten die Primär- und Akzentfarbe:
 *
 *  1. Grau-/Weiß-/Schwarztöne raus (Sättigung < 12 % oder extreme Helligkeit).
 *  2. Rest in 30°-Hue-Buckets clustern; häufigster Bucket gewinnt,
 *     Primärfarbe = häufigster exakter Hex-Wert darin.
 *  3. Akzent = häufigster anderer Bucket mit Hue-Abstand > 30° und
 *     mindestens 2 Vorkommen — sonst kein Akzent.
 */
export function pickBrandColors(cssValues: string[]): {
  primary: string | null;
  accent: string | null;
} {
  const buckets = new Map<number, HueBucket>();

  for (const value of cssValues) {
    const hex = parseCssColor(value);
    if (!hex) continue;
    const hsl = parseHexToHsl(hex);
    if (hsl.s < MIN_SATURATION) continue;
    if (hsl.l < MIN_LIGHTNESS || hsl.l > MAX_LIGHTNESS) continue;

    const key = Math.round(hsl.h / HUE_BUCKET_DEG) % (360 / HUE_BUCKET_DEG);
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { count: 0, byHex: new Map(), hue: hsl.h };
      buckets.set(key, bucket);
    }
    bucket.count += 1;
    bucket.byHex.set(hex, (bucket.byHex.get(hex) ?? 0) + 1);
  }

  const sorted = Array.from(buckets.values()).sort((a, b) => b.count - a.count);
  const winner = sorted[0];
  if (!winner) return { primary: null, accent: null };

  const primary = mostFrequentHex(winner.byHex);
  const primaryHue = parseHexToHsl(primary).h;

  for (let i = 1; i < sorted.length; i++) {
    const candidate = sorted[i];
    if (candidate.count < MIN_ACCENT_COUNT) continue;
    const accentHex = mostFrequentHex(candidate.byHex);
    if (hueDistance(parseHexToHsl(accentHex).h, primaryHue) > MIN_ACCENT_HUE_DISTANCE) {
      return { primary, accent: accentHex };
    }
  }
  return { primary, accent: null };
}

function mostFrequentHex(byHex: Map<string, number>): string {
  let best = "";
  let bestCount = -1;
  byHex.forEach((count, hex) => {
    if (count > bestCount) {
      best = hex;
      bestCount = count;
    }
  });
  return best;
}

// ---------------------------------------------------------------------------
// Rundungen: borderRadius-Median → 4 Stufen
// ---------------------------------------------------------------------------

/** Prozent-Radien (50 %) und 999er-Pillen zählen als "maximal rund". */
const PILL_SENTINEL = 9999;

function parseRadiusPx(value: string): number | null {
  const first = value.trim().split(/\s+/)[0] ?? "";
  if (first.length === 0) return null;
  if (first.endsWith("%")) {
    const pct = parseFloat(first);
    return Number.isFinite(pct) && pct > 0 ? PILL_SENTINEL : 0;
  }
  const px = parseFloat(first);
  if (!Number.isFinite(px)) return null;
  return Math.max(0, px);
}

function median(values: number[]): number {
  const s = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * Mappt die borderRadius-Werte der Buttons (Median) auf unsere Stufen:
 * < 3 px → none, < 10 px → subtle, < 18 px → soft, sonst → round.
 * Keine parsebaren Werte → "subtle" (neutraler Default).
 */
export function mapRadius(values: string[]): BrandKit["radius"] {
  const parsed: number[] = [];
  for (const v of values) {
    const px = parseRadiusPx(v);
    if (px !== null) parsed.push(px);
  }
  if (parsed.length === 0) return "subtle";
  const med = median(parsed);
  if (med < 3) return "none";
  if (med < 10) return "subtle";
  if (med < 18) return "soft";
  return "round";
}

// ---------------------------------------------------------------------------
// Schatten: Anteil + Blur-Intensität → 3 Stufen
// ---------------------------------------------------------------------------

/**
 * Blur-Radius (3. Länge) des ersten Schattens aus einem computed
 * `box-shadow`-Wert, z. B. "rgba(0, 0, 0, 0.1) 0px 4px 12px 0px".
 * Farbanteile werden vor dem Zahlen-Match entfernt.
 */
function parseBlurPx(boxShadow: string): number {
  const withoutColors = boxShadow
    .replace(/rgba?\([^)]*\)/gi, "")
    .replace(/#[0-9a-fA-F]{3,8}/g, "");
  const firstShadow = withoutColors.split(",")[0] ?? "";
  const lengths = firstShadow.match(/-?[\d.]+px/g);
  if (!lengths || lengths.length < 3) return 0;
  return Math.abs(parseFloat(lengths[2]));
}

/** Ab diesem Median-Blur gilt ein flächendeckender Schatten als "bold". */
const BOLD_BLUR_PX = 12;

/**
 * Anteil der Elemente mit box-shadow ≠ none:
 * < 10 % → flat, < 45 % → soft, sonst bold — es sei denn, die Schatten
 * sind durchweg dezent (Median-Blur < 12 px), dann bleibt es soft.
 * Ohne Elemente → "soft" (neutraler Default).
 */
export function mapShadow(boxShadows: string[]): BrandKit["shadow"] {
  if (boxShadows.length === 0) return "soft";
  const withShadow = boxShadows.filter(
    (s) => s.trim().length > 0 && s.trim().toLowerCase() !== "none",
  );
  const share = withShadow.length / boxShadows.length;
  if (share < 0.1) return "flat";
  if (share < 0.45) return "soft";
  const blurs = withShadow.map(parseBlurPx);
  return median(blurs) >= BOLD_BLUR_PX ? "bold" : "soft";
}

// ---------------------------------------------------------------------------
// Hintergrund: hell/dunkel + dominanter Farbwert
// ---------------------------------------------------------------------------

/**
 * Hell/Dunkel-Erkennung über Body-/Section-Hintergründe: jeder parsebare
 * Wert stimmt per `modeFromBackground` ab, die Mehrheit gewinnt.
 * Keine parsebaren Werte oder Gleichstand → "light" (Browser-Default).
 */
export function detectBgMode(backgrounds: string[]): "light" | "dark" {
  let dark = 0;
  let light = 0;
  for (const bg of backgrounds) {
    const hex = parseCssColor(bg);
    if (!hex) continue;
    if (modeFromBackground(hex) === "dark") dark += 1;
    else light += 1;
  }
  return dark > light ? "dark" : "light";
}

/** Häufigster parsebarer Hintergrund-Hex — oder null. */
export function dominantBackground(backgrounds: string[]): string | null {
  const counts = new Map<string, number>();
  for (const bg of backgrounds) {
    const hex = parseCssColor(bg);
    if (!hex) continue;
    counts.set(hex, (counts.get(hex) ?? 0) + 1);
  }
  if (counts.size === 0) return null;
  return mostFrequentHex(counts);
}

// ---------------------------------------------------------------------------
// Logo-Kandidaten: Dedupe + Sortierung
// ---------------------------------------------------------------------------

const KIND_RANK: Record<LogoKind, number> = {
  svg: 0,
  "header-img": 1,
  og: 2,
  icon: 3,
};

const MAX_LOGO_CANDIDATES = 6;

/**
 * Dedupliziert (per URL, bester kind-Rang gewinnt) und sortiert:
 * svg/header-img vor og vor icon; innerhalb eines Kinds größere Bilder
 * zuerst (Kandidaten ohne Maße ans Ende). Max. 6 Ergebnisse.
 */
export function sortLogoCandidates(
  candidates: RawLogoCandidate[],
): RawLogoCandidate[] {
  const byUrl = new Map<string, RawLogoCandidate>();
  for (const c of candidates) {
    if (!c.url) continue;
    const existing = byUrl.get(c.url);
    if (!existing || KIND_RANK[c.kind] < KIND_RANK[existing.kind]) {
      byUrl.set(c.url, c);
    }
  }
  const area = (c: RawLogoCandidate): number =>
    c.width && c.height ? c.width * c.height : -1;
  return Array.from(byUrl.values())
    .sort((a, b) => {
      const rank = KIND_RANK[a.kind] - KIND_RANK[b.kind];
      if (rank !== 0) return rank;
      return area(b) - area(a);
    })
    .slice(0, MAX_LOGO_CANDIDATES);
}

// ---------------------------------------------------------------------------
// Leere-Seite-Erkennung + Gesamtauswertung
// ---------------------------------------------------------------------------

/**
 * Cloudflare-Interstitials, Fehlerseiten und leere Seiten liefern
 * praktisch keinen Text, keine Buttons und keine Logos — dann ist jede
 * "Analyse" geraten und wir brechen lieber freundlich ab.
 */
export function isEmptyExtraction(raw: RawExtraction): boolean {
  return (
    raw.textLength < 40 &&
    raw.buttons.length === 0 &&
    raw.logoCandidates.length === 0
  );
}

/** Neutrale Fallback-Hintergründe, falls die Seite keinen parsebaren hat. */
const FALLBACK_BG: Record<"light" | "dark", string> = {
  light: "#ffffff",
  dark: "#0b0c10",
};

/** Achromatischer Notnagel, wenn die Seite keinerlei Markenfarbe hat. */
const FALLBACK_PRIMARY: Record<"light" | "dark", string> = {
  light: "#111111",
  dark: "#f4f5f7",
};

/**
 * Gesamtauswertung Roh-JSON → BrandKit + Logo-Kandidaten.
 *
 * Farb-Sonderfall: Seiten ohne gesättigte Buttonfarbe (z. B. schwarze
 * Buttons auf Weiß) bekommen als Primärfarbe den häufigsten Button-
 * Hintergrund, der gegen den Seitenhintergrund lesbar ist (≥ 3:1) —
 * erst danach greift der neutrale Ink/Weiß-Fallback.
 */
export function analyzeExtraction(
  raw: RawExtraction,
  sourceUrl: string,
): BrandAnalysis {
  const mode = detectBgMode(raw.backgrounds);
  const pageBg = dominantBackground(raw.backgrounds) ?? FALLBACK_BG[mode];

  const buttonBgs = raw.buttons.map((b) => b.backgroundColor);
  const picked = pickBrandColors(buttonBgs);

  let primary = picked.primary;
  if (!primary) {
    // Achromatische Marken (schwarze/weiße Buttons): häufigste lesbare
    // Buttonfarbe übernehmen statt eine Farbe zu erfinden.
    const counts = new Map<string, number>();
    for (const bg of buttonBgs) {
      const hex = parseCssColor(bg);
      if (!hex) continue;
      if (contrastRatio(hex, pageBg) < 3) continue;
      counts.set(hex, (counts.get(hex) ?? 0) + 1);
    }
    primary = counts.size > 0 ? mostFrequentHex(counts) : FALLBACK_PRIMARY[mode];
  }

  const { usable } = ensureReadablePrimary(primary, pageBg);

  const kit: BrandKit = {
    colors: { primary: usable, bg: mode },
    fontPairId: matchFontToPair(
      raw.headingFontFamily || raw.bodyFontFamily || "",
    ),
    radius: mapRadius(raw.buttons.map((b) => b.borderRadius)),
    shadow: mapShadow(raw.buttons.map((b) => b.boxShadow)),
    sourceUrl,
  };
  if (picked.accent && picked.accent !== usable) {
    kit.colors.accent = picked.accent;
  }

  return { kit, logoCandidates: sortLogoCandidates(raw.logoCandidates) };
}
