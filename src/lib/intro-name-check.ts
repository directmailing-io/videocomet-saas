/**
 * Vornamen-Validierung für die personalisierte Video-Begrüßung.
 *
 * Bevor pro Lead eine TTS-Begrüßung ("Hallo {vorname}!") erzeugt wird,
 * muss der Vorname aus den Lead-Daten als "sprechbarer echter Vorname"
 * validiert werden. Firmennamen, E-Mail-Adressen, Abteilungs-Postfächer
 * ("info", "vertrieb"), reine Titel ("Dr.") und Zahlen führen zum
 * Fallback auf das Original-Video (`intro_status = 'fallback_name'`).
 *
 * Bewusst OHNE Worker-Dependencies — wird von Pipeline UND API geteilt.
 */

export type NameCheckResult =
  | { ok: true; name: string }
  | { ok: false; reason: string };

/**
 * Alias-Kandidaten pro Feld — case-insensitive vom Aufrufer geprüft.
 * Reihenfolge: exakter Treffer gewinnt, dann CI.
 */
const FIELD_ALIASES = {
  vorname: ["firstName", "Vorname", "first_name", "vorname"],
  nachname: ["lastName", "Nachname", "last_name", "nachname"],
  anrede: ["anrede", "Anrede", "salutation", "Salutation"],
} as const;

function pickField(
  data: Record<string, string>,
  candidates: readonly string[],
): string {
  for (const key of candidates) {
    const v = data[key];
    if (v && v.trim()) return v.trim();
  }
  const lower = new Map<string, string>();
  for (const [k, v] of Object.entries(data)) lower.set(k.toLowerCase(), v);
  for (const key of candidates) {
    const v = lower.get(key.toLowerCase());
    if (v && v.trim()) return v.trim();
  }
  return "";
}

export type IntroSubstitutionResult =
  | { ok: true; substitutions: Record<string, string> }
  | { ok: false; reason: string };

/**
 * Ermittelt aus einem Template + Lead-Daten die validierten
 * Substitutionen für die Intro-Engine. Erkennt automatisch
 * `{vorname}`- vs. `{anrede} {nachname}`-Templates und ruft den passenden
 * Namens-Check auf. Fehlt ein Pflichtfeld oder ist ungültig → Fallback
 * (Pipeline nimmt dann Original-Video, 1 Credit).
 */
export function resolveIntroSubstitutions(
  template: string,
  leadData: Record<string, string>,
): IntroSubstitutionResult {
  const usesVorname = template.includes("{vorname}");
  const usesNachname = template.includes("{nachname}");
  const usesAnrede = template.includes("{anrede}");

  if (!usesVorname && !usesNachname) {
    return { ok: false, reason: "template_no_placeholders" };
  }

  const out: Record<string, string> = {};

  if (usesVorname) {
    const raw = pickField(leadData, FIELD_ALIASES.vorname);
    const check = checkFirstName(raw);
    if (!check.ok) return { ok: false, reason: `vorname_${check.reason}` };
    out.vorname = check.name;
  }

  if (usesNachname) {
    const nachnameRaw = pickField(leadData, FIELD_ALIASES.nachname);
    if (usesAnrede) {
      const anredeRaw = pickField(leadData, FIELD_ALIASES.anrede);
      const check = checkFormalName(anredeRaw, nachnameRaw);
      if (!check.ok) return { ok: false, reason: check.reason };
      // Für den TTS-Text zusammen als „Herr Thiesen" gebraucht — Engine
      // ersetzt {anrede} und {nachname} einzeln, also splitten wir wieder.
      const [anredeNorm, ...rest] = check.name.split(" ");
      out.anrede = anredeNorm;
      out.nachname = rest.join(" ");
    } else {
      const check = checkFirstName(nachnameRaw);
      if (!check.ok) return { ok: false, reason: `nachname_${check.reason}` };
      out.nachname = check.name;
    }
  }

  return { ok: true, substitutions: out };
}

/**
 * Führende Titel/Anreden, die vor der eigentlichen Namens-Prüfung
 * abgestreift werden. Matcht tokenweise, case-insensitive. Zusammengesetzte
 * Titel wie "Dipl.-Ing." sind einzelne Tokens und werden komplett entfernt.
 */
// via RegExp-Konstruktor, weil das tsconfig-Target (ES5-Default) das
// `u`-Flag als Literal nicht erlaubt — zur Laufzeit (Node) kein Problem.
const TITLE_TOKEN_RE = new RegExp(
  "^(herrn?|frau|fräulein|hr|fr|dr|prof|professor|mag|dipl(\\.|-)?[a-zäöü.-]*|ing|med|rer|nat|jur|phil|habil|mba|msc|bsc|ba|ma|llm|h\\.c)\\.?$",
  "iu",
);

