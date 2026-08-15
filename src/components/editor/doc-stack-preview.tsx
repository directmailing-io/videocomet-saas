"use client";

/**
 * doc-stack-preview — geteilter „Seiten-Stapel" für PDF- und GDocs-Vorschau.
 *
 * WYSIWYG zum Worker-Render: Die Geometrie (Seitenbreite 826/1280,
 * 24px-Gap, Toolbar 160px GDocs / 56px PDF, kein Außen-Padding) kommt
 * aus `docStackLayout()` (doc-geometry.ts) und wird proportional auf die
 * aktuelle Bühnengröße skaliert. Die Toolbar ist das ECHTE Worker-HTML
 * (gdocs-toolbar-html.ts / pdf-viewer-html.ts), in 1280px Breite gerendert
 * und per CSS-transform auf die Bühne skaliert — dadurch zeigt eine
 * scrollRatio hier exakt denselben Ausschnitt wie im finalen Video.
 *
 * Scrolling passiert NICHT über einen Scroll-Container, sondern über
 * `transform: translateY(...)` auf dem inneren Stapel — so kann der Host
 * (PreviewSegmentRender) die Position frame-genau aus den ScrollFrames
 * steuern, deckungsgleich mit dem Worker-Render.
 */

import * as React from "react";

import {
  DOC_PAGE_GAP_PX,
  DOC_VIEWER_WIDTH_PX,
  docStackLayout,
  docToolbarHeightPx,
  type DocViewerVariant,
} from "@/lib/segments/doc-geometry";
import {
  getGDocsToolbarCss,
  getGDocsToolbarHtml,
} from "@/worker/lib/gdocs-toolbar-html";
import {
  buildPdfToolbarHtml,
  getPdfViewerCss,
} from "@/worker/lib/pdf-viewer-html";

export interface DocStackPreviewProps {
  /** Seiten-PNGs (Bunny-CDN), in Reihenfolge. */
  pageUrls: string[];
  /** Pixel-Maße EINER Seite (150 dpi) — bestimmt das Seiten-Seitenverhältnis. */
  docWidth: number;
  docHeight: number;
  /** Vertikale Scroll-Position 0..1 (interpolateScrollRatio). */
  scrollRatio: number;
  /** Dateiname/Titel für die Toolbar. */
  fileName?: string;
  /** Viewer-Variante — bestimmt Toolbar (GDocs 160px, PDF 56px) + Hintergrund. */
  variant: DocViewerVariant;
}

/**
 * Rechnet die Gesamthöhe eines Seiten-Stapels (Σ Seitenhöhen + Gaps, wie
 * die GDocs-Pipeline sie als `docHeight` liefert) auf die Höhe EINER Seite
 * um — `DocStackPreview` erwartet Einzelseiten-Maße (PDF liefert die
 * bereits, GDocs nicht).
 */
export function perPageHeightFromStackHeight(
  stackHeight: number,
  pageCount: number,
): number {
  if (pageCount <= 0) return 0;
  return Math.max(
    0,
    (stackHeight - Math.max(0, pageCount - 1) * DOC_PAGE_GAP_PX) / pageCount,
  );
}

export function DocStackPreview({
  pageUrls,
  docWidth,
  docHeight,
  scrollRatio,
  fileName,
  variant,
}: DocStackPreviewProps) {
  const rootRef = React.useRef<HTMLDivElement | null>(null);
  const [stage, setStage] = React.useState({ width: 0, height: 0 });

  // Bühnengröße live messen — alles Weitere ist analytisch (docStackLayout).
  React.useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const update = () =>
      setStage({ width: root.clientWidth, height: root.clientHeight });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(root);
    return () => ro.disconnect();
  }, []);

  // Seiten-Seitenverhältnis aus den Doc-Maßen; Fallback A4-Hochformat.
  const pageAspect =
    docWidth > 0 && docHeight > 0 ? docWidth / docHeight : 1 / Math.SQRT2;

  const pageCount = pageUrls.length;
  const layout = docStackLayout({
    stageWidth: stage.width,
    stageHeight: stage.height,
    pageAspect,
    pageCount,
    variant,
  });

  const ratio = Math.min(1, Math.max(0, scrollRatio));
  const translateY = -ratio * layout.maxScrollPx;

  const toolbarCss = React.useMemo(
    () => (variant === "gdocs" ? getGDocsToolbarCss() : getPdfViewerCss()),
    [variant],
  );
  const toolbarHtml = React.useMemo(
    () =>
      variant === "gdocs"
        ? getGDocsToolbarHtml({ docTitle: fileName || "Dokument" })
        : buildPdfToolbarHtml({
            fileName: fileName || "Dokument.pdf",
            pageCount: Math.max(1, pageCount),
          }),
    [variant, fileName, pageCount],
  );

  return (
    <div
      ref={rootRef}
      className="absolute inset-0 overflow-hidden"
      style={{ background: variant === "gdocs" ? "#F1F3F4" : "#525659" }}
    >
      <style dangerouslySetInnerHTML={{ __html: toolbarCss }} />

      {/* Scroll-Viewport unter der Toolbar: Stapel wird per translateY
          verschoben (kein echtes Scrolling). */}
      <div
        className="absolute inset-x-0 bottom-0 overflow-hidden"
        style={{ top: `${layout.toolbarPx}px` }}
      >
        <div
          className="absolute inset-x-0 top-0 flex flex-col items-center"
          style={{
            gap: `${layout.gapPx}px`,
            transform: `translateY(${translateY}px)`,
            willChange: "transform",
          }}
        >
          {pageUrls.map((url, i) => (
            <div
              key={`${url}-${i}`}
              className="shrink-0 bg-white shadow-[0_1px_3px_rgba(0,0,0,0.2)]"
              style={{
                width: `${layout.pageWidthPx}px`,
                height: `${layout.pageHeightPx}px`,
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={url}
                alt={`Seite ${i + 1}`}
                draggable={false}
                className="block h-full w-full select-none object-contain"
              />
            </div>
          ))}
        </div>
      </div>

      {/* Echte Worker-Toolbar, in 1280px Breite gerendert und auf die
          Bühne skaliert (position:fixed wird vom transform eingefangen). */}
      <div
        className="absolute left-0 top-0 z-10"
        style={{
          width: `${DOC_VIEWER_WIDTH_PX}px`,
          height: `${docToolbarHeightPx(variant)}px`,
          transform: `scale(${layout.scale})`,
          transformOrigin: "top left",
        }}
        dangerouslySetInnerHTML={{ __html: toolbarHtml }}
      />
    </div>
  );
}
