"use client";

/**
 * studio-stage — die 16:9-Bühne des Studios.
 *
 * Zeigt die aktive Szene EXAKT wie das spätere Video:
 *   - Website:   fullPage-Screenshot im Viewport-Ausschnitt (translateY)
 *   - GDocs/PDF: DocStackPreview mit scrollRatio (gleiche Render-Quelle
 *                wie Editor-Vorschau und Worker)
 *   - Text:      Standbild (PreviewSegmentRender)
 *
 * Interaktiv ist NUR Scrollen (Wheel/Trackpad, non-passive) — Klicks werden
 * abgefangen. Der Host bekommt die neue Ratio über `onScrollRatio` und
 * bleibt Owner der Scroll-Position (pro Szene gemerkt).
 */

import * as React from "react";
import { AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Segment } from "@/lib/segments/types";
import { DocStackPreview } from "@/components/editor/doc-stack-preview";
import { PreviewSegmentRender } from "@/components/editor/preview-segment-render";
import { clamp01 } from "./internal";

export interface StudioStageProps {
  segment: Segment;
  /** Vertikale Scroll-Position 0..1 der Szene. */
  scrollRatio: number;
  /** Scroll-Eingabe erlauben; ohne Callback ist die Bühne rein passiv. */
  onScrollRatio?: (y: number) => void;
  /** Badge „Standbild" auf Text-Folien anzeigen (Live-Phase). */
  showStaticBadge?: boolean;
  className?: string;
}

/**
 * Layout-Konstanten des Seiten-Stapels — MÜSSEN mit
 * `@/components/editor/doc-stack-preview` übereinstimmen (PAGE_GAP_PX,
 * PAGE_WIDTH_RATIO, Toolbar h-8), damit die Wheel→Ratio-Umrechnung exakt
 * zur sichtbaren Bewegung passt.
 */
const DOC_PAGE_GAP_PX = 24;
const DOC_PAGE_WIDTH_RATIO = 0.56;
const DOC_TOOLBAR_HEIGHT_PX = 32;

interface DocStackMeta {
  pageUrls: string[];
  docWidth: number;
  docHeight: number;
  fileName?: string;
  showToolbar: boolean;
}

function docStackMeta(segment: Segment): DocStackMeta | null {
  if (segment.kind === "gdocs") {
    if (!segment.previewPageUrls || segment.previewPageUrls.length === 0) {
      return null;
    }
    return {
      pageUrls: segment.previewPageUrls,
      docWidth: segment.previewDocWidth ?? 0,
      docHeight: segment.previewDocHeight ?? 0,
      showToolbar: false,
    };
  }
  if (segment.kind === "pdf") {
    if (segment.pageUrls.length === 0) return null;
    return {
      pageUrls: segment.pageUrls,
      docWidth: segment.docWidth,
      docHeight: segment.docHeight,
      fileName: segment.fileName,
      showToolbar: true,
    };
  }
  return null;
}

