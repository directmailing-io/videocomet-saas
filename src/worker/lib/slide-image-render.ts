/**
 * Worker-Renderer für `CampaignThumbnailImage` (Paket D).
 *
 * Strukturell identisch zu `slide-renderer.ts` (das eine `SlideSegment`
 * rendert), aber für den Kampagnen-Thumbnail-Generator: kein Segment-
 * Wrapper, keine MP4-Loop-Variante, nur ein einzelnes 1280×720-PNG.
 *
 * Substitution-Modell:
 *   Layer mit `{{key}}`-Tokens werden VOR dem React-Render durch
 *   `substitute()` ersetzt. Das System-Context (`pageUrl`) wird in das
 *   leadData-Map gemerged, damit sich der zentrale Substitute-Pfad weder
 *   ändern noch ein extra `system?`-Parameter durchgeschleift werden muss.
 *   `{{pageUrl}}` zählt damit als ganz normaler Lead-Wert.
 *
 * Pipeline-Eintritt: `renderThumbnailToPng(content, leadData, pageUrl, out)`.
 */

import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
  SLIDE_STAGE_HEIGHT,
  SLIDE_STAGE_WIDTH,
  type CampaignThumbnailImage,
  type Layer,
  type SlideSegment,
  type TextLayer,
} from "@/lib/segments/types";
import { SlideRender } from "@/lib/slide/slide-render";
import {
  buildGoogleFontsCssUrl,
  extractFontFamilies,
} from "@/lib/slide/google-fonts-css";
import { substitute } from "@/lib/placeholders/substitute";
import type {
  LegacyMapping,
  PlaceholderMapping,
} from "@/lib/placeholders/types";
import { getContext } from "./browser-pool";

export interface RenderThumbnailToPngOptions {
  content: CampaignThumbnailImage;
  leadData: Record<string, string>;
  /**
   * Aufgelöste Landingpage-URL für diesen Lead. Wird als `{{pageUrl}}` /
   * `{{landingpageUrl}}` System-Key in das leadData-Map gemerged — kann im
   * Editor in Text-Layern referenziert werden, z.B. für einen QR-Code-
   * Anker auf dem Thumbnail.
   */
  pageUrl?: string | null;
  /**
   * Optionales Placeholder-Mapping vom Run (Lead-Spalten ↔ Template-Keys).
   * Erlaubt das gleiche User-Mapping wie für das Video / PDF.
   */
  mapping?: PlaceholderMapping | LegacyMapping;
  outputPath: string;
}

/**
 * Merged System-Context in das leadData-Map. NICHT-destruktiv — eine
 * vorhandene Spalte `pageUrl` aus dem CSV gewinnt (User-Override).
 */
function mergeSystemContext(
  leadData: Record<string, string>,
  pageUrl: string | null | undefined,
): Record<string, string> {
  if (!pageUrl) return leadData;
  const merged: Record<string, string> = { ...leadData };
  // Beide Aliases setzen, weil bestehende Templates beide Schreibweisen
  // nutzen (PDF-Stage sendet `landingpageUrl`, Slide-Editor zeigt `pageUrl`
  // im Insert-Menü). Niemals überschreiben — wenn der User das im CSV hat,
  // ist das seine Wahrheit.
  if (!(merged.pageUrl && merged.pageUrl.length > 0)) merged.pageUrl = pageUrl;
  if (!(merged.landingpageUrl && merged.landingpageUrl.length > 0)) {
    merged.landingpageUrl = pageUrl;
  }
  return merged;
}

/**
 * Pre-substituiert die Tiptap-HTML-Strings auf Text-Layern. Damit muss der
 * React-Renderer kein leadData-Map mehr durchreichen — und der spätere
 * `SlideRender` läuft im gleichen Codepfad wie der Editor-Preview-Mode
 * OHNE `leadData` (also als "fertig, kein Replace mehr nötig"-Snapshot).
 *
 * Hintergrund: SlideRender bietet selbst einen leadData-Pfad an, aber der
 * macht `tiptap-span`-Substitution. Für unseren Worker-Pfad ist das ok,
 * aber System-Aliases (`pageUrl`) müssen wir trotzdem schon vorher mergen.
 * Wir entscheiden uns für den expliziten Pre-Pass, damit Logging /
 * Debug-Snapshot des resultierenden HTMLs klar bleibt.
 */
function substituteLayers(
  layers: Layer[],
  leadData: Record<string, string>,
  mapping: PlaceholderMapping | LegacyMapping | undefined,
): Layer[] {
  return layers.map((layer) => {
    if (layer.kind !== "text") return layer;
    const text = layer as TextLayer;
    const resolved = substitute(
      text.contentHtml,
      leadData,
      mapping,
      // Tiptap-Span deckt sowohl `<span data-placeholder>` als auch
      // Raw-`{{key}}`-Tokens ab (siehe substitute.ts).
      "tiptap-span",
    );
    return { ...text, contentHtml: resolved };
  });
}

/**
 * Rendert ein `CampaignThumbnailImage` als 1280×720-PNG nach `outputPath`.
 *
 * Schritte:
 *  1. System-Context (pageUrl) in leadData mergen.
 *  2. Text-Layer pre-substituieren (Platzhalter → Werte).
 *  3. In eine `SlideSegment`-Hülle wrappen, damit `SlideRender` direkt
 *     wiederverwendbar ist (strukturell identisch zum Slide).
 *  4. React → Static HTML → Puppeteer → Screenshot.
 *
 * Wirft, wenn Puppeteer/Chromium nicht verfügbar ist. Caller (Pipeline-
 * Stage) wrapt das in `withStageTimeout` + `try/catch` und schreibt die
 * Fehlermeldung auf den Lead.
 */
export async function renderThumbnailToPng(
  opts: RenderThumbnailToPngOptions,
): Promise<void> {
  await mkdir(dirname(opts.outputPath), { recursive: true });

  const mergedData = mergeSystemContext(opts.leadData, opts.pageUrl);
  const substitutedLayers = substituteLayers(
    opts.content.layers,
    mergedData,
    opts.mapping,
  );

  // `SlideSegment`-kompatible Hülle. Die Felder `id`, `kind`, `durationMs`
  // sind im Render-Pfad NICHT relevant — `SlideRender` liest nur
  // `background` und `layers`. Wir erfüllen das Type-Interface trotzdem
  // sauber, damit kein `as any` nötig ist.
  const slide: SlideSegment = {
    id: "thumbnail",
    kind: "slide",
    durationMs: 1,
    background: opts.content.background,
    layers: substitutedLayers,
  };

  // React → HTML. KEIN leadData übergeben — die Substitution lief schon
  // in Schritt 2; SlideRender soll die Strings 1:1 ausgeben.
  const bodyHtml = renderToStaticMarkup(
    React.createElement(SlideRender, {
      slide,
      scale: 1,
      clip: false,
    }),
  );

  // Google-Fonts-Sammlung (Text-Layer können beliebige Fonts setzen).
  const families = new Set<string>();
  for (const layer of substitutedLayers) {
    if (layer.kind !== "text") continue;
    for (const f of extractFontFamilies(layer.contentHtml)) {
      families.add(f);
    }
  }
  const fontsUrl = buildGoogleFontsCssUrl(Array.from(families));

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
      // Auf Google-Fonts warten — sonst landet System-Font im PNG.
      try {
        await page.evaluate(
          () =>
            (document as Document & { fonts?: { ready: Promise<unknown> } })
              .fonts?.ready,
        );
      } catch {
        // document.fonts ist in manchen Chromium-Builds nicht da — best-effort.
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
