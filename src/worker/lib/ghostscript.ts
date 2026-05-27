/**
 * Ghostscript PDF compression wrapper.
 *
 * Uses Ghostscript's standard `-dPDFSETTINGS=/<quality>` recipes:
 *   - `ebook`  -> medium quality, ~150 DPI images. Good for letters.
 *   - `screen` -> low quality, ~72 DPI images. Aggressive size cut.
 */

import { spawn } from "node:child_process";
import { stat } from "node:fs/promises";

export type GsQuality = "ebook" | "screen" | "printer" | "prepress";

function gsPath(): string {
  return process.env.GHOSTSCRIPT_PATH ?? "/usr/bin/gs";
}

export interface CompressPdfInput {
  inputPath: string;
  outputPath: string;
  quality: GsQuality;
}

export interface CompressPdfResult {
  originalSize: number;
  compressedSize: number;
}

/**
 * Compresses a PDF in-place via Ghostscript. Returns the original and final
 * file sizes (bytes) for logging/metrics.
 */
export async function compressPdf(
  input: CompressPdfInput,
): Promise<CompressPdfResult> {
  const before = await stat(input.inputPath);

  await new Promise<void>((resolve, reject) => {
    const args = [
      "-sDEVICE=pdfwrite",
      "-dCompatibilityLevel=1.4",
      `-dPDFSETTINGS=/${input.quality}`,
      "-dNOPAUSE",
      "-dQUIET",
      "-dBATCH",
      `-sOutputFile=${input.outputPath}`,
      input.inputPath,
    ];
    const child = spawn(gsPath(), args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderrTail = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderrTail = (stderrTail + chunk.toString("utf8")).slice(-2048);
      // eslint-disable-next-line no-console
      console.error(`[gs] ${chunk.toString("utf8").trimEnd()}`);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`[gs] exited with code ${code}: ${stderrTail}`));
    });
  });

  const after = await stat(input.outputPath);
  return {
    originalSize: before.size,
    compressedSize: after.size,
  };
}
