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

  // Standard quiet zone is 4 modules on each side -> total = moduleCount + 8.
  // If the requested pixel size is smaller than even one pixel per module
  // (without quiet zone), the code is unrenderable at that resolution.
  if (sizePx < moduleCount) {
    throw new Error("QR-Größe zu klein");
  }

  // Black-on-white (Standard: schwarze Module auf weißem Hintergrund).
  return QRCode.toBuffer(url, {
    errorCorrectionLevel: "Q",
    type: "png",
    width: sizePx,
    margin: 4,
    color: {
      dark: "#000000FF", // module color -> black dots
      light: "#FFFFFFFF", // background -> white
    },
  });
}
