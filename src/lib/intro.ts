/**
 * Geteilte Konstanten des Intro-Features (personalisierte Video-Begrüßung).
 * Von API-Routes UND Worker-Prozessoren importiert — deshalb bewusst ohne
 * Worker-Dependencies (ffmpeg etc.).
 */

/** Default-Vorlage für die TTS-Begrüßung. `{vorname}` wird pro Lead ersetzt. */
export const DEFAULT_TTS_TEMPLATE =
  "Hallo {vorname}! Schön, dass du dir das Video anschaust.";

/** Version des Einwilligungstexts (Stimm-Klonen + KI-Generierung). */
export const CONSENT_TEXT_VERSION = "v1-2026-08";
