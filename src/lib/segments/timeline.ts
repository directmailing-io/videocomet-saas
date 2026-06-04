/**
 * Helpers rund um Timeline-Positionen einzelner Segmente.
 *
 * Diese Datei kapselt die simple, aber an mehreren Stellen benötigte
 * Akkumulation der Segment-Dauern (z. B. fürs `<video>`-Seeking auf den
 * exakten Webcam-Zeitstempel eines Segments).
 *
 * Die Logik ist identisch zum vorherigen inline-Helper in
 * `preview-player.tsx` (`getSegmentStartMs`). Sie wird hier extrahiert,
 * damit sie auch der Scroll-Recorder + Webcam-Monitor wiederverwenden kann.
 */

import type { Segment } from "./types";

/**
 * Liefert die Start-Position (ms) eines Segments im Timeline-Verlauf.
 *
 * - Segmente vor `index` werden aufaddiert.
 * - Negative `durationMs` werden defensiv auf 0 geclampt.
 * - `index` darf größer als `segments.length` sein → es werden alle Segmente
 *   aufaddiert (Total-Dauer).
 * - `index <= 0` → Rückgabe 0.
 */
export function segmentStartMs(segments: Segment[], index: number): number {
  let acc = 0;
  for (let i = 0; i < index && i < segments.length; i++) {
    acc += Math.max(0, segments[i].durationMs | 0);
  }
  return acc;
}
