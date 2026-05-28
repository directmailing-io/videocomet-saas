/**
 * Helper-Funktionen für Dauer-Mathematik auf Segment-Listen.
 *
 * Alle Werte sind in Millisekunden. Funktionen sind pure: sie liefern
 * neue Arrays/Strings/Numbers und mutieren keine Eingaben.
 */

import type { Segment } from "./types";

/** Summe der `durationMs` aller Segmente. */
export function totalDurationMs(segments: Segment[]): number {
  let total = 0;
  for (const seg of segments) {
    total += seg.durationMs;
  }
  return total;
}

/**
 * Formatiert eine Dauer in ms als "m:ss.mmm" (z. B. 32500 -> "0:32.500").
 * Negative Werte werden auf 0 geklemmt.
 */
export function formatDuration(ms: number): string {
  const safeMs = Math.max(0, Math.round(ms));
  const totalSeconds = Math.floor(safeMs / 1000);
  const millis = safeMs % 1000;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const secStr = seconds.toString().padStart(2, "0");
  const msStr = millis.toString().padStart(3, "0");
  return `${minutes}:${secStr}.${msStr}`;
}

/**
 * Parst eine vom User eingegebene Dauer und gibt ms zurück.
 * Unterstützte Formate:
 *   - "m:ss"           -> z. B. "0:32" oder "1:05"
 *   - "m:ss.mmm"       -> z. B. "0:32.500"
 *   - "<n>s"           -> z. B. "32.5s"
 *   - "<n>ms"          -> z. B. "32500ms"
 *   - "<n>"            -> reine Zahl wird als ms interpretiert ("32500")
 * Gibt `null` zurück, wenn nichts geparst werden kann.
 */
export function parseDuration(input: string): number | null {
  if (typeof input !== "string") return null;
  const trimmed = input.trim();
  if (trimmed.length === 0) return null;

  // "m:ss" oder "m:ss.mmm"
  const colonMatch = trimmed.match(/^(\d+):([0-5]?\d)(?:\.(\d{1,3}))?$/);
  if (colonMatch) {
    const minutes = Number(colonMatch[1]);
    const seconds = Number(colonMatch[2]);
    const millisRaw = colonMatch[3] ?? "0";
    // Auf drei Stellen padden, damit "0:32.5" als 500ms gelesen wird.
    const millis = Number(millisRaw.padEnd(3, "0"));
    if (
      Number.isFinite(minutes) &&
      Number.isFinite(seconds) &&
      Number.isFinite(millis)
    ) {
      return minutes * 60_000 + seconds * 1000 + millis;
    }
    return null;
  }

  // "<n>ms"
  const msMatch = trimmed.match(/^(\d+(?:\.\d+)?)\s*ms$/i);
  if (msMatch) {
    const value = Number(msMatch[1]);
    return Number.isFinite(value) ? Math.round(value) : null;
  }

  // "<n>s"
  const sMatch = trimmed.match(/^(\d+(?:\.\d+)?)\s*s$/i);
  if (sMatch) {
    const value = Number(sMatch[1]);
    return Number.isFinite(value) ? Math.round(value * 1000) : null;
  }

  // Reine Zahl -> ms
  const numMatch = trimmed.match(/^(\d+(?:\.\d+)?)$/);
  if (numMatch) {
    const value = Number(numMatch[1]);
    return Number.isFinite(value) ? Math.round(value) : null;
  }

  return null;
}

/**
 * Verteilt `targetMs` gleichmäßig auf die übergebenen Segmente.
 * Rundungsreste fallen ins letzte Segment, sodass die Summe exakt
 * `targetMs` ergibt. Bei leerer Liste oder targetMs <= 0 wird die
 * Eingabe unverändert (geklont) zurückgegeben.
 */
export function distributeEvenly(
  segments: Segment[],
  targetMs: number,
): Segment[] {
  if (segments.length === 0 || targetMs <= 0) {
    return segments.map((s) => ({ ...s }));
  }
  const per = Math.floor(targetMs / segments.length);
  const remainder = targetMs - per * segments.length;
  return segments.map((s, idx) => ({
    ...s,
    durationMs: idx === segments.length - 1 ? per + remainder : per,
  }));
}

export type AdjustStrategy = "scale" | "trim-last" | "extend-last";

/**
 * Passt die Gesamtdauer der Segmente an `targetMs` an.
 *
 * - "scale":       skaliert proportional. Mindestens 1ms pro Segment.
 * - "trim-last":   kürzt das letzte Segment, bis die Summe passt. Falls
 *                  das letzte Segment alleine nicht reicht, werden die
 *                  vorherigen Segmente rückwärts ebenfalls gekürzt.
 *                  Wenn die aktuelle Summe < targetMs ist, wird das
 *                  letzte Segment verlängert.
 * - "extend-last": verlängert (oder kürzt notfalls) ausschließlich das
 *                  letzte Segment, sodass die Summe exakt `targetMs` ergibt.
 */
export function adjustToFit(
  segments: Segment[],
  targetMs: number,
  strategy: AdjustStrategy,
): Segment[] {
  if (segments.length === 0) {
    return [];
  }
  const safeTarget = Math.max(0, Math.round(targetMs));
  const cloned: Segment[] = segments.map((s) => ({ ...s }));
  const currentTotal = totalDurationMs(cloned);

  if (currentTotal === safeTarget) {
    return cloned;
  }

  switch (strategy) {
    case "scale": {
      if (currentTotal <= 0) {
        // Alle Segmente haben 0ms -> auf gleichmäßige Verteilung zurückfallen.
        return distributeEvenly(cloned, safeTarget);
      }
      const factor = safeTarget / currentTotal;
      let runningSum = 0;
      const scaled = cloned.map((s, idx) => {
        if (idx === cloned.length - 1) {
          // Restbetrag, damit die Summe exakt stimmt.
          const last = Math.max(1, safeTarget - runningSum);
          return { ...s, durationMs: last };
        }
        const d = Math.max(1, Math.round(s.durationMs * factor));
        runningSum += d;
        return { ...s, durationMs: d };
      });
      return scaled;
    }

    case "extend-last": {
      const lastIdx = cloned.length - 1;
      const others = cloned
        .slice(0, lastIdx)
        .reduce((acc, s) => acc + s.durationMs, 0);
      const last = Math.max(1, safeTarget - others);
      cloned[lastIdx] = { ...cloned[lastIdx], durationMs: last };
      return cloned;
    }

    case "trim-last": {
      let delta = safeTarget - currentTotal;
      if (delta >= 0) {
        // Wir müssen verlängern -> einfach an's letzte Segment hängen.
        const lastIdx = cloned.length - 1;
        cloned[lastIdx] = {
          ...cloned[lastIdx],
          durationMs: cloned[lastIdx].durationMs + delta,
        };
        return cloned;
      }
      // delta < 0 -> Wir müssen kürzen.
      let toRemove = -delta;
      for (let i = cloned.length - 1; i >= 0 && toRemove > 0; i--) {
        const current = cloned[i].durationMs;
        // Mindestens 1ms pro Segment behalten.
        const removable = Math.max(0, current - 1);
        const take = Math.min(removable, toRemove);
        cloned[i] = { ...cloned[i], durationMs: current - take };
        toRemove -= take;
      }
      return cloned;
    }

    default: {
      const _exhaustive: never = strategy;
      throw new Error(`Unknown adjust strategy: ${String(_exhaustive)}`);
    }
  }
}
