/**
 * Stage 7: DOCX -> PDF via LibreOffice.
 *
 * Thin wrapper over `convertDocxToPdf`. Kept as a separate processor so the
 * orchestrator can track its status independently from compression /
 * upload.
 */

import { convertDocxToPdf } from "../lib/libreoffice";

export interface DocxToPdfInput {
  docxPath: string;
  outDir: string;
}

export interface DocxToPdfOutput {
  pdfPath: string;
}

export async function runDocxToPdf(
  input: DocxToPdfInput,
): Promise<DocxToPdfOutput> {
  const pdfPath = await convertDocxToPdf({
    inputPath: input.docxPath,
    outputDir: input.outDir,
  });
  return { pdfPath };
}
