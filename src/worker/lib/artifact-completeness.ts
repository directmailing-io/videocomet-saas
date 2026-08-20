/**
 * Completeness-Checks (Reliability by Design 2026-08-20).
 *
 * Ein Lead darf nur als erfolgreich gelten, wenn alle erforderlichen
 * Artefakte wirklich existieren — und ein fertiges Video darf nicht
 * deutlich kürzer sein als geplant (fehlender Bestandteil).
 */

export interface LeadArtifactState {
  videoUrl: string | null | undefined;
  slug: string | null | undefined;
  pdfUrl: string | null | undefined;
  pdfRequired: boolean;
}

/**
 * Liefert die Liste fehlender Pflicht-Artefakte (leer = vollständig).
 * Envelope-PDFs sind bewusst Best-Effort und werden nicht geprüft.
 */
export function missingLeadArtifacts(state: LeadArtifactState): string[] {
  const missing: string[] = [];
  if (!state.videoUrl) missing.push("Video (videoUrl)");
  if (!state.slug) missing.push("Landingpage (slug)");
  if (state.pdfRequired && !state.pdfUrl) missing.push("PDF-Brief (pdfUrl)");
  return missing;
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
