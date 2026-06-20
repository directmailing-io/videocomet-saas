/**
 * Mapping `(playedSec, durationSec) → 25 | 50 | 75 | 100 | null`.
 *
 * Wird vom Lead-Event-Hook beim `video_progress`-Event genutzt, um die
 * Empfänger über das Erreichen der nächsten Viertel-Marke zu
 * informieren. Wir liefern den HÖCHSTEN überschrittenen Schwellwert
 * (oder `null`, wenn das Video noch < 25 % gespielt wurde) — der
 * Worker entscheidet auf Basis dieses Wertes, ob ein Push notwendig
 * ist (z.B. Idempotenz: pro Lead × Quartile höchstens einmal).
 *
 * Edge-cases:
 *   - `durationSec ≤ 0`     → null (Division durch 0 vermeiden,
 *     unmögliches Video).
 *   - `playedSec < 0`       → null (negative Werte sind unsinnig).
 *   - `playedSec ≥ durationSec` → 100 (Empfänger bekommt das
 *     "completed"-Quartil, auch wenn das Player-Event eine Hairline-
 *     überschreitung war).
 */

export function progressToQuartile(
  playedSec: number,
  durationSec: number,
): 25 | 50 | 75 | 100 | null {
  if (!Number.isFinite(playedSec) || !Number.isFinite(durationSec)) return null;
  if (durationSec <= 0) return null;
  if (playedSec < 0) return null;

  const ratio = playedSec / durationSec;
  if (ratio >= 1) return 100;
  if (ratio >= 0.75) return 75;
  if (ratio >= 0.5) return 50;
  if (ratio >= 0.25) return 25;
  return null;
}
