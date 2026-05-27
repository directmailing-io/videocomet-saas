/**
 * Stage 6: DOCX modification.
 *
 * Downloads the campaign's Google-Doc as a DOCX (via the public export
 * endpoint), replaces `{{...}}` text placeholders with values from the
 * lead's data row, and swaps the QR and Thumb marker images for the
 * per-lead PNG/JPG.
 *
 * Marker hashes are computed via `getMarkerSha256` (see
 * src/lib/marker-placeholders.ts) so DOCX templates created from
 * `/public/videocomet-{qr,thumb}-placeholder.png` are guaranteed to be
 * swappable.
 */

import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  loadDocx,
  replaceImageByHash,
  replacePlaceholders,
} from "../lib/docx";
import {
  generateMarkerPng,
  getMarkerSha256,
} from "@/lib/marker-placeholders";

export interface DocxModifyInput {
  outDir: string;
  googleDocsUrl: string;
  vars: Record<string, string>;
  qrPngPath: string | null;
  thumbJpgPath: string | null;
}

export interface DocxModifyOutput {
  docxPath: string;
}

/**
 * Extracts the Google-Docs document ID from any of the common URL forms:
 *   - https://docs.google.com/document/d/<ID>/edit
 *   - https://docs.google.com/document/d/<ID>/export?...
 *   - https://docs.google.com/document/d/<ID>
 */
export function extractGoogleDocId(url: string): string {
  const match = /\/document\/d\/([a-zA-Z0-9_-]+)/.exec(url);
  if (!match || !match[1]) {
    throw new Error(`[docx] unable to extract Google Doc ID from: ${url}`);
  }
  return match[1];
}

async function downloadDocx(docId: string, outPath: string): Promise<void> {
  const exportUrl = `https://docs.google.com/document/d/${docId}/export?format=docx`;
  const res = await fetch(exportUrl, { redirect: "follow" });
  if (!res.ok) {
    throw new Error(
      `[docx] download failed: ${res.status} ${res.statusText} (${exportUrl})`,
    );
  }
  const buf = Buffer.from(await res.arrayBuffer());
  await writeFile(outPath, buf);
}

export async function runDocxModify(
  input: DocxModifyInput,
): Promise<DocxModifyOutput> {
  const docId = extractGoogleDocId(input.googleDocsUrl);
  const srcPath = join(input.outDir, "template.docx");
  await downloadDocx(docId, srcPath);

  let { buffer } = await loadDocx(srcPath);

  // 1. Text placeholders.
  buffer = replacePlaceholders(buffer, input.vars);

  // 2. QR-Marker swap.
  if (input.qrPngPath) {
    const qrMarker = await generateMarkerPng("qr");
    const targetSha = getMarkerSha256(qrMarker);
    const qrBytes = await readFile(input.qrPngPath);
    buffer = replaceImageByHash(buffer, {
      targetSha256: targetSha,
      newImageBuffer: qrBytes,
    });
  }

  // 3. Thumb-Marker swap.
  if (input.thumbJpgPath) {
    const thumbMarker = await generateMarkerPng("thumb");
    const targetSha = getMarkerSha256(thumbMarker);
    const thumbBytes = await readFile(input.thumbJpgPath);
    buffer = replaceImageByHash(buffer, {
      targetSha256: targetSha,
      newImageBuffer: thumbBytes,
    });
  }

  const outPath = join(input.outDir, "letter.docx");
  await writeFile(outPath, buffer);
  return { docxPath: outPath };
}
