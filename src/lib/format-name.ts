/**
 * Anzeige-Formatierung für Personen- und Firmennamen aus Lead-Daten.
 *
 * Leadlisten kommen oft komplett klein- oder großgeschrieben an
 * ("daniel fischer", "MAX MUSTERMANN"). Für die UI wollen wir korrekte
 * Großschreibung — aber ohne bewusst gemischte Schreibweisen zu zerstören
 * ("McDonald", "de Vries" bleiben unangetastet).
 */

/** Namens-Partikel, die mitten im Namen klein bleiben (nie am Anfang). */
const LOWERCASE_PARTICLES = new Set([
  "von",
  "van",
  "de",
  "der",
  "den",
  "des",
  "di",
  "da",
  "zu",
  "zur",
  "zum",
  "ten",
  "ter",
  "la",
  "le",
  "del",
  "della",
  "und",
  "y",
  "e",
]);

/** Firmen-Kürzel mit fester Schreibweise. */
const COMPANY_ACRONYMS = new Map<string, string>([
  ["gmbh", "GmbH"],
  ["ag", "AG"],
  ["kg", "KG"],
  ["ohg", "OHG"],
  ["ug", "UG"],
  ["gbr", "GbR"],
  ["ek", "e.K."],
  ["e.k", "e.K."],
  ["e.k.", "e.K."],
  ["ev", "e.V."],
  ["e.v", "e.V."],
  ["e.v.", "e.V."],
  ["mbh", "mbH"],
  ["co", "Co."],
  ["co.", "Co."],
  ["se", "SE"],
  ["llc", "LLC"],
  ["ltd", "Ltd."],
  ["ltd.", "Ltd."],
  ["inc", "Inc."],
  ["inc.", "Inc."],
]);

function isAllLower(s: string): boolean {
  return s === s.toLocaleLowerCase("de-DE") && s !== s.toLocaleUpperCase("de-DE");
}

function isAllUpper(s: string): boolean {
  return s === s.toLocaleUpperCase("de-DE") && s !== s.toLocaleLowerCase("de-DE");
}

/** "daniel" → "Daniel"; behandelt Bindestrich/Apostroph-Subtokens rekursiv. */
function capitalizeToken(token: string): string {
  for (const sep of ["-", "'", "’"]) {
    if (token.includes(sep)) {
      return token
        .split(sep)
        .map((part) => (part === "" ? part : capitalizeToken(part)))
        .join(sep);
    }
  }
  if (token.length === 0) return token;
  return (
    token.charAt(0).toLocaleUpperCase("de-DE") +
    token.slice(1).toLocaleLowerCase("de-DE")
  );
}

/**
 * Personenname für die Anzeige formatieren.
 * Nur Wörter, die KOMPLETT klein- oder großgeschrieben sind, werden
 * angefasst — gemischte Schreibweisen (McDonald, deVries) bleiben erhalten.
 */
export function formatPersonName(name: string | null | undefined): string {
  const raw = (name ?? "").trim().replace(/\s+/g, " ");
  if (raw === "") return "";
  const words = raw.split(" ");
  return words
    .map((word, i) => {
      if (!isAllLower(word) && !isAllUpper(word)) return word;
      const lower = word.toLocaleLowerCase("de-DE");
      if (i > 0 && LOWERCASE_PARTICLES.has(lower)) return lower;
      return capitalizeToken(word);
    })
    .join(" ");
}

/**
 * Firmenname für die Anzeige formatieren. Rechtsform-Kürzel bekommen ihre
 * feste Schreibweise (gmbh → GmbH). Komplett großgeschriebene Wörter bleiben
 * stehen — bei Firmen ist das oft gewollte Marken-Schreibweise (EDEKA, SAP).
 */
export function formatCompanyName(name: string | null | undefined): string {
  const raw = (name ?? "").trim().replace(/\s+/g, " ");
  if (raw === "") return "";
  return raw
    .split(" ")
    .map((word, i) => {
      const acronym = COMPANY_ACRONYMS.get(word.toLocaleLowerCase("de-DE"));
      if (acronym) return acronym;
      if (!isAllLower(word)) return word;
      if (i > 0 && LOWERCASE_PARTICLES.has(word)) return word;
      return capitalizeToken(word);
    })
    .join(" ");
}