export function StudioStage({
  segment,
  scrollRatio,
  onScrollRatio,
  showStaticBadge = false,
  className,
}: StudioStageProps) {
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const imgRef = React.useRef<HTMLImageElement | null>(null);
  /** Scrollbare Pixel-Strecke der aktuellen Quelle (0 = nicht scrollbar). */
  const maxScrollRef = React.useRef(0);
  const [maxScrollPx, setMaxScrollPx] = React.useState(0);
  React.useEffect(() => {
    maxScrollRef.current = maxScrollPx;
  }, [maxScrollPx]);

  const ratioRef = React.useRef(scrollRatio);
  React.useEffect(() => {
    ratioRef.current = scrollRatio;
  }, [scrollRatio]);

  const onScrollRatioRef = React.useRef(onScrollRatio);
  React.useEffect(() => {
    onScrollRatioRef.current = onScrollRatio;
  }, [onScrollRatio]);

  const doc = docStackMeta(segment);
  const isWebsite = segment.kind === "website";
  const websiteImageUrl = isWebsite ? segment.previewImageUrl ?? null : null;

  // ── Scroll-Strecke messen ────────────────────────────────────────────
  // Website: reales <img> messen (identisch zu ScrollingImagePreview).
  // Doc-Stack: analytisch aus Containergröße + Seitengeometrie — die
  // DocStackPreview misst intern dieselben Werte.
  React.useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const update = () => {
      const w = container.clientWidth;
      const h = container.clientHeight;
      if (websiteImageUrl) {
        const img = imgRef.current;
        setMaxScrollPx(img ? Math.max(0, img.offsetHeight - h) : 0);
        return;
      }
      if (doc) {
        const aspect =
          doc.docWidth > 0 && doc.docHeight > 0
            ? doc.docWidth / doc.docHeight
            : 1 / Math.SQRT2;
        const viewportH =
          h - (doc.showToolbar ? DOC_TOOLBAR_HEIGHT_PX : 0);
        const pageH = (w * DOC_PAGE_WIDTH_RATIO) / aspect;
        const n = doc.pageUrls.length;
        const stackH =
          DOC_PAGE_GAP_PX * 2 + n * pageH + Math.max(0, n - 1) * DOC_PAGE_GAP_PX;
        setMaxScrollPx(Math.max(0, stackH - viewportH));
        return;
      }
      setMaxScrollPx(0);
    };

    update();
    const ro = new ResizeObserver(update);
    ro.observe(container);
    const img = imgRef.current;
    if (img) ro.observe(img);
    return () => ro.disconnect();
    // doc ist pro Render neu — die relevanten Werte stecken im Segment.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [segment.id, websiteImageUrl, doc?.pageUrls.length]);

  // ── Wheel-Eingabe (non-passive, damit preventDefault greift) ─────────
  const interactive = !!onScrollRatio;
  React.useEffect(() => {
    if (!interactive) return;
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const max = maxScrollRef.current;
      if (max <= 0) return;
      // deltaMode 1 = Zeilen (Firefox) → grobe Pixel-Umrechnung.
      const deltaPx = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      const next = clamp01(ratioRef.current + deltaPx / max);
      if (next !== ratioRef.current) {
        ratioRef.current = next;
        onScrollRatioRef.current?.(next);
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [interactive, segment.id]);

  const ratio = clamp01(scrollRatio);

  let content: React.ReactNode;
  if (websiteImageUrl) {
    content = (
      <div className="absolute inset-0 overflow-hidden bg-white">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          ref={imgRef}
          src={websiteImageUrl}
          alt="Website"
          draggable={false}
          className="block h-auto w-full select-none"
          style={{
            transform: `translateY(${-ratio * maxScrollPx}px)`,
            willChange: "transform",
          }}
        />
      </div>
    );
  } else if (doc) {
    content = (
      <DocStackPreview
        pageUrls={doc.pageUrls}
        docWidth={doc.docWidth}
        docHeight={doc.docHeight}
        scrollRatio={ratio}
        fileName={doc.fileName}
        showToolbar={doc.showToolbar}
      />
    );
  } else if (segment.kind === "text") {
    content = <PreviewSegmentRender segment={segment} segmentTimeMs={0} />;
  } else {
    content = (
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-surface-soft text-ink-muted">
        <AlertCircle className="size-6" />
        <span className="text-xs">Vorschau noch nicht bereit</span>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className={cn("absolute inset-0 overflow-hidden", className)}
    >
      {content}

      {/* Klick-Schutz: auf der Bühne ist NUR Scrollen möglich. */}
      {interactive && (
        <div
          aria-hidden
          className="absolute inset-0 z-10 cursor-ns-resize"
          onClickCapture={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
          onMouseDownCapture={(e) => e.preventDefault()}
          onDragStart={(e) => e.preventDefault()}
        />
      )}

      {showStaticBadge && segment.kind === "text" && (
        <span className="absolute left-3 top-3 z-20 rounded-full bg-ink/70 px-2.5 py-1 text-[10px] font-semibold text-white backdrop-blur-sm">
          Standbild
        </span>
      )}
    </div>
  );
}
