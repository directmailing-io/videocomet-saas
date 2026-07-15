/**
 * WYSIWYG-Anpassung des QR-Codes an den Template-Platzhalter.
 *
 * Docs' replaceImage rendert das Ersatzbild exakt in den Bounds des
 * Platzhalters. Kunden setzen als Platzhalter aber meist eine
 * Beispiel-Grafik, deren sichtbarer QR NICHT die volle Bildflaeche
 * fuellt (weisser Innenrand, Beschriftung). Ein randlos generierter QR
 * wirkt dann groesser als im Template gesetzt.
 *
 * Loesung: Wir vermessen die dunkle Innenflaeche des Platzhalter-Bilds
 * (Bounding-Box aller dunklen Pixel) und komponieren den echten QR auf
 * eine weisse Leinwand mit exakt derselben Geometrie. Full-Bleed-
 * Platzhalter (dunkle Flaeche >= ~92%) bleiben unveraendert randlos.
 */

import sharp from "sharp";

/** Untergrenze fuer die QR-Kantenlaenge relativ zum Platzhalter — ein
 * kleinerer QR waere gedruckt (~21mm-Box) unter ~9mm und schlecht
 * scanbar, egal was die Beispiel-Grafik zeigt. */
const MIN_SIDE_FRAC = 0.45;
/** Ab dieser Fuellung behandeln wir den Platzhalter als randlosen QR. */
const FULL_BLEED_FRAC = 0.92;
const MAX_CANVAS_PX = 1600;

interface DarkBbox {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  width: number;
  height: number;
}

async function measureDarkBbox(png: Buffer): Promise<DarkBbox | null> {
  const { data, info } = await sharp(png)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width: W, height: H, channels: ch } = info;
  let x0 = W;
  let x1 = -1;
  let y0 = H;
  let y1 = -1;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * ch;
      const alpha = ch === 4 ? data[i + 3] : 255;
      const lum = (data[i] + data[i + 1] + data[i + 2]) / 3;
      if (alpha > 128 && lum < 128) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) return null;
  return { x0, x1, y0, y1, width: W, height: H };
}

/**
 * Setzt den (randlosen, quadratischen) QR so auf eine weisse Leinwand,
 * dass er die dunkle Innenflaeche des Platzhalter-Bilds nachbildet.
 * Gibt bei Full-Bleed-Platzhaltern oder Analyse-Problemen den QR
 * unveraendert zurueck — der Aufrufer muss nichts unterscheiden.
 */
export async function fitQrToPlaceholder(
  qrPng: Buffer,
  placeholderPng: Buffer,
): Promise<Buffer> {
  let bbox: DarkBbox | null;
  try {
    bbox = await measureDarkBbox(placeholderPng);
  } catch {
    return qrPng;
  }
  if (!bbox) return qrPng;

  const { x0, x1, y0, y1, width: W, height: H } = bbox;
  const fracW = (x1 - x0 + 1) / W;
  const fracH = (y1 - y0 + 1) / H;
  if (Math.min(fracW, fracH) >= FULL_BLEED_FRAC) return qrPng;

  // QR ist quadratisch → Kantenlaenge = kleinere Bbox-Dimension,
  // relativ zur Leinwand (Leinwand behaelt die Platzhalter-Proportion).
  const sideFrac = Math.max(
    Math.min(fracW, (fracH * H) / W),
    MIN_SIDE_FRAC,
  );

  const qrMeta = await sharp(qrPng).metadata();
  const qrSide = qrMeta.width ?? 400;
  // Leinwand so waehlen, dass der QR in nativer Aufloesung (unskaliert,
  // scharfe Module) hineinpasst.
  const canvasW = Math.min(Math.round(qrSide / sideFrac), MAX_CANVAS_PX);
  const canvasH = Math.round((canvasW * H) / W);
  const side = Math.round(canvasW * sideFrac);

  const cx = ((x0 + x1 + 1) / 2 / W) * canvasW;
  const cy = ((y0 + y1 + 1) / 2 / H) * canvasH;
  const left = Math.max(0, Math.min(Math.round(cx - side / 2), canvasW - side));
  const top = Math.max(0, Math.min(Math.round(cy - side / 2), canvasH - side));

  const qrResized =
    side === qrSide
      ? qrPng
      : await sharp(qrPng).resize(side, side, { kernel: "nearest" }).toBuffer();

  return sharp({
    create: {
      width: canvasW,
      height: canvasH,
      channels: 3,
      background: { r: 255, g: 255, b: 255 },
    },
  })
    .composite([{ input: qrResized, left, top }])
    .png()
    .toBuffer();
}
