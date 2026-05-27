/**
 * Stage 4: QR-Code generation.
 *
 * Generates a PNG QR-Code pointing at the lead's landingpage URL.
 * Skipped when the campaign has `pdfQrEnabled = false`.
 */

import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { generateQrPng } from "@/lib/qr";

export interface QrGenerateInput {
  outDir: string;
  pageUrl: string;
  enabled: boolean;
  sizePx?: number;
}

export interface QrGenerateOutput {
  qrPngPath: string | null;
  skipped: boolean;
}

/**
 * Returns the path of the QR PNG on disk, or { skipped: true } if disabled
 * for this campaign.
 */
export async function runQrGenerate(
  input: QrGenerateInput,
): Promise<QrGenerateOutput> {
  if (!input.enabled) {
    return { qrPngPath: null, skipped: true };
  }
  const size = input.sizePx ?? 400;
  const png = await generateQrPng(input.pageUrl, size);
  const outPath = join(input.outDir, "qr.png");
  await writeFile(outPath, png);
  return { qrPngPath: outPath, skipped: false };
}
