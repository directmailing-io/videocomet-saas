/**
 * Pure Planungslogik für die Anzeigedauern der Presentation-Segmente.
 *
 * Zwei Schritte:
 *
 * 1. Intro-Kompensation: die KI-Begrüßung verändert den Anfang des Webcam-
 *    Videos um `introTrimMs` — positiv = Anfang wurde getrimmt (Sprache
 *    liegt früher), negativ = Anfang wurde VERLÄNGERT (TTS war länger als
 *    die Original-Anrede, sync.so bounce; Sprache liegt später). Bei
 *    positivem Trim werden die VORDEREN Segmente kaskadierend gekürzt
 *    (min 200ms pro Segment), bei Verlängerung wird das ERSTE Segment um
 *    den Betrag gestreckt — damit alle späteren Segmentwechsel wieder
 *    synchron zur Sprache liegen. Dabei wird nichts geschnitten: jedes
 *    Segment ist ein separat gerenderter Clip, es ändern sich nur die
 *    Anzeigedauern, der Concat bleibt nahtlos.
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
  /** Um wieviel das erste Segment gestreckt wurde (introTrimMs < 0). */
  extendedLeadMs: number;
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

  let extendedLeadMs = 0;
  if (introTrimMs < 0 && adjusted.length > 0) {
    extendedLeadMs = Math.round(-introTrimMs);
    adjusted[0].durationMs += extendedLeadMs;
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
    extendedLeadMs,
  };
}
