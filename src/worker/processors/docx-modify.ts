/**
 * Stage 6: DOCX modification.
 *
 * Downloads the campaign's Google-Doc as a DOCX (via the public export
 * endpoint, cached 5 min), replaces `{{...}}` text placeholders with
 * values from the lead's data row, and swaps the QR and Thumb marker
 * images for the per-lead PNG/JPG.
 *
 * Marker hashes are computed once via `getMarkerSha256` and memoised in
 * module-scope so every Run only pays the cost once.
 */

import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  loadDocx,
  replaceImageByHash,
  replacePlaceholders,
  saveDocx,
} from "../lib/docx";
import { fetchGoogleDocAsDocx } from "../lib/google-docs";
import {
  generateMarkerPng,
  getMarkerSha256,
} from "@/lib/marker-placeholders";

export interface DocxModifyInput {
  outDir: string;
  googleDocsUrl: string;
  /**
   * Raw `{{key}}` -> value map. Typically `lead.data` from the run upload,
   * extended with auto-derived fields (`landingpageUrl`, `firstName`,
   * `lastName`) by the pipeline orchestrator before calling this stage.
   */
  vars: Record<string, string>;
  qrPngPath: string | null;
  thumbJpgPath: string | null;
}

export interface DocxModifyOutput {
  docxPath: string;
  /** true when at least one media file matched the QR marker hash. */
  qrReplaced: boolean;
  /** true when at least one media file matched the thumb marker hash. */
  thumbReplaced: boolean;
}

/**
 * Module-level cache of marker SHA-256 hashes.
 * The marker PNGs are deterministic (see src/lib/marker-placeholders.ts),
 * so the hash is the same across every worker job and we only need to
 * generate the markers once per worker process.
 */
let cachedQrSha: string | null = null;
let cachedThumbSha: string | null = null;

async function getQrMarkerSha(): Promise<string> {
  if (cachedQrSha) return cachedQrSha;
  const buf = await generateMarkerPng("qr");
  cachedQrSha = getMarkerSha256(buf);
  return cachedQrSha;
}

async function getThumbMarkerSha(): Promise<string> {
  if (cachedThumbSha) return cachedThumbSha;
  const buf = await generateMarkerPng("thumb");
  cachedThumbSha = getMarkerSha256(buf);
  return cachedThumbSha;
}

/** Test-only helper: wipe memoised marker hashes. */
export function _clearMarkerHashCache(): void {
  cachedQrSha = null;
  cachedThumbSha = null;
}

export async function runDocxModify(
  input: DocxModifyInput,
): Promise<DocxModifyOutput> {
  // 1. Fetch DOCX from Google (cached 5 min in google-docs lib).
  const docxBuffer = await fetchGoogleDocAsDocx(input.googleDocsUrl);

  // 2. Open ZIP once; all mutations operate on the same handle.
  const { zip } = loadDocx(docxBuffer);

  // 3. Text placeholders.
  replacePlaceholders(zip, input.vars);

  // 4. QR-Marker swap. Dimensions-Fallback (400x400) faengt die Faelle ab,
  //    in denen Google Docs das PNG beim Einfuegen re-encoded hat.
  let qrReplaced = false;
  if (input.qrPngPath) {
    const targetSha = await getQrMarkerSha();
    const qrBytes = await readFile(input.qrPngPath);
    qrReplaced = replaceImageByHash(zip, {
      targetSha256: targetSha,
      newImageBuffer: qrBytes,
      contentType: "image/png",
      matchDimensions: { width: 400, height: 400 },
    });
  }

  // 5. Thumb-Marker swap. Dimensions-Fallback (640x360).
  let thumbReplaced = false;
  if (input.thumbJpgPath) {
    const targetSha = await getThumbMarkerSha();
    const thumbBytes = await readFile(input.thumbJpgPath);
    thumbReplaced = replaceImageByHash(zip, {
      targetSha256: targetSha,
      newImageBuffer: thumbBytes,
      contentType: "image/jpeg",
      matchDimensions: { width: 640, height: 360 },
    });
  }

  // 6. Serialise + write to outDir.
  const outBuffer = saveDocx(zip);
  const outPath = join(input.outDir, "letter.docx");
  await writeFile(outPath, outBuffer);

  return { docxPath: outPath, qrReplaced, thumbReplaced };
}
