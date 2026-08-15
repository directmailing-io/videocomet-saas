/**
 * Cursor-Overlay für die Worker-Render-Pipelines.
 *
 * Rastert den macOS-Pfeil (gemeinsame Quelle: `@/lib/segments/cursor-overlay`)
 * einmal pro Zielgröße zu PNG und berechnet pro Video-Frame die Pixel-
 * Position (inkl. Hotspot-Offset auf die Pfeilspitze). Interpolation ist
 * identisch zur Editor-Vorschau (`interpolateCursorPos`) — linear zwischen
 * den 50-ms-Samples, unsichtbar vor dem ersten, hold-last nach dem letzten.
 */

import sharp from "sharp";
import {
  CURSOR_HEIGHT_RATIO,
  CURSOR_HOTSPOT_X,
  CURSOR_HOTSPOT_Y,
  CURSOR_SVG,
} from "@/lib/segments/cursor-overlay";
import type { CursorFrame } from "@/lib/segments/types";

export interface CursorPng {
  buf: Buffer;
  width: number;
  height: number;
}

/** Pixel-Position der linken oberen Cursor-Ecke; null = unsichtbar. */
export type CursorPlacement = { left: number; top: number } | null;

const PNG_CACHE = new Map<number, Promise<CursorPng>>();

/** Cursor-PNG für die gegebene Viewport-Höhe (prozessweit gecached). */
export function getCursorPng(viewportHeight: number): Promise<CursorPng> {
  const height = Math.max(8, Math.round(viewportHeight * CURSOR_HEIGHT_RATIO));
  let entry = PNG_CACHE.get(height);
  if (!entry) {
    entry = (async () => {
      // Das SVG hat nur eine viewBox (28×28, quadratisch) — für sharp
      // explizite Pixelmaße ergänzen.
      const svg = CURSOR_SVG.replace(
        "<svg ",
        `<svg width="${height}" height="${height}" `,
      );
      const buf = await sharp(Buffer.from(svg)).png().toBuffer();
      return { buf, width: height, height };
    })();
    PNG_CACHE.set(height, entry);
    entry.catch(() => PNG_CACHE.delete(height));
  }
  return entry;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/**
 * Pro-Frame-Positionsplan des Cursors im Viewport.
 *
 * Spiegel der Editor-Vorschau-Interpolation, aber mit laufendem Index
 * statt Suche pro Frame (Muster `buildScrollPlanFromFrames`). Positionen
 * sind in die Bildgrenzen geclampt — sharp-composite erlaubt keine
 * negativen Offsets.
 */
export function buildCursorPlan(
  cursorFrames: CursorFrame[] | undefined,
  totalFrames: number,
  viewport: { width: number; height: number },
  fps: number,
  cursorSize: { width: number; height: number },
): CursorPlacement[] {
  const plan = new Array<CursorPlacement>(totalFrames).fill(null);
  if (!cursorFrames || cursorFrames.length === 0 || totalFrames <= 0) {
    return plan;
  }

  const sorted = [...cursorFrames].sort((a, b) => a.t - b.t);
  const last = sorted[sorted.length - 1];
  const frameIntervalMs = 1000 / fps;
  const maxLeft = Math.max(0, viewport.width - cursorSize.width);
  const maxTop = Math.max(0, viewport.height - cursorSize.height);

  let cursor = 0;
  for (let i = 0; i < totalFrames; i++) {
    const tFrame = i * frameIntervalMs;
    if (tFrame < sorted[0].t) continue; // unsichtbar vor dem ersten Sample

    let x: number;
    let y: number;
    if (tFrame >= last.t) {
      x = last.x;
      y = last.y;
    } else {
      while (cursor < sorted.length - 2 && sorted[cursor + 1].t <= tFrame) {
        cursor++;
      }
      const a = sorted[cursor];
      const b = sorted[cursor + 1];
      const span = b.t - a.t;
      const ratio = span <= 0 ? 0 : (tFrame - a.t) / span;
      x = a.x + (b.x - a.x) * ratio;
      y = a.y + (b.y - a.y) * ratio;
    }

    const left = Math.round(
      clamp01(x) * viewport.width - CURSOR_HOTSPOT_X * cursorSize.width,
    );
    const top = Math.round(
      clamp01(y) * viewport.height - CURSOR_HOTSPOT_Y * cursorSize.height,
    );
    plan[i] = {
      left: Math.max(0, Math.min(maxLeft, left)),
      top: Math.max(0, Math.min(maxTop, top)),
    };
  }
  return plan;
}