/**
 * Blockliste (case-insensitive): Werte, die in CRM-Vorname-Spalten häufig
 * auftauchen, aber keine ansprechbaren Personen sind.
 */
const BLOCKLIST = new Set([
  "gmbh",
  "ag",
  "kg",
  "ug",
  "ohg",
  "gbr",
  "firma",
  "team",
  "info",
  "kontakt",
  "verkauf",
  "vertrieb",
  "buchhaltung",
  "familie",
  "herr",
  "frau",
]);

/** Pro Token: Buchstabe gefolgt von 1-23 Buchstaben/Apostroph/Bindestrich. */
const NAME_TOKEN_RE = new RegExp("^\\p{L}[\\p{L}'’-]{1,23}$", "u");

function isValidToken(token: string): boolean {
  return NAME_TOKEN_RE.test(token) && !BLOCKLIST.has(token.toLowerCase());
}

/** Erster Buchstabe groß, Rest wie übergeben ("anna-lena" → "Anna-lena"). */
function capitalize(token: string): string {
  return token.charAt(0).toUpperCase() + token.slice(1);
}

/**
 * Prüft und normalisiert einen Vorname-Rohwert aus Lead-Daten.
 *
 * Ablauf:
 *   1. trim; leere Eingabe → fail.
 *   2. Führende Titel/Anreden abstreifen (Herr, Frau, Dr., Prof.,
 *      Dipl.-Ing., …) — auch mehrere hintereinander ("Herr Dr.").
 *   3. Vom Rest die führenden Tokens nehmen, die dem Namens-Pattern
 *      entsprechen — maximal 2 ("Anna Maria" bleibt "Anna Maria",
 *      "Anna Maria Luise" wird "Anna Maria"). Enthält das ZWEITE Token
 *      kein gültiges Namensmuster, bleibt nur das erste.
 *   4. Blocklist ("GmbH", "info", …) und Pattern (keine Ziffern, keine
 *      Sonderzeichen außer '/-, 2-24 Zeichen) pro Token.
 *   5. Normalisierung: erster Buchstabe pro Token groß, Rest unverändert.
 */
/**
 * Prüft ein Anrede+Nachname-Paar für die formale Variante („Guten Tag
 * Herr Thiesen"). Anrede wird auf „Herr"/„Frau" normalisiert, Nachname
 * durchläuft dieselbe Blocklist/Pattern-Prüfung wie ein Vorname.
 *
 * Ergebnis-`name` ist der komplette Ausdruck, den der Worker als
 * Substitutionswert einsetzt (z.B. „Herr Thiesen").
 */
export function checkFormalName(
  anredeRaw: string,
  nachnameRaw: string,
): NameCheckResult {
  const anrede = (anredeRaw ?? "").trim().toLowerCase();
  const anredeNorm =
    anrede === "herr" || anrede === "hr" || anrede === "hr."
      ? "Herr"
      : anrede === "frau" || anrede === "fr" || anrede === "fr."
        ? "Frau"
        : null;
  if (!anredeNorm) return { ok: false, reason: "anrede_unknown" };

  const nachnameCheck = checkFirstName(nachnameRaw);
  if (!nachnameCheck.ok) return nachnameCheck;

  return { ok: true, name: `${anredeNorm} ${nachnameCheck.name}` };
}

export function checkFirstName(raw: string): NameCheckResult {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) {
    return { ok: false, reason: "empty" };
  }

  let tokens = trimmed.split(/\s+/);

  // Führende Titel/Anreden abstreifen (max. 4 — Schutz vor Endlos-Input).
  let stripped = 0;
  while (tokens.length > 0 && stripped < 4 && TITLE_TOKEN_RE.test(tokens[0])) {
    tokens = tokens.slice(1);
    stripped++;
  }

  if (tokens.length === 0) {
    return { ok: false, reason: "only_title" };
  }

  const first = tokens[0];
  if (!NAME_TOKEN_RE.test(first)) {
    return { ok: false, reason: "invalid_pattern" };
  }
  if (BLOCKLIST.has(first.toLowerCase())) {
    return { ok: false, reason: "blocklisted" };
  }

  // Zweites Token nur behalten, wenn es selbst ein gültiger Name ist
  // ("Anna Maria" → beide; "Anna GmbH" → nur "Anna").
  const kept = [first];
  if (tokens.length > 1 && isValidToken(tokens[1])) {
    kept.push(tokens[1]);
  }

  return { ok: true, name: kept.map(capitalize).join(" ") };
}
