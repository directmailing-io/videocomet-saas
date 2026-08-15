/**
 * Kuratierte Font-Paare für das Brand-Kit (Landingpage v3).
 *
 * Statt freier Heading/Body-Kombis wählt der User im Styleguide eines von
 * 8 Paaren als visuelle Kachel (Konzept 3.4). Alle Familien stammen aus
 * der bestehenden Google-Fonts-Liste (fonts.ts) — es werden keine neuen
 * Fonts geladen, die URL-Budget-Logik bleibt unangetastet.
 */

export interface FontPair {
  id: string;
  label: string;
  /** Exakter Familienname aus fonts.ts. */
  heading: string;
  /** Exakter Familienname aus fonts.ts. */
  body: string;
  /** Kurze deutsche Beschreibung für die UI-Kachel. */
  vibe: string;
}

export const DEFAULT_FONT_PAIR_ID = "inter";

/** Reihenfolge = Anzeige-Reihenfolge im Styleguide-Panel. */
export const FONT_PAIRS: FontPair[] = [
  {
    id: "inter",
    label: "Inter",
    heading: "Inter",
    body: "Inter",
    vibe: "Klar und modern, der sichere Standard",
  },
  {
    id: "grotesk-inter",
    label: "Space Grotesk + Inter",
    heading: "Space Grotesk",
    body: "Inter",
    vibe: "Technisch und frisch, Startup-Charakter",
  },
  {
    id: "playfair-source",
    label: "Playfair Display + Source Sans 3",
    heading: "Playfair Display",
    body: "Source Sans 3",
    vibe: "Elegant und hochwertig, klassische Serifen",
  },
  {
    id: "dm-serif-dm-sans",
    label: "DM Serif Display + DM Sans",
    heading: "DM Serif Display",
    body: "DM Sans",
    vibe: "Ausdrucksstark und freundlich zugleich",
  },
  {
    id: "manrope",
    label: "Manrope",
    heading: "Manrope",
    body: "Manrope",
    vibe: "Weich und zeitgemäß, angenehm ruhig",
  },
  {
    id: "poppins-lato",
    label: "Poppins + Lato",
    heading: "Poppins",
    body: "Lato",
    vibe: "Rund und sympathisch, nahbarer Auftritt",
  },
  {
    id: "cormorant-nunito",
    label: "Cormorant Garamond + Nunito Sans",
    heading: "Cormorant Garamond",
    body: "Nunito Sans",
    vibe: "Magazinhaft und ruhig, seriöser Ton",
  },
  {
    id: "grotesk-dm-sans",
    label: "Space Grotesk + DM Sans",
    heading: "Space Grotesk",
    body: "DM Sans",
    vibe: "Mutig und markant, viel Charakter",
  },
];

const PAIR_INDEX: Map<string, FontPair> = new Map(
  FONT_PAIRS.map((p) => [p.id, p]),
);

export function getFontPair(id: string): FontPair | undefined {
  return PAIR_INDEX.get(id);
}

/**
 * Rückwärts-Suche für bestehende Vorlagen: exaktes Heading/Body-Paar →
 * Pair. Case-insensitiv, weil Theme-JSON hand-editiert sein kann.
 */
export function findPairByFonts(
  heading: string,
  body: string,
): FontPair | undefined {
  const h = normalizeFamily(heading);
  const b = normalizeFamily(body);
  return FONT_PAIRS.find(
    (p) => p.heading.toLowerCase() === h && p.body.toLowerCase() === b,
  );
}

/**
 * Erkennungsliste für Serifen-Schriften — bewusst breit (auch Familien,
 * die wir selbst nicht anbieten), weil hier von fremden Websites
 * erkannte `font-family`-Werte ankommen.
 */
const SERIF_HINTS: string[] = [
  "serif",
  "georgia",
  "times",
  "garamond",
  "playfair",
  "cormorant",
  "merriweather",
  "lora",
  "baskerville",
  "didot",
  "bodoni",
  "cambria",
  "charter",
  "palatino",
  "spectral",
  "crimson",
  "tiempos",
  "freight",
];

/** Serif-Erkennung → dieses Paar; alles andere → "inter". */
const SERIF_FALLBACK_PAIR_ID = "playfair-source";

/**
 * Mappt eine von einer fremden Website erkannte Font-Familie auf eines
 * unserer kuratierten Paare (Konzept 3.2: niemals Fremd-Fonts laden).
 *
 * 1. Exakter Treffer auf ein Pair-Heading → dieses Paar.
 * 2. Kategorie-Heuristik: Serif-Hinweis (ohne "sans") → Serif-Paar.
 * 3. Sonst → "inter".
 */
export function matchFontToPair(detectedFamily: string): string {
  const family = normalizeFamily(detectedFamily);
  if (family.length === 0) return DEFAULT_FONT_PAIR_ID;

  const exact = FONT_PAIRS.find((p) => p.heading.toLowerCase() === family);
  if (exact) return exact.id;

  // "sans-serif" / "Open Sans" etc. enthalten "serif"/Serif-Wörter nur
  // scheinbar — "sans" gewinnt immer.
  if (family.indexOf("sans") === -1) {
    for (const hint of SERIF_HINTS) {
      if (family.indexOf(hint) !== -1) return SERIF_FALLBACK_PAIR_ID;
    }
  }
  return DEFAULT_FONT_PAIR_ID;
}

/**
 * Normalisiert einen `font-family`-Wert: erste Familie aus einer
 * Komma-Liste, Anführungszeichen weg, lowercase.
 */
function normalizeFamily(value: string): string {
  const first = value.split(",")[0] ?? "";
  return first.replace(/['"]/g, "").trim().toLowerCase();
}
