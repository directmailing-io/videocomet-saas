/**
 * Deterministic placeholder markers for the PDF-letter pipeline.
 *
 *  - QR-Marker:    400x400 PNG — ein ECHTER, randloser QR-Code (margin 0).
 *                  Der Platzhalter ist damit 1:1 das, was später gedruckt
 *                  wird: der Lead-QR ersetzt ihn exakt in Boxgröße, ohne
 *                  Rand oder Padding.
 *  - Thumb-Marker: 640x360 PNG (16:9), randlos — helle Fläche mit
 *                  Play-Button. Das Video-Thumbnail (1280x720) ersetzt die
 *                  Box formatgleich, ohne Verzerrung.
 *
 * WICHTIG: Die alten Marker-Designs (weiße Box, 4px Lila-Rahmen, Label)
 * bleiben als LEGACY-Varianten erhalten — ihre SHA-256-Hashes müssen beim
 * Doc-Scan und im DOCX-Worker weiter matchen, sonst werden bestehende
 * Kunden-Vorlagen nicht mehr erkannt.
 */

import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import sharp from "sharp";
import { generateQrPng } from "./qr";

export type MarkerType = "qr" | "thumb";

const BRAND_PURPLE = "#AA8CF5";
const CANVAS_BG = "#f3f2f9";

const QR_SIZE = 400;
const THUMB_W = 640;
const THUMB_H = 360;

/** Payload des Beispiel-QRs im Marker (deterministisch). */
const QR_MARKER_URL = "https://videocomet.de";

// Public asset paths
const QR_PUBLIC_PATH = "public/videocomet-qr-placeholder.png";
const THUMB_PUBLIC_PATH = "public/videocomet-thumb-placeholder.png";

/**
 * Thumbnail-Marker: randlos, volle Fläche — heller Canvas-Grund mit
 * Play-Button in Markenfarbe.
 */
function thumbSvg(): string {
  const w = THUMB_W;
  const h = THUMB_H;
  const cx = w / 2;
  const cy = h / 2;
  const triSize = 96;
  const half = triSize / 2;

  const p1 = `${cx - half + 8},${cy - half}`;
  const p2 = `${cx - half + 8},${cy + half}`;
  const p3 = `${cx + half + 8},${cy}`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <rect x="0" y="0" width="${w}" height="${h}" fill="${CANVAS_BG}"/>
  <circle cx="${cx}" cy="${cy}" r="${triSize * 0.95}" fill="${BRAND_PURPLE}" fill-opacity="0.18"/>
  <polygon points="${p1} ${p2} ${p3}" fill="${BRAND_PURPLE}"/>
</svg>`;
}

/**
 * Generates a deterministic marker PNG buffer for the given type.
 */
export async function generateMarkerPng(type: MarkerType): Promise<Buffer> {
  if (type === "qr") {
    return generateQrPng(QR_MARKER_URL, QR_SIZE);
  }
  return sharp(Buffer.from(thumbSvg(), "utf8"))
    .png({ compressionLevel: 9 })
    .toBuffer();
}

/* ── Legacy-Marker (Design bis 2026-08-16) ───────────────────────────────
 * Nur für Hash-Kompatibilität: bestehende Vorlagen enthalten noch diese
 * PNGs. Die SVGs sind verbatim das alte Design (weiße Box, 4px Rahmen,
 * QR-Hint-Grid + "QR-Code"-Label bzw. Play-Kreis). Nicht ändern — jede
 * Byte-Änderung bricht die Wiedererkennung.
 */

const LEGACY_BORDER_PX = 4;

function legacyQrSvg(): string {
  const w = QR_SIZE;
  const h = QR_SIZE;

  const pattern: ReadonlyArray<ReadonlyArray<number>> = [
    [1, 1, 1, 1, 0, 1, 1, 1],
    [1, 0, 0, 1, 1, 1, 0, 1],
    [1, 0, 1, 0, 0, 0, 0, 1],
    [1, 1, 0, 1, 1, 0, 1, 0],
    [0, 0, 1, 1, 0, 1, 0, 1],
    [1, 0, 0, 0, 1, 1, 1, 0],
    [1, 0, 1, 1, 0, 0, 0, 1],
    [1, 1, 1, 0, 1, 1, 1, 1],
  ];

  const cell = 28;
  const gridSize = cell * pattern.length;
  const gridX = Math.round((w - gridSize) / 2);
  const gridY = Math.round((h - gridSize) / 2) - 18;

  let cells = "";
  for (let r = 0; r < pattern.length; r += 1) {
    for (let c = 0; c < pattern[r].length; c += 1) {
      if (pattern[r][c] === 1) {
        const x = gridX + c * cell;
        const y = gridY + r * cell;
        cells += `<rect x="${x}" y="${y}" width="${cell}" height="${cell}" fill="#222222"/>`;
      }
    }
  }

  const labelY = gridY + gridSize + 36;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <rect x="0" y="0" width="${w}" height="${h}" fill="#FFFFFF"/>
  <rect x="${LEGACY_BORDER_PX / 2}" y="${LEGACY_BORDER_PX / 2}" width="${w - LEGACY_BORDER_PX}" height="${h - LEGACY_BORDER_PX}" fill="none" stroke="${BRAND_PURPLE}" stroke-width="${LEGACY_BORDER_PX}"/>
  ${cells}
  <text x="${w / 2}" y="${labelY}" font-family="Inter, Arial, sans-serif" font-size="24" font-weight="600" fill="#222222" text-anchor="middle">QR-Code</text>
</svg>`;
}

