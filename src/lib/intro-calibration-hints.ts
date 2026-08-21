/**
 * Analyse-Fehler-Codes des Kalibrierungs-Workers → deutsche Hinweise.
 * EINZIGE Quelle für diese Texte (Kampagnen-Karte, Preflight, Studio).
 * Gibt `null` für unbekannte Codes zurück — der Aufrufer liefert seinen
 * kontextpassenden Standardtext.
 */
export function calibrationErrorHint(
  code: string | null | undefined,
): string | null {
  switch (code) {
    case "greeting_not_recognized":
      return "Dein Video beginnt nicht mit einer Begrüßung. Starte die Aufnahme direkt mit „Hi!“, „Hallo!“ oder „Hey!“ — kurze Pause — dann dein erster Satz.";
    case "no_pause_detected":
      return "Du hast nach deiner Begrüßung ohne Pause weitergesprochen. Nimm neu auf: erst „Hi!“ sagen, dann kurz still sein (etwa 1 Sekunde), dann der erste Satz.";
    case "greeting_too_late":
      return "Deine Begrüßung samt Pause kommt zu spät. Starte die Aufnahme direkt mit „Hi!“ und mach die kurze Pause gleich danach — nicht erst nach mehreren Sekunden.";
    case "no_speech_detected":
    case "audio_flat":
      return "Wir konnten keine Sprache am Anfang des Videos erkennen. Bitte prüfe die Tonspur des Videos.";
    case "greeting_inaudible":
      return "Deine Begrüßung am Anfang war zu leise oder nicht erkennbar. Sprich die Begrüßung („Hi!“) klar und in normaler Lautstärke, dann eine kurze Pause, dann der erste Satz.";
    case "no_sentence_after_pause":
      return "Nach der Pause hinter deiner Begrüßung kommt keine Sprache mehr. Sprich nach der kurzen Pause bitte einen ersten Satz weiter.";
    case "no_breath_gap_detected":
      return "Der erste Satz nach der Begrüßung geht ohne Atempause weiter. Sprich nach dem ersten kompletten Satz kurz ein und atme durch, dann weiter.";
    case "sentence_too_short":
      return "Der erste Satz war zu kurz. Sprich mindestens ein bis zwei Sekunden am Stück, bevor du wieder pausierst.";
    case "sentence_too_long":
      return "Der erste Satz war zu lang für eine saubere Erkennung. Kürze ihn auf einen kompakten Einleitungssatz und mach danach eine Atempause.";
    case "anchor_too_late":
      return "Deine Einleitung dauert zu lang. Sprich nach der Begrüßungs-Pause einen KURZEN ersten Satz (max. 10 Sekunden), dann eine kleine Atempause.";
    case "transcription_failed":
      return "Die Tonspur konnte nicht ausgewertet werden. Bitte versuche die Analyse erneut.";
    default:
      return null;
  }
}
