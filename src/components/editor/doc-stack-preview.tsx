"use client";

/**
 * doc-stack-preview — geteilter „Seiten-Stapel" für PDF- und GDocs-Vorschau.
 *
 * Rendert vorgerasterte Seiten-PNGs als weiße Seiten mit 24px Gap auf
 * grauem Grund (#F1F3F4, Google-Drive-Viewer-Look), optional mit schlanker
 * dunkler Toolbar (Dateiname + „Seite x / n").
 *
 * Scrolling passiert NICHT über einen Scroll-Container, sondern über
 * `transform: translateY(...)` auf dem inneren Stapel — so kann der Host
 * (PreviewSegmentRender) die Position frame-genau aus den ScrollFrames
 * steuern, deckungsgleich mit dem Worker-Render.
 */

import * as React from "react";

export interface DocStackPreviewProps {
  /** Seiten-PNGs (Bunny-CDN), in Reihenfolge. */
  pageUrls: string[];
  /** Pixel-Maße EINER Seite (150 dpi) — bestimmt das Seiten-Seitenverhältnis. */
  docWidth: number;
  docHeight: number;
  /** Vertikale Scroll-Position 0..1 (interpolateScrollRatio). */
  scrollRatio: number;
  /** Dateiname für die Toolbar. */
  fileName?: string;
  /** Dunkle Viewer-Toolbar oben einblenden. */
  showToolbar?: boolean;
}

/** Abstand zwischen den Seiten + Außen-Padding des Stapels (px). */
const PAGE_GAP_PX = 24;

/** Seitenbreite relativ zur Bühnenbreite (Drive-Viewer-artige Ränder). */
const PAGE_WIDTH_RATIO = 0.56;

export function DocStackPreview({
  pageUrls,
  docWidth,
  docHeight,
  scrollRatio,
  fileName,
  showToolbar = false,
}: DocStackPreviewProps) {
  const viewportRef = React.useRef<HTMLDivElement | null>(null);
  const stackRef = React.useRef<HTMLDivElement | null>(null);
  const [viewportHeight, setViewportHeight] = React.useState(0);
  const [stackHeight, setStackHeight] = React.useState(0);

  // Beide Höhen live messen — Container skaliert mit der 16:9-Bühne,
  // der Stapel wächst, sobald die Seiten-Images geladen sind.
  React.useEffect(() => {
    const viewport = viewportRef.current;
    const stack = stackRef.current;
    if (!viewport || !stack) return;
    const update = () => {
      setViewportHeight(viewport.clientHeight);
      setStackHeight(stack.offsetHeight);
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(viewport);
    ro.observe(stack);
    return () => ro.disconnect();
  }, []);

  const ratio = Math.min(1, Math.max(0, scrollRatio));
  const maxScrollPx = Math.max(0, stackHeight - viewportHeight);
  const translateY = -ratio * maxScrollPx;

  // Seiten-Seitenverhältnis aus den Doc-Maßen; Fallback A4-Hochformat.
  const pageAspect =
    docWidth > 0 && docHeight > 0 ? docWidth / docHeight : 1 / Math.SQRT2;

  const pageCount = pageUrls.length;
  // Aktuelle Seite aus der Scroll-Position ableiten (nur Toolbar-Anzeige).
  const currentPage =
    pageCount > 1 ? Math.round(ratio * (pageCount - 1)) + 1 : 1;

  return (
    <div className="absolute inset-0 flex flex-col overflow-hidden bg-[#F1F3F4]">
      {showToolbar && (
        <div className="z-10 flex h-8 shrink-0 items-center justify-between gap-3 bg-[#323639] px-3 text-[11px] text-white/90 shadow-md">
          <span className="min-w-0 truncate font-medium">
            {fileName || "Dokument"}
          </span>
          {pageCount > 0 && (
            <span className="shrink-0 tabular-nums text-white/70">
              Seite {currentPage} / {pageCount}
            </span>
          )}
        </div>
      )}

      {/* Scroll-Viewport: füllt den Rest der Bühne, Stapel wird per
          translateY verschoben (kein echtes Scrolling). */}
      <div ref={viewportRef} className="relative min-h-0 flex-1 overflow-hidden">
        <div
          ref={stackRef}
          className="absolute inset-x-0 top-0 flex flex-col items-center"
          style={{
            gap: `${PAGE_GAP_PX}px`,
            paddingTop: `${PAGE_GAP_PX}px`,
            paddingBottom: `${PAGE_GAP_PX}px`,
            transform: `translateY(${translateY}px)`,
            willChange: "transform",
          }}
        >
          {pageUrls.map((url, i) => (
            <div
              key={`${url}-${i}`}
              className="shrink-0 bg-white shadow-[0_1px_3px_rgba(0,0,0,0.2)]"
              style={{
                width: `${PAGE_WIDTH_RATIO * 100}%`,
                aspectRatio: `${pageAspect}`,
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
    </div>
  );
}
