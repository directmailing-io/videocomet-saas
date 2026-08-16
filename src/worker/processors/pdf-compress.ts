/**
 * Stage 8: PDF compression.
 *
 * Uses Ghostscript with `-dPDFSETTINGS=/printer` (~300 DPI images).
 * Briefe werden physisch GEDRUCKT — das frühere `/ebook` (150 DPI) hat
 * Video-Thumbnail und gestempelten QR sichtbar verpixelt (Reklamation
 * 2026-08-16: 1280px-Frame wurde auf 455px runtergerechnet).
 *
 * If the compressed file ends up LARGER than the original (rare, but
 * happens for very small PDFs), we keep the original.
 */

import { copyFile } from "node:fs/promises";
import { join } from "node:path";
import { compressPdf, type GsQuality } from "../lib/ghostscript";

export interface PdfCompressInput {
  pdfPath: string;
  outDir: string;
  quality?: GsQuality;
}

export interface PdfCompressOutput {
  pdfPath: string;
  originalSize: number;
  compressedSize: number;
}

export async function runPdfCompress(
  input: PdfCompressInput,
): Promise<PdfCompressOutput> {
  const quality = input.quality ?? "printer";
  const compressedPath = join(input.outDir, "letter-compressed.pdf");

  const result = await compressPdf({
    inputPath: input.pdfPath,
    outputPath: compressedPath,
    quality,
  });

  if (result.compressedSize >= result.originalSize) {
    // Compression made it bigger — keep the original.
    await copyFile(input.pdfPath, compressedPath);
    return {
      pdfPath: compressedPath,
      originalSize: result.originalSize,
      compressedSize: result.originalSize,
    };
  }
  return {
    pdfPath: compressedPath,
    originalSize: result.originalSize,
    compressedSize: result.compressedSize,
  };
}
