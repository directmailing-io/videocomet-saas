/**
 * QR-Code generation.
 *
 * Produces a PNG buffer with black modules on a white background using
 * `qrcode` with error-correction
 * level Q. The PNG is rendered at exactly `sizePx` pixels (square).
 *
 * If `sizePx` is smaller than the QR code's minimum required size for the
 * given URL length (i.e. one module per pixel would already not fit), an
 * Error with message "QR-Größe zu klein" is thrown.
 */

import QRCode from "qrcode";

export async function generateQrPng(
  url: string,
  sizePx: number,
): Promise<Buffer> {
  if (!Number.isFinite(sizePx) || sizePx <= 0) {
    throw new Error("QR-Größe zu klein");
  }

  // Determine minimum module count for this payload at EC level Q.
  // QRCode.create() picks the smallest version that fits and gives us
  // the resulting matrix size (modules per side).
  const qr = QRCode.create(url, { errorCorrectionLevel: "Q" });
  const moduleCount = qr.modules.size;

  // If the requested pixel size is smaller than even one pixel per module,
  // the code is unrenderable at that resolution.
  if (sizePx < moduleCount) {
    throw new Error("QR-Größe zu klein");
  }

  // Black-on-white (Standard: schwarze Module auf weißem Hintergrund).
  // margin: 0 — KEINE eingebackene Quiet-Zone. Der QR wird 1:1 in einen
  // Platzhalter im Brief-Template eingesetzt (Docs replaceImage behaelt die
  // Platzhalter-Groesse bei); ein weisser Rand im PNG wuerde bei floating
  // Platzhaltern (IN_FRONT_OF_TEXT) den umliegenden Text verdecken. Die
  // Quiet-Zone liefert das weisse Briefpapier rund um den Platzhalter.
  return QRCode.toBuffer(url, {
    errorCorrectionLevel: "Q",
    type: "png",
    width: sizePx,
    margin: 0,
    color: {
      dark: "#000000FF", // module color -> black dots
      light: "#FFFFFFFF", // background -> white
    },
  });
}
