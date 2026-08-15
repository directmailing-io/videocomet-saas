/**
 * Cursor-Overlay — gemeinsame Quelle für Mauszeiger-Aufnahmen (Studio).
 *
 * Das Studio zeichnet während der Live-Aufnahme die Mausposition über der
 * Bühne als normierte `{t, x, y}`-Samples auf (x/y in 0..1 des 16:9-
 * Bildausschnitts). Editor-Vorschau und Worker-Render zeigen daraus einen
 * macOS-Pfeil-Cursor, der zwischen den Samples linear interpoliert wird —
 * dieselbe Interpolation wie beim Scroll (`interpolateScrollRatio`), damit
 * Vorschau und fertiges Video deckungsgleich sind.
 *
 * Sichtbarkeits-Semantik:
 *   - VOR dem ersten Sample ist der Cursor unsichtbar (Szene ohne
 *     Mausbewegung = gar kein Cursor, wie bisher).
 *   - NACH dem letzten Sample bleibt er auf der letzten Position stehen.
 */

import type { CursorFrame } from "./types";

/**
 * Original-Asset: klassischer macOS-Pfeil (28×28-ViewBox, schwarz mit
 * weißem Rand). Quelle: /Users/kurzeja/Downloads/cursor.svg.
 */
export const CURSOR_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 28 28"><polygon fill="#FFFFFF" points="8.2,20.9 8.2,4.9 19.8,16.5 13,16.5 12.6,16.6"/><polygon fill="#FFFFFF" points="17.3,21.6 13.7,23.1 9,12 12.7,10.5"/><rect x="12.5" y="13.6" transform="matrix(0.9221 -0.3871 0.3871 0.9221 -5.7605 6.5909)" width="2" height="8"/><polygon points="9.2,7.3 9.2,18.5 12.2,15.6 12.6,15.5 17.4,15.5"/></svg>`;

export const CURSOR_SVG_DATA_URI = `data:image/svg+xml;utf8,${encodeURIComponent(
  CURSOR_SVG,
)}`;

/**
 * Cursor-Höhe als Anteil der Bühnenhöhe. 22 px bei 720p entspricht der
 * echten macOS-Cursor-Größe — bewusst dezent („nicht zu groß").
 */
export const CURSOR_HEIGHT_RATIO = 22 / 720;

/**
 * Hotspot (Pfeilspitze) als Anteil der Cursor-Grafik: die Spitze liegt im
 * 28×28-ViewBox bei (8.2, 4.9). Die Grafik wird so verschoben, dass die
 * Spitze exakt auf der aufgezeichneten Mausposition sitzt.
 */
export const CURSOR_HOTSPOT_X = 8.2 / 28;
export const CURSOR_HOTSPOT_Y = 4.9 / 28;

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/**
 * Cursor-Position (normiert 0..1) zum Zeitpunkt `tMs` innerhalb des
 * Segments. `null` = Cursor (noch) unsichtbar.
 */
export function interpolateCursorPos(
  cursorFrames: CursorFrame[] | undefined,
  tMs: number,
): { x: number; y: number } | null {
  if (!cursorFrames || cursorFrames.length === 0) return null;
  const sorted = [...cursorFrames].sort((a, b) => a.t - b.t);
  if (tMs < sorted[0].t) return null;
  const last = sorted[sorted.length - 1];
  if (tMs >= last.t) return { x: clamp01(last.x), y: clamp01(last.y) };
  let cursor = 0;
  while (cursor < sorted.length - 2 && sorted[cursor + 1].t <= tMs) {
    cursor++;
  }
  const a = sorted[cursor];
  const b = sorted[cursor + 1];
  const span = b.t - a.t;
  const ratio = span <= 0 ? 0 : (tMs - a.t) / span;
  return {
    x: clamp01(a.x + (b.x - a.x) * ratio),
    y: clamp01(a.y + (b.y - a.y) * ratio),
  };
}
