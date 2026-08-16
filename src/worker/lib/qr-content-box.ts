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
 * Lösung: Die Bounding-Box der DUNKLEN Pixel (Luminanz-Schwelle) ist die
 * Content-Box — dunkle Pixel, weil ein scanbarer QR immer dunkel sein
 * muss. Helle Deko zählt damit als Rand: weißer Hintergrund genauso wie
 * z. B. der Lavendel-Rahmen in Daniels Vorlage (ein Weiß-Trim scheiterte
 * genau daran, weil die Bildecken nicht weiß waren).
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
/** Pixel unterhalb dieser Luminanz zählen als QR-/Label-Inhalt.
 *  Schwarz ≈ 30, Lavendel-Rahmen ≈ 154, Weiß = 255. */
const DARK_LUMA = 120;
/** Analyse-Auflösung — Ratios sind auflösungsunabhängig. */
const ANALYZE_MAX_PX = 512;

/**
 * Ermittelt die Content-Box (dunkler Bildinhalt) des Platzhalter-
 * Artworks. Liefert null, wenn das Artwork randlos ist oder die Analyse
 * kein brauchbares Ergebnis liefert — der Caller nutzt dann wie bisher
 * die volle Platzhalter-Box.
 */
export async function analyzeQrPlaceholderArtwork(
  image: Buffer,
): Promise<ContentBoxRatios | null> {
  try {
    const { data, info } = await sharp(image)
      .flatten({ background: "#ffffff" })
      .resize({
        width: ANALYZE_MAX_PX,
        height: ANALYZE_MAX_PX,
        fit: "inside",
        withoutEnlargement: true,
      })
      .raw()
      .toBuffer({ resolveWithObject: true });
    const fullW = info.width;
    const fullH = info.height;
    if (fullW < 8 || fullH < 8) return null;

    let xMin = fullW;
    let yMin = fullH;
    let xMax = -1;
    let yMax = -1;
    for (let y = 0; y < fullH; y++) {
      for (let x = 0; x < fullW; x++) {
        const i = (y * fullW + x) * info.channels;
        const luma =
          0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
        if (luma < DARK_LUMA) {
          if (x < xMin) xMin = x;
          if (x > xMax) xMax = x;
          if (y < yMin) yMin = y;
          if (y > yMax) yMax = y;
        }
      }
    }
    if (xMax < 0 || yMax < 0) return null;

    const w = xMax - xMin + 1;
    const h = yMax - yMin + 1;
    const coverage = (w * h) / (fullW * fullH);
    if (coverage >= FULL_BOX_COVERAGE || coverage < MIN_COVERAGE) return null;

    return {
      left: xMin / fullW,
      top: yMin / fullH,
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
