/**
 * Scroll-Mathematik für Sequenz-Vorschau und Auto-Scroll.
 *
 * `interpolateScrollRatio` spiegelt exakt den Interpolations-Algorithmus des
 * Worker-Renders (`buildScrollPlanFromFrames` in
 * worker/lib/website-render-pipeline.ts und worker/lib/personalized-gdocs.ts):
 * lineare Interpolation zwischen zeitsortierten Frames, vor dem ersten Frame
 * dessen y, nach dem letzten dessen y. So ist die Editor-Vorschau
 * deckungsgleich mit dem gerenderten Video.
 */

import type { ScrollFrame } from "./types";

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/**
 * Vertikale Scroll-Position (0..1) zum Zeitpunkt `tMs` innerhalb des
 * Segments. Ohne Frames: 0 (entspricht static-hero).
 */
export function interpolateScrollRatio(
  scrollFrames: ScrollFrame[] | undefined,
  tMs: number,
): number {
  if (!scrollFrames || scrollFrames.length === 0) return 0;
  const sorted = [...scrollFrames].sort((a, b) => a.t - b.t);
  if (tMs <= sorted[0].t) return clamp01(sorted[0].y);
  const last = sorted[sorted.length - 1];
  if (tMs >= last.t) return clamp01(last.y);
  let cursor = 0;
  while (cursor < sorted.length - 2 && sorted[cursor + 1].t <= tMs) {
    cursor++;
  }
  const a = sorted[cursor];
  const b = sorted[cursor + 1];
  const span = b.t - a.t;
  const ratio = span <= 0 ? 0 : (tMs - a.t) / span;
  return clamp01(a.y + (b.y - a.y) * ratio);
}

export type AutoScrollStyle = "linear" | "paged";

export interface AutoScrollOptions {
  style: AutoScrollStyle;
  /** Nur für "paged": Anzahl der Seiten/Stopps (>= 1). */
  pageCount?: number;
  /** Ruhephase am Anfang, bevor gescrollt wird (default 800 ms). */
  leadInMs?: number;
  /** Ruhephase am Ende auf der letzten Position (default 800 ms). */
  leadOutMs?: number;
}

/**
 * Generiert ScrollFrames für einen automatischen Scroll über die gesamte
 * Segmentdauer — für Nutzer, die keine manuelle Aufnahme machen wollen.
 *
 * - "linear": gleichmäßig von oben (0) nach unten (1).
 * - "paged":  seitenweises Blättern mit kurzen Stopps pro Seite
 *             (Übergang = 20 % der Verweildauer, wirkt wie bewusstes Weiterblättern).
 */
export function buildAutoScrollFrames(
  durationMs: number,
  opts: AutoScrollOptions,
): ScrollFrame[] {
  const leadIn = Math.max(0, opts.leadInMs ?? 800);
  const leadOut = Math.max(0, opts.leadOutMs ?? 800);
  const total = Math.max(1, Math.round(durationMs));
  const scrollSpan = Math.max(0, total - leadIn - leadOut);

  if (scrollSpan <= 0) {
    return [
      { t: 0, y: 0 },
      { t: total, y: 0 },
    ];
  }

  if (opts.style === "linear" || (opts.pageCount ?? 1) <= 1) {
    return [
      { t: 0, y: 0 },
      { t: leadIn, y: 0 },
      { t: leadIn + scrollSpan, y: 1 },
      { t: total, y: 1 },
    ];
  }

  const pages = Math.max(2, Math.round(opts.pageCount ?? 2));
  const frames: ScrollFrame[] = [{ t: 0, y: 0 }];
  // Pro Seite ein Verweil-Slot; der Übergang zur nächsten Seite belegt die
  // letzten 20 % des Slots.
  const slot = scrollSpan / pages;
  const transition = slot * 0.2;
  for (let p = 0; p < pages; p++) {
    const y = p / (pages - 1);
    const slotStart = leadIn + p * slot;
    frames.push({ t: slotStart, y });
    if (p < pages - 1) {
      frames.push({ t: slotStart + slot - transition, y });
    }
  }
  frames.push({ t: total, y: 1 });
  return frames;
}