function legacyThumbSvg(): string {
  const w = THUMB_W;
  const h = THUMB_H;
  const cx = w / 2;
  const cy = h / 2;
  const triSize = 96;
  const half = triSize / 2;

  const p1 = `${cx - half + 8},${cy - half}`;
  const p2 = `${cx - half + 8},${cy + half}`;
  const p3 = `${cx + half + 8},${cy}`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <rect x="0" y="0" width="${w}" height="${h}" fill="#FFFFFF"/>
  <rect x="${LEGACY_BORDER_PX / 2}" y="${LEGACY_BORDER_PX / 2}" width="${w - LEGACY_BORDER_PX}" height="${h - LEGACY_BORDER_PX}" fill="none" stroke="${BRAND_PURPLE}" stroke-width="${LEGACY_BORDER_PX}"/>
  <circle cx="${cx}" cy="${cy}" r="${triSize * 0.95}" fill="${BRAND_PURPLE}" fill-opacity="0.12"/>
  <polygon points="${p1} ${p2} ${p3}" fill="${BRAND_PURPLE}"/>
</svg>`;
}

async function generateLegacyMarkerPng(type: MarkerType): Promise<Buffer> {
  const svg = type === "qr" ? legacyQrSvg() : legacyThumbSvg();
  return sharp(Buffer.from(svg, "utf8")).png({ compressionLevel: 9 }).toBuffer();
}

/**
 * Alle gültigen Marker-Hashes für einen Typ: aktuelles Design zuerst,
 * dann Legacy. Scan/Worker matchen gegen ALLE, damit alte Vorlagen
 * weiter funktionieren.
 */
export async function getMarkerShas(type: MarkerType): Promise<string[]> {
  const [current, legacy] = await Promise.all([
    generateMarkerPng(type),
    generateLegacyMarkerPng(type),
  ]);
  return [getMarkerSha256(current), getMarkerSha256(legacy)];
}

/**
 * SHA-256 hex digest of a buffer.
 * Used to verify that placeholder markers in source DOCX files match the
 * known reference assets.
 */
export function getMarkerSha256(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

/**
 * Writes both markers into the project's /public folder.
 * Paths are resolved relative to process.cwd().
 */
export async function writeMarkersToPublic(): Promise<{
  qrPath: string;
  thumbPath: string;
  qrSha256: string;
  thumbSha256: string;
}> {
  const cwd = process.cwd();
  const qrPath = resolve(cwd, QR_PUBLIC_PATH);
  const thumbPath = resolve(cwd, THUMB_PUBLIC_PATH);

  const [qrBuf, thumbBuf] = await Promise.all([
    generateMarkerPng("qr"),
    generateMarkerPng("thumb"),
  ]);

  await mkdir(dirname(qrPath), { recursive: true });
  await mkdir(dirname(thumbPath), { recursive: true });

  await Promise.all([writeFile(qrPath, qrBuf), writeFile(thumbPath, thumbBuf)]);

  return {
    qrPath,
    thumbPath,
    qrSha256: getMarkerSha256(qrBuf),
    thumbSha256: getMarkerSha256(thumbBuf),
  };
}
