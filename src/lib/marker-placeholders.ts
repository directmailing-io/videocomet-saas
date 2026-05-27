/**
 * Deterministic placeholder markers for the PDF-letter pipeline.
 *
 *  - QR-Marker:    400x400 PNG, 4px lila border, white background,
 *                  "QR-Code" text in the center plus a coarse QR pattern hint.
 *  - Thumb-Marker: 640x360 PNG (16:9), 4px lila border, white background,
 *                  centered play triangle.
 *
 * Brand purple: #AA8CF5
 */

import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import sharp from "sharp";

export type MarkerType = "qr" | "thumb";

const BRAND_PURPLE = "#AA8CF5";
const BORDER_PX = 4;

const QR_SIZE = 400;
const THUMB_W = 640;
const THUMB_H = 360;

// Public asset paths
const QR_PUBLIC_PATH = "public/videocomet-qr-placeholder.png";
const THUMB_PUBLIC_PATH = "public/videocomet-thumb-placeholder.png";

/**
 * Builds the QR placeholder SVG.
 * Uses a fixed 8x8 grid of squares as a coarse QR-pattern hint so the
 * output is deterministic across runs.
 */
function qrSvg(): string {
  const w = QR_SIZE;
  const h = QR_SIZE;

  // Deterministic 8x8 pattern (1 = filled, 0 = empty).
  // Includes finder-style corners to read as a "QR-ish" pattern.
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

  const cell = 28; // px per cell -> 8 * 28 = 224
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
  <rect x="${BORDER_PX / 2}" y="${BORDER_PX / 2}" width="${w - BORDER_PX}" height="${h - BORDER_PX}" fill="none" stroke="${BRAND_PURPLE}" stroke-width="${BORDER_PX}"/>
  ${cells}
  <text x="${w / 2}" y="${labelY}" font-family="Inter, Arial, sans-serif" font-size="24" font-weight="600" fill="#222222" text-anchor="middle">QR-Code</text>
</svg>`;
}

/**
 * Builds the thumbnail placeholder SVG with a centered play triangle.
 */
function thumbSvg(): string {
  const w = THUMB_W;
  const h = THUMB_H;

  // Equilateral-ish play triangle pointing right, centered.
  const cx = w / 2;
  const cy = h / 2;
  const triSize = 96;
  const half = triSize / 2;

  // Points: left-top, left-bottom, right-middle
  const p1 = `${cx - half + 8},${cy - half}`;
  const p2 = `${cx - half + 8},${cy + half}`;
  const p3 = `${cx + half + 8},${cy}`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <rect x="0" y="0" width="${w}" height="${h}" fill="#FFFFFF"/>
  <rect x="${BORDER_PX / 2}" y="${BORDER_PX / 2}" width="${w - BORDER_PX}" height="${h - BORDER_PX}" fill="none" stroke="${BRAND_PURPLE}" stroke-width="${BORDER_PX}"/>
  <circle cx="${cx}" cy="${cy}" r="${triSize * 0.95}" fill="${BRAND_PURPLE}" fill-opacity="0.12"/>
  <polygon points="${p1} ${p2} ${p3}" fill="${BRAND_PURPLE}"/>
</svg>`;
}

/**
 * Generates a deterministic marker PNG buffer for the given type.
 */
export async function generateMarkerPng(type: MarkerType): Promise<Buffer> {
  const svg = type === "qr" ? qrSvg() : thumbSvg();
  return sharp(Buffer.from(svg, "utf8")).png({ compressionLevel: 9 }).toBuffer();
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
