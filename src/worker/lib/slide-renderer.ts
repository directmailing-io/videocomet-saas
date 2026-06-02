/**
 * Worker-Renderer für `kind: "slide"`.
 *
 * Bühne 1280×720, ein einziger Screenshot pro Folie pro Lead, dann mit
 * FFmpeg als Loop auf die gewünschte Dauer gestreckt. Das passt zum
 * bestehenden Pipeline-Modell, wo jedes Segment eine eigene MP4-Datei
 * produziert die anschließend konkateniert wird.
 */

import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  SLIDE_STAGE_HEIGHT,
  SLIDE_STAGE_WIDTH,
  type SlideSegment,
} from "../../lib/segments/types";
import { SlideRender } from "../../lib/slide/slide-render";
import { buildGoogleFontsCssUrl, extractFontFamilies } from "../../lib/slide/google-fonts-css";
import { getContext } from "./browser-pool";

export interface RenderSlideToPngOptions {
  slide: SlideSegment;
  leadData: Record<string, string>;
  outputPath: string;
}

/**
 * Rendert eine Folie als 1280×720-PNG.
 *
 * Schritte:
 *   1. SlideRender → static HTML (ohne window/document Globals)
 *   2. Sammle alle font-families aus den Text-Layern, baue einen einzigen
 *      Google-Fonts-CSS-Link
 *   3. Wrappe in eine vollständige HTML-Page
 *   4. Puppeteer: page.setContent → wait for fonts → screenshot
 */
export async function renderSlideToPng(
  opts: RenderSlideToPngOptions,
): Promise<void> {
  await mkdir(dirname(opts.outputPath), { recursive: true });

  // 1. React → HTML
  const bodyHtml = renderToStaticMarkup(
    React.createElement(SlideRender, {
      slide: opts.slide,
      leadData: opts.leadData,
      scale: 1,
      clip: false,
    }),
  );

  // 2. Fonts sammeln
  const families = new Set<string>();
  for (const layer of opts.slide.layers) {
    if (layer.kind !== "text") continue;
    for (const f of extractFontFamilies(layer.contentHtml)) {
      families.add(f);
    }
  }
  const fontsUrl = buildGoogleFontsCssUrl(Array.from(families));

  // 3. Full HTML page
  const html = `<!doctype html>
<html><head>
<meta charset="utf-8" />
<style>
  html, body { margin: 0; padding: 0; background: #fff; }
  body { width: ${SLIDE_STAGE_WIDTH}px; height: ${SLIDE_STAGE_HEIGHT}px; }
  * { box-sizing: border-box; }
</style>
${fontsUrl ? `<link rel="stylesheet" href="${fontsUrl}" />` : ""}
</head>
<body>${bodyHtml}</body>
</html>`;

  // 4. Puppeteer-Screenshot
  const pooled = await getContext();
  try {
    const page = await pooled.context.newPage();
    try {
      await page.setViewport({
        width: SLIDE_STAGE_WIDTH,
        height: SLIDE_STAGE_HEIGHT,
        deviceScaleFactor: 1,
      });
      await page.setContent(html, { waitUntil: "load", timeout: 30_000 });
      // Auf Font-Laden warten — der Screenshot ohne wäre als System-Font
      try {
        await page.evaluate(
          () => (document as Document & { fonts?: { ready: Promise<unknown> } }).fonts?.ready,
        );
      } catch {
        // Best-effort; manche Builds haben document.fonts nicht
      }
      const buf = await page.screenshot({
        type: "png",
        clip: {
          x: 0,
          y: 0,
          width: SLIDE_STAGE_WIDTH,
          height: SLIDE_STAGE_HEIGHT,
        },
      });
      await writeFile(opts.outputPath, buf);
    } finally {
      await page.close();
    }
  } finally {
    await pooled.close();
  }
}

/**
 * Rendert eine Folie als MP4 in der gewünschten Dauer.
 */
export async function renderSlideToMp4(opts: {
  slide: SlideSegment;
  leadData: Record<string, string>;
  durationMs: number;
  outputDir: string;
  outputPath: string;
}): Promise<void> {
  await mkdir(opts.outputDir, { recursive: true });
  const pngPath = join(opts.outputDir, "slide.png");
  await renderSlideToPng({
    slide: opts.slide,
    leadData: opts.leadData,
    outputPath: pngPath,
  });

  const { renderImageToMp4 } = await import("./ffmpeg");
  await renderImageToMp4({
    imagePath: pngPath,
    durationMs: opts.durationMs,
    outputPath: opts.outputPath,
  });
}
