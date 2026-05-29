/**
 * PDF -> PNG sequence via Poppler's `pdftoppm`.
 *
 * Wir nutzen Poppler statt Ghostscript, weil pdftoppm robusterer Output
 * mit weniger Anti-Alias-Artefakten liefert — wichtig wenn das Bild im
 * Browser hochskaliert dargestellt wird.
 *
 * Hinweis zur Auflösung: 150 dpi ergibt ~1240 Pixel breit fuer ein
 * Letter-Format-PDF. Das matched den 1280px-Viewport fast pixelgenau und
 * sieht auf einem 1080p-Screen scharf aus, ohne dass die Frame-Erzeugung
 * explodiert.
 */

import { spawn } from "node:child_process";
import { readdir } from "node:fs/promises";
import { join } from "node:path";

const PDFTOPPM_PATH = process.env.PDFTOPPM_PATH ?? "/usr/bin/pdftoppm";

export interface PdfToPngOpts {
  /** Absolute path to the input PDF. */
  pdfPath: string;
  /** Directory the page PNGs are written into. Must exist. */
  outDir: string;
  /** Rasterisation DPI. Default 150 — good balance of sharpness vs. speed. */
  dpi?: number;
  /** Output prefix; defaults to "page". Files: `<prefix>-1.png`, `<prefix>-2.png`… */
  prefix?: string;
  /** Hard timeout in ms. Default 60s. */
  timeoutMs?: number;
}

export interface PdfToPngResult {
  /** Absolute paths to the produced PNGs, sorted by page number ascending. */
  pages: string[];
}

/**
 * Rasterises every page of a PDF to a PNG. Resolves with the produced paths
 * in page order. The caller is responsible for cleaning up `outDir`.
 */
export async function pdfToPng(opts: PdfToPngOpts): Promise<PdfToPngResult> {
  const dpi = opts.dpi ?? 150;
  const prefix = opts.prefix ?? "page";
  const timeoutMs = opts.timeoutMs ?? 60_000;
  const outPrefix = join(opts.outDir, prefix);

  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      PDFTOPPM_PATH,
      ["-png", "-r", String(dpi), opts.pdfPath, outPrefix],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    let stderr = "";
    child.stderr.on("data", (b: Buffer) => {
      stderr += b.toString("utf8");
    });
    const killer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`[pdf-to-image] pdftoppm timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    child.on("error", (err) => {
      clearTimeout(killer);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(killer);
      if (code !== 0) {
        reject(
          new Error(
            `[pdf-to-image] pdftoppm exited with code ${code}. stderr=${stderr.slice(0, 500)}`,
          ),
        );
        return;
      }
      resolve();
    });
  });

  // pdftoppm names files `page-1.png`, `page-2.png` (and pads when >9 pages).
  // We sort by extracted numeric suffix so order is exact regardless of padding.
  const entries = await readdir(opts.outDir);
  const matched: Array<{ idx: number; path: string }> = [];
  for (const e of entries) {
    if (!e.startsWith(prefix + "-") || !e.endsWith(".png")) continue;
    const rest = e.slice(prefix.length + 1, -".png".length);
    const idx = Number.parseInt(rest, 10);
    if (Number.isFinite(idx)) {
      matched.push({ idx, path: join(opts.outDir, e) });
    }
  }
  matched.sort((a, b) => a.idx - b.idx);
  return { pages: matched.map((m) => m.path) };
}
