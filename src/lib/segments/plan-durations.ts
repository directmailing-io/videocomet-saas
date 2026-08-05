/**
 * Pure Planungslogik für die Anzeigedauern der Presentation-Segmente.
 *
 * Zwei Schritte:
 *
 * 1. Intro-Kompensation: die KI-Begrüßung trimmt den Anfang des Webcam-
 *    Videos um `introTrimMs` — alles Gesprochene liegt dadurch früher. Die
 *    VORDEREN Segmente werden um exakt denselben Betrag gekürzt
 *    (kaskadierend, min 200ms pro Segment), damit alle späteren
 *    Segmentwechsel wieder synchron zur Sprache liegen. Dabei wird nichts
 *    geschnitten: jedes Segment ist ein separat gerenderter Clip, es
 *    ändern sich nur die Anzeigedauern, der Concat bleibt nahtlos.
 *
 * 2. Budget-Clamp: hart auf die Webcam-Dauer begrenzen. Segmente, die
 *    nicht mehr ins Budget passen, werden verworfen — das letzte noch
 *    passende Segment wird gekürzt.
 */

export const MIN_SEGMENT_MS = 200;

export interface SegmentDurationPlan<S> {
  planned: Array<{ seg: S; durationMs: number }>;
  /** Wieviel vom introTrimMs über die vorderen Segmente absorbiert wurde. */
  absorbedTrimMs: number;
  /** Rest, der nicht absorbiert werden konnte (alle Segmente am Floor). */
  unabsorbedTrimMs: number;
}

export function planSegmentDurations<S extends { durationMs: number }>(
  segments: readonly S[],
  totalDurationSec: number,
  introTrimMs = 0,
): SegmentDurationPlan<S> {
  const adjusted = segments.map((seg) => ({
    seg,
    durationMs: Math.max(MIN_SEGMENT_MS, seg.durationMs),
  }));

  const totalTrim = Math.max(0, Math.round(introTrimMs));
  let trimLeftMs = totalTrim;
  for (const entry of adjusted) {
    if (trimLeftMs <= 0) break;
    const reducible = entry.durationMs - MIN_SEGMENT_MS;
    if (reducible <= 0) continue;
    const cut = Math.min(reducible, trimLeftMs);
    entry.durationMs -= cut;
    trimLeftMs -= cut;
  }

  const totalBudgetMs = Math.max(
    MIN_SEGMENT_MS,
    Math.round(totalDurationSec * 1000),
  );
  const planned: Array<{ seg: S; durationMs: number }> = [];
  let consumedMs = 0;
  for (const { seg, durationMs } of adjusted) {
    if (consumedMs >= totalBudgetMs) break;
    const granted = Math.min(durationMs, totalBudgetMs - consumedMs);
    if (granted < MIN_SEGMENT_MS) break;
    planned.push({ seg, durationMs: granted });
    consumedMs += granted;
  }

  return {
    planned,
    absorbedTrimMs: totalTrim - trimLeftMs,
    unabsorbedTrimMs: trimLeftMs,
  };
}
