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

// Einwilligungstexte — von Setup-Seite UND Kampagnen-Wizard gerendert.
// Bei jeder inhaltlichen Änderung CONSENT_TEXT_VERSION hochziehen
// (Anwalts-Review der Texte steht noch aus).
export const CONSENT_VOICE_TEXT =
  "Ich willige ausdrücklich ein, dass VIDEOCOMET aus meinen Aufnahmen ein digitales Stimmmodell erstellt und dieses ausschließlich für meine personalisierten Videobegrüßungen verwendet. Es handelt sich dabei um biometrische Daten (Art. 9 DSGVO). Verarbeitung durch die in der Datenschutzerklärung genannten Dienstleister. Ich kann diese Einwilligung jederzeit widerrufen, mein Stimmmodell wird dann gelöscht.";

export const CONSENT_AI_TEXT =
  "Mir ist bekannt, dass die personalisierte Begrüßung mit KI-Technologie erzeugt wird und die Qualität schwanken kann. Vor jeder Produktion prüfe und genehmige ich Beispielvideos. Mit dieser Freigabe akzeptiere ich die gezeigte Qualität als vertragsgemäß.";
