/**
 * PPTX → PNG-Sequenz via LibreOffice + pdftoppm.
 *
 * Zwei-Schritt-Pipeline:
 *   1. `libreoffice --headless --convert-to pdf` rendert das PPTX als PDF.
 *      LibreOffice's eigenes `--convert-to png` produziert nur die ERSTE
 *      Folie, deshalb dieser Umweg.
 *   2. `pdftoppm -png -r <dpi> <pdf> <prefix>` rastert jede PDF-Seite als
 *      PNG. Reihenfolge entspricht der Folien-Reihenfolge im Deck.
 *
 * Wird sowohl im **App-Container** (für Import-Thumbnails) als auch im
 * **Worker-Container** (für Lead-Renders) benutzt. Beide Container müssen
 * `libreoffice-impress` + `poppler-utils` installiert haben.
 *
 * Defensive-Verhalten:
 *   - Wenn LibreOffice/Poppler nicht installiert sind, wirft die Funktion
 *     einen klar erkennbaren Fehler — der Caller fängt das ab und liefert
 *     einen Black-Clip / null-Thumbnail.
 *   - Pro Render eigenes /tmp-Working-Dir, das nach Erfolg/Fehler komplett
 *     entsorgt wird (vermeidet /tmp-Müll bei Massen-Runs).
 */

import { mkdir, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface RenderPptxToPngsOptions {
  /** Der PPTX-Buffer (ggf. schon substituiert). */
  pptxBuf: Buffer;
  /**
   * Ziel-Verzeichnis für die PNGs. Wird angelegt, wenn nicht vorhanden.
   * Der Caller ist für das Aufräumen verantwortlich.
   */
  outputDir: string;
  /** DPI für die PDF-Rasterung. Default: 150 (≈ 1280px breit für 16:9). */
  dpi?: number;
  /** Hard-Timeout für die LibreOffice-Konversion in ms. Default: 90 s. */
  timeoutMs?: number;
}

export interface RenderPptxToPngsResult {
  /** Absolute Pfade der PNGs in Folien-Reihenfolge. */
  pngPaths: string[];
}

/**
 * Rendert einen PPTX-Buffer komplett als PNG-Sequenz. Liefert pro Folie
 * eine PNG-Datei.
 *
 * Wirft, wenn LibreOffice oder Poppler crashen — Caller fängt das ab.
 */
export async function renderPptxToPngs(
  opts: RenderPptxToPngsOptions,
): Promise<RenderPptxToPngsResult> {
  await mkdir(opts.outputDir, { recursive: true });

  // Eigene Arbeits-Sandbox: PPTX-Schreiben + PDF-Output landen hier und
  // werden am Ende restlos entsorgt.
  const workDir = join(tmpdir(), `pptx-render-${randomUUID()}`);
  await mkdir(workDir, { recursive: true });

  try {
    // 1) PPTX auf Disk schreiben — LibreOffice arbeitet rein file-basiert.
    const pptxPath = join(workDir, "deck.pptx");
    await writeFile(pptxPath, opts.pptxBuf);

    // 2) LibreOffice → PDF.
    const { convertPptxToPdf } = await import("@/worker/lib/libreoffice");
    const pdfPath = await convertPptxToPdf({
      inputPath: pptxPath,
      outputDir: workDir,
      timeoutMs: opts.timeoutMs ?? 90_000,
    });

    // 3) Poppler → PNGs.
    const { pdfToPng } = await import("@/worker/lib/pdf-to-image");
    const pngResult = await pdfToPng({
      pdfPath,
      outDir: opts.outputDir,
      dpi: opts.dpi ?? 150,
      prefix: "slide",
      timeoutMs: opts.timeoutMs ?? 90_000,
    });

    return { pngPaths: pngResult.pages };
  } finally {
    // Sandbox restlos entsorgen. Best-effort; der OS-tmp-Cleanup räumt
    // ohnehin nach Reboot.
    await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
  }
}
