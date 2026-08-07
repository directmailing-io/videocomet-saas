/**
 * Geteilte Konstanten des Intro-Features (personalisierte Video-Begrüßung).
 * Von API-Routes UND Worker-Prozessoren importiert — deshalb bewusst ohne
 * Worker-Dependencies (ffmpeg etc.).
 */

/**
 * Fest wählbare Anrede-Prefixe. Absichtlich kurz und mündlich — der TTS
 * spricht nur die Anrede, der Rest kommt aus dem Original-Video. Neue
 * Prefixe hier ergänzen; die UI zeigt die Reihenfolge unverändert.
 */
export const GREETING_PREFIXES = [
  "Hi",
  "Hallo",
  "Hey",
  "Guten Tag",
  "Moin",
  "Servus",
] as const;
export type GreetingPrefix = (typeof GREETING_PREFIXES)[number];

/**
 * Zählt Anrede-Vorkommen (word-boundary, case-insensitive) in einem
 * ASR-Transkript. Das Engine-QA-Gate erwartet im fertigen Video genau
 * EINE Anrede — mehr = die Original-Anrede hat den Cut überlebt
 * (Doppel-Begrüßung), keine = die TTS fehlt/ist stumm.
 */
export function countGreetingMentions(text: string): number {
  let count = 0;
  for (const prefix of GREETING_PREFIXES) {
    const pattern = `(?:^|[^\\p{L}])${prefix.replace(/\s+/g, "\\s+")}(?=[^\\p{L}]|$)`;
    count += (text.match(new RegExp(pattern, "giu")) ?? []).length;
  }
  return count;
}

/**
 * Zwei Namens-Muster. „firstName" ist informell (Du-Kunden), „formal" ist
 * die Herr/Frau-Variante (Sie-Kunden). Die Platzhalter werden im Worker
 * aus den Lead-Daten befüllt (Vorname, Anrede, Nachname).
 */
export const NAME_PATTERNS = {
  firstName: "{vorname}",
  formal: "{anrede} {nachname}",
} as const;
export type NamePatternKey = keyof typeof NAME_PATTERNS;

export function buildGreetingTemplate(
  prefix: GreetingPrefix,
  pattern: NamePatternKey,
): string {
  return `${prefix} ${NAME_PATTERNS[pattern]}`;
}

/**
 * Zerlegt eine gespeicherte Template-Zeile wieder in Prefix + Pattern,
 * damit die UI die Dropdowns korrekt vorbelegen kann. Freitext-Templates
 * (Legacy, längere Sätze) landen mit `prefix=null` — die UI stellt dann
 * die Defaults ein.
 */
export function parseGreetingTemplate(
  template: string | null | undefined,
): { prefix: GreetingPrefix; pattern: NamePatternKey } | null {
  if (!template) return null;
  const t = template.trim();
  // Reihenfolge wichtig: „Guten Tag" muss vor „Guten"-Startprefixen matchen.
  for (const prefix of GREETING_PREFIXES) {
    const rest = t.startsWith(prefix + " ")
      ? t.slice(prefix.length + 1).trim()
      : null;
    if (rest === null) continue;
    if (rest === NAME_PATTERNS.firstName) return { prefix, pattern: "firstName" };
    if (rest === NAME_PATTERNS.formal) return { prefix, pattern: "formal" };
  }
  return null;
}

/** Default: kürzeste, universelle Begrüßung. Kein Satz — nur die Anrede. */
export const DEFAULT_TTS_TEMPLATE = buildGreetingTemplate("Hi", "firstName");

/** Version des Einwilligungstexts (Stimm-Klonen + KI-Generierung). */
export const CONSENT_TEXT_VERSION = "v1-2026-08";

/**
 * Ziel-Anzahl Beispielvideos pro Run vor der Vollproduktion. Wird von
 * Worker (Rendering-Budget) UND Status-API/UI (Fortschritts-Anzeige)
 * geteilt, damit „X von N fertig" immer konsistent bleibt.
 */
export const INTRO_PREVIEW_TARGET = 3;

// Einwilligungstexte — von Setup-Seite UND Kampagnen-Wizard gerendert.
// Bei jeder inhaltlichen Änderung CONSENT_TEXT_VERSION hochziehen
// (Anwalts-Review der Texte steht noch aus).
export const CONSENT_VOICE_TEXT =
  "Ich willige ausdrücklich ein, dass VIDEOCOMET aus meinen Aufnahmen ein digitales Stimmmodell erstellt und dieses ausschließlich für meine personalisierten Videobegrüßungen verwendet. Es handelt sich dabei um biometrische Daten (Art. 9 DSGVO). Verarbeitung durch die in der Datenschutzerklärung genannten Dienstleister. Ich kann diese Einwilligung jederzeit widerrufen, mein Stimmmodell wird dann gelöscht.";

export const CONSENT_AI_TEXT =
  "Mir ist bekannt, dass die personalisierte Begrüßung mit KI-Technologie erzeugt wird und die Qualität schwanken kann. Vor jeder Produktion prüfe und genehmige ich Beispielvideos. Mit dieser Freigabe akzeptiere ich die gezeigte Qualität als vertragsgemäß.";
