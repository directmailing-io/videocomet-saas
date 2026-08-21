/**
 * Completeness-Checks (Reliability by Design 2026-08-20, erweitert 2026-08-21).
 *
 * ZENTRALE INVARIANTE: Ein Lead darf nur dann als erfolgreich gelten, wenn
 * alle für seine konkrete Konfiguration erforderlichen Bestandteile
 * tatsächlich erzeugt wurden. Die `*Required`-Flags werden vom Aufrufer
 * EXAKT aus den Bedingungen der jeweiligen Pipeline-Stage abgeleitet —
 * sonst verlangt das Gate Artefakte, die die Stage nie gebaut hätte.
 *
 * Dieses Modul ist die EINZIGE Quelle für die Frage "Was MUSS bei diesem
 * Lead vorhanden sein?" — Pipeline-Gate (Stage 9d) und Run-Finalisierung
 * (finalizeRunIfAllLeadsDone) leiten ihre Prüfungen hieraus ab.
 */

/**
 * Akzeptierte Intro-Endzustände, wenn eine KI-Begrüßung erwartet wird:
 *   'generated'     → Begrüßung erfolgreich eingebaut.
 *   'fallback_name' → kein brauchbarer Vorname — es gibt schlicht nichts
 *                     zu personalisieren; Original-Video ist korrekt
 *                     (dokumentierte Produkt-Entscheidung, kostet 1 Credit).
 * NICHT akzeptiert: 'disabled' und 'fallback_error' — der User hat eine
 * personalisierte Begrüßung konfiguriert und erwartet sie (Vorfall
 * 2026-08-21: Runde lief still komplett ohne Begrüßung durch).
 */
export const ACCEPTED_INTRO_STATES: readonly string[] = [
  "generated",
  "fallback_name",
];

export interface LeadArtifactState {
  videoUrl: string | null | undefined;
  slug: string | null | undefined;
  pdfUrl: string | null | undefined;
  pdfRequired: boolean;
  /** Runde erwartet KI-Begrüßung (runs.introExpected + campaign.introEnabled). */
  introRequired: boolean;
  introStatus: string | null | undefined;
  /** Umschlag-Vorlage konfiguriert (run.envelopeTemplateId ?? campaign.envelopeTemplateId). */
  envelopeRequired: boolean;
  envelopePdfUrl: string | null | undefined;
  /** Runde hat einen A/B-Snapshot (runs.abConfig) → jeder Lead braucht eine Variante. */
  abRequired: boolean;
  abVariant: string | null | undefined;
}

/**
 * Liefert die Liste fehlender Pflicht-Bestandteile (leer = vollständig).
 */
export function missingLeadArtifacts(state: LeadArtifactState): string[] {
  const missing: string[] = [];
  if (!state.videoUrl) missing.push("Video (videoUrl)");
  if (!state.slug) missing.push("Landingpage (slug)");
  if (state.pdfRequired && !state.pdfUrl) missing.push("PDF-Brief (pdfUrl)");
  if (
    state.introRequired &&
    !ACCEPTED_INTRO_STATES.includes(state.introStatus ?? "")
  ) {
    missing.push(
      `KI-Begrüßung (introStatus=${state.introStatus ?? "null"}, erwartet: ${ACCEPTED_INTRO_STATES.join("/")})`,
    );
  }
  if (state.envelopeRequired && !state.envelopePdfUrl) {
    missing.push("Umschlag (envelopePdfUrl)");
  }
  if (
    state.abRequired &&
    state.abVariant !== "A" &&
    state.abVariant !== "B"
  ) {
    missing.push(`A/B-Variante (abVariant=${state.abVariant ?? "null"})`);
  }
  return missing;
}

/**
 * Fail-Fast-Entscheidung für Stage 0 der Pipeline: Die Runde erwartet
 * verbindlich eine KI-Begrüßung (runs.introExpected=true), aber das
 * Intro-Staging ist terminal OHNE Ergebnis geendet. Dann wird der Lead
 * sofort abgebrochen statt teuer ohne Begrüßung zu rendern — das
 * Completeness-Gate (9d) würde ihn ohnehin ablehnen.
 *
 * Bewusst NUR 'disabled' und 'fallback_error': 'fallback_name' ist ein
 * akzeptierter Endzustand (siehe ACCEPTED_INTRO_STATES), und nicht-
 * terminale Stati (queued/generating/null) sind hier kein Abbruchgrund.
 */
export function isIntroHardFailure(
  introExpected: boolean | null | undefined,
  introStatus: string | null | undefined,
): boolean {
  return (
    introExpected === true &&
    (introStatus === "disabled" || introStatus === "fallback_error")
  );
}

/**
 * True, wenn das gemessene Video deutlich kürzer ist als erwartet.
 * Toleranz: max(1.5 s, 2 %) — fängt Codec-Rundung ab, aber ein fehlendes
 * Segment (typisch ≥ 3 s) fällt sicher durch.
 */
export function isDurationShortfall(
  expectedSec: number,
  probedSec: number | null,
): boolean {
  if (probedSec === null) return false;
  const tolerance = Math.max(1.5, expectedSec * 0.02);
  return probedSec < expectedSec - tolerance;
}
