/**
 * WYSIWYG-Analyse des QR-Platzhalter-Artworks (Reklamation 2026-08-16).
 *
 * Problem: Kunden bauen als QR-Platzhalter oft ein Bild ein, das den
 * eigentlichen QR nur verkleinert enthält — mit weißem Rand und z. B.
 * einem "QR-Code"-Label darunter. Der generierte QR füllte bisher die
 * KOMPLETTE Platzhalter-Box und wirkte dadurch deutlich größer als in
 * der Vorlage ("Platzhalter muss exakt so sein, wie der QR-Code dann
 * auch").
 *
 * Lösung: Das Platzhalter-Bild wird per sharp-Trim analysiert — die
 * Bounding-Box der sichtbaren (nicht-weißen) Pixel ist die Content-Box.
 * Der echte QR wird als größtes Quadrat oben links in dieser Content-Box
 * platziert (Label-Zeilen unterhalb des QR fallen so automatisch weg)
 * und der Rest der Box bleibt weiß — der Brief sieht exakt aus wie die
 * Vorlage.
 *
 * Ist das Artwork bereits ein randloser QR (Content ≈ ganze Box), bleibt
 * alles beim alten Verhalten (null → Full-Box-QR).
 */

import sharp from "sharp";

export interface ContentBoxRatios {
  /** Alle Werte 0..1, relativ zur vollen Platzhalter-Box. */
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Ab dieser Flächen-Abdeckung gilt das Artwork als randlos → kein Padding. */
const FULL_BOX_COVERAGE = 0.88;
/** Unter dieser Abdeckung ist das Artwork vermutlich leer/kaputt → ignorieren. */
const MIN_COVERAGE = 0.02;
/** Weiß-Toleranz beim Trim (JPEG-Artefakte, Anti-Aliasing). */
const TRIM_THRESHOLD = 25;

/**
 * Ermittelt die Content-Box (sichtbarer Bildinhalt) des Platzhalter-
 * Artworks. Liefert null, wenn das Artwork randlos ist oder die Analyse
 * kein brauchbares Ergebnis liefert — der Caller nutzt dann wie bisher
 * die volle Platzhalter-Box.
 */
export async function analyzeQrPlaceholderArtwork(
  image: Buffer,
): Promise<ContentBoxRatios | null> {
  try {
    const meta = await sharp(image).metadata();
    const fullW = meta.width ?? 0;
    const fullH = meta.height ?? 0;
    if (fullW < 8 || fullH < 8) return null;

    const { info } = await sharp(image)
      .flatten({ background: "#ffffff" })
      .trim({ background: "#ffffff", threshold: TRIM_THRESHOLD })
      .toBuffer({ resolveWithObject: true });

    const left = Math.max(0, -(info.trimOffsetLeft ?? 0));
    const top = Math.max(0, -(info.trimOffsetTop ?? 0));
    const w = info.width;
    const h = info.height;
    if (!w || !h || w <= 0 || h <= 0) return null;

    const coverage = (w * h) / (fullW * fullH);
    if (coverage >= FULL_BOX_COVERAGE || coverage < MIN_COVERAGE) return null;

    return {
      left: left / fullW,
      top: top / fullH,
      width: w / fullW,
      height: h / fullH,
    };
  } catch {
    return null;
  }
}

export interface WysiwygQrRect {
  leftPt: number;
  topPt: number;
  sidePt: number;
}

/**
 * Größtes Quadrat oben links in der Content-Box, gerechnet im pt-Raum der
 * Platzhalter-Box (das Artwork kann im Doc verzerrt skaliert sein —
 * quadratisch muss der QR am Ende auf dem PAPIER sein, nicht im Pixel-
 * Raum des Artworks). "Oben links", weil Labels unter dem QR die
 * Content-Box nach unten verlängern — das Quadrat deckt dann exakt den
 * QR-Teil ab und das Label bleibt weiß.
 */
export function computeWysiwygQrRect(
  ratios: ContentBoxRatios,
  boxWidthPt: number,
  boxHeightPt: number,
): WysiwygQrRect {
  const wPt = ratios.width * boxWidthPt;
  const hPt = ratios.height * boxHeightPt;
  return {
    leftPt: ratios.left * boxWidthPt,
    topPt: ratios.top * boxHeightPt,
    sidePt: Math.min(wPt, hPt),
  };
}

/** Canvas-Breite (px) des gepaddeten QR-PNGs — reichlich für 300-DPI-Druck. */
const CANVAS_WIDTH_PX = 1000;

/**
 * Baut das WYSIWYG-QR-PNG: weiße Box im Seitenverhältnis der Platzhalter-
 * Box, mit dem echten QR an der Position/Größe des Vorlagen-Artworks.
 * Das Ergebnis wird 1:1 in die volle Platzhalter-Box gesetzt (replaceImage
 * beim Inline-Platzhalter, pdf-lib-Stamp beim Overlay) — dadurch stimmen
 * Layout, Position UND sichtbare QR-Größe exakt mit der Vorlage überein.
 */
export async function buildWysiwygQrPng(input: {
  qrPng: Buffer;
  ratios: ContentBoxRatios;
  boxWidthPt: number;
  boxHeightPt: number;
}): Promise<Buffer> {
  const { qrPng, ratios, boxWidthPt, boxHeightPt } = input;
  const canvasW = CANVAS_WIDTH_PX;
  const canvasH = Math.max(8, Math.round((canvasW * boxHeightPt) / boxWidthPt));
  const rect = computeWysiwygQrRect(ratios, boxWidthPt, boxHeightPt);

  // pt → Canvas-px (x und y skalieren unabhängig, damit das QR-Quadrat
  // nach dem Stretch in die pt-Box wieder quadratisch ist).
  const leftPx = Math.round((rect.leftPt / boxWidthPt) * canvasW);
  const topPx = Math.round((rect.topPt / boxHeightPt) * canvasH);
  const wPx = Math.max(8, Math.round((rect.sidePt / boxWidthPt) * canvasW));
  const hPx = Math.max(8, Math.round((rect.sidePt / boxHeightPt) * canvasH));

  const qrResized = await sharp(qrPng)
    .resize({ width: wPx, height: hPx, fit: "fill" })
    .png()
    .toBuffer();

  return sharp({
    create: {
      width: canvasW,
      height: canvasH,
      channels: 3,
      background: { r: 255, g: 255, b: 255 },
    },
  })
    .composite([{ input: qrResized, left: leftPx, top: topPx }])
    .png()
    .toBuffer();
}
