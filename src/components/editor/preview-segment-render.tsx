"use client";

/**
 * preview-segment-render — pure rendering helpers for the live editor preview.
 *
 * The editor's timeline emits a `Segment` discriminated union (see
 * `@/lib/segments/types`). This module knows how to draw each kind onto the
 * 16:9 preview stage so the user sees roughly what the worker will render.
 *
 * What this file is NOT:
 *   No playback loop. The host component owns currentTimeMs and computes the
 *   active segment + segmentTimeMs before asking us to render. Video segment
 *   timing is driven via the `videoRef` prop so the parent can sync
 *   `currentTime` against the global scrubber. (Website/GDocs renderers hold
 *   minimal local state for lazy screenshot previews + size measurement.)
 */

import * as React from "react";
import {
  Globe,
  FileText,
  ImageOff,
  VideoOff,
  Presentation,
  Wand2,
} from "lucide-react";
import {
  SLIDE_STAGE_WIDTH,
  type Segment,
  type SlideSegment,
  type TextSegment,
  type ImageSegment,
  type VideoSegment,
  type WebsiteSegment,
  type GDocsSegment,
  type PdfSegment,
  type GSlideSegment,
  type CanvaSegment,
  type WebCaptureMode,
} from "@/lib/segments/types";
import { interpolateScrollRatio } from "@/lib/segments/scroll-math";
import { SlideRender } from "@/lib/slide/slide-render";
import {
  DocStackPreview,
  perPageHeightFromStackHeight,
} from "./doc-stack-preview";
import { useSegmentPreview } from "./use-segment-preview";

/** Lesbare deutsche Labels für die Aufnahme-Modi (Preview-Badge). */
const CAPTURE_MODE_LABELS: Record<WebCaptureMode, string> = {
  "static-hero": "Statisch",
  "scroll-recorded": "Scroll-Aufnahme",
};

/* ------------------------------------------------------------------ */
/* Active-segment + duration helpers                                  */
/* ------------------------------------------------------------------ */

/**
 * Compute total timeline duration across all segments (ms).
 * Mirrors `@/lib/segments/duration#totalDurationMs` but inlined here so the
 * player has no extra deps for this single read.
 */
export function getTotalDurationMs(segments: Segment[]): number {
  let total = 0;
  for (const s of segments) {
    total += Math.max(0, s.durationMs | 0);
  }
  return total;
}

/**
 * Given the current playhead position in ms, return the segment that should
 * be rendered + the local time inside that segment.
 *
 * Edge cases:
 *   - empty segments        → null
 *   - timeMs before first   → first segment, segmentTimeMs=0
 *   - timeMs at/past the end → last segment, segmentTimeMs=duration
 */
export function getActiveSegment(
  segments: Segment[],
  timeMs: number,
): { segment: Segment; segmentTimeMs: number; index: number } | null {
  if (segments.length === 0) return null;
  if (timeMs <= 0) {
    return { segment: segments[0], segmentTimeMs: 0, index: 0 };
  }
  let acc = 0;
  for (let i = 0; i < segments.length; i++) {
    const dur = Math.max(0, segments[i].durationMs | 0);
    if (timeMs < acc + dur) {
      return {
        segment: segments[i],
        segmentTimeMs: timeMs - acc,
        index: i,
      };
    }
    acc += dur;
  }
  const lastIdx = segments.length - 1;
  return {
    segment: segments[lastIdx],
    segmentTimeMs: Math.max(0, segments[lastIdx].durationMs | 0),
    index: lastIdx,
  };
}

/* ------------------------------------------------------------------ */
/* Placeholders                                                       */
/* ------------------------------------------------------------------ */

/**
 * Replace `{{firstName}}`-style placeholders in `text` using the lookup map.
 * Unknown placeholders are kept as-is so the user sees what's missing.
 */
export function applyPlaceholders(
  text: string,
  sampleData: Record<string, string> | undefined,
): string {
  if (!text) return text;
  if (!sampleData) return text;
  return text.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (full, key: string) => {
    const v = sampleData[key];
    return typeof v === "string" && v.length > 0 ? v : full;
  });
}

/* ------------------------------------------------------------------ */
/* Per-kind renderers                                                 */
/* ------------------------------------------------------------------ */

function textJustify(align: TextSegment["textAlign"]): React.CSSProperties["justifyContent"] {
  if (align === "left") return "flex-start";
  if (align === "right") return "flex-end";
  return "center";
}

function RenderText({
  segment,
  sampleData,
}: {
  segment: TextSegment;
  sampleData?: Record<string, string>;
}) {
  const resolved = applyPlaceholders(segment.text, sampleData);
  return (
    <div
      className="absolute inset-0 flex items-center"
      style={{
        background: segment.bgColor,
        color: segment.textColor,
        justifyContent: textJustify(segment.textAlign),
        padding: "6%",
      }}
    >
      <div
        style={{
          fontSize: `${segment.fontSize}px`,
          lineHeight: 1.2,
          fontWeight: Number(segment.fontWeight),
          fontStyle: segment.italic ? "italic" : "normal",
          textAlign: segment.textAlign,
          maxWidth: "100%",
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
        }}
      >
        {resolved.length > 0 ? resolved : (
          <span style={{ opacity: 0.4 }}>Leerer Text</span>
        )}
      </div>
    </div>
  );
}

function RenderImage({ segment }: { segment: ImageSegment }) {
  if (!segment.publicUrl) {
    return (
      <div className="absolute inset-0 flex items-center justify-center bg-surface-soft">
        <div className="flex flex-col items-center gap-2 text-ink-muted">
          <ImageOff className="size-8" />
          <span className="text-xs">Kein Bild ausgewählt</span>
        </div>
      </div>
    );
  }

  if (segment.displayMode === "fullscreen") {
    return (
      <div className="absolute inset-0 bg-ink">
        <img
          src={segment.publicUrl}
          alt=""
          className="h-full w-full object-cover"
          draggable={false}
        />
      </div>
    );
  }

  // "slide" mode: positioned card with explicit width/height/center coords.
  const w = Math.max(1, Math.min(100, segment.widthPct));
  const h = Math.max(1, Math.min(100, segment.heightPct));
  const cx = Math.max(0, Math.min(100, segment.posXPct));
  const cy = Math.max(0, Math.min(100, segment.posYPct));
  return (
    <div
      className="absolute inset-0"
      style={{ background: segment.bgColor }}
    >
      <img
        src={segment.publicUrl}
        alt=""
        draggable={false}
        className="absolute"
        style={{
          width: `${w}%`,
          height: `${h}%`,
          left: `${cx}%`,
          top: `${cy}%`,
          transform: "translate(-50%, -50%)",
          objectFit: "contain",
        }}
      />
    </div>
  );
}

function RenderVideo({
  segment,
  videoRef,
  onLoadedMetadata,
  onCanPlay,
}: {
  segment: VideoSegment;
  videoRef?: React.RefObject<HTMLVideoElement>;
  onLoadedMetadata?: React.ReactEventHandler<HTMLVideoElement>;
  onCanPlay?: React.ReactEventHandler<HTMLVideoElement>;
}) {
  if (!segment.publicUrl) {
    return (
      <div className="absolute inset-0 flex items-center justify-center bg-surface-soft">
        <div className="flex flex-col items-center gap-2 text-ink-muted">
          <VideoOff className="size-8" />
          <span className="text-xs">Kein Video ausgewählt</span>
        </div>
      </div>
    );
  }

  if (segment.showAsBrowserFrame) {
    return (
      <div className="absolute inset-0 flex flex-col bg-surface-soft p-4">
        <div className="flex items-center gap-2 rounded-t-squircle-sm border border-line bg-surface px-3 py-2">
          <span className="flex gap-1.5">
            <span className="size-2.5 rounded-full bg-danger/70" />
            <span className="size-2.5 rounded-full bg-warn/80" />
            <span className="size-2.5 rounded-full bg-ok/80" />
          </span>
          <span className="ml-2 truncate rounded-full bg-line/60 px-3 py-0.5 text-xs text-ink-muted">
            {segment.browserTabUrl || segment.browserTabName || "Browser"}
          </span>
        </div>
        <div className="relative flex-1 overflow-hidden rounded-b-squircle-sm border border-t-0 border-line bg-ink">
          {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
          <video
            ref={videoRef}
            src={segment.publicUrl}
            muted
            playsInline
            preload="auto"
            className="absolute inset-0 h-full w-full object-contain"
            onLoadedMetadata={onLoadedMetadata}
            onCanPlay={onCanPlay}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="absolute inset-0 flex items-center justify-center bg-ink">
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <video
        ref={videoRef}
        src={segment.publicUrl}
        muted
        playsInline
        preload="auto"
        className="h-full w-full object-contain"
        onLoadedMetadata={onLoadedMetadata}
        onCanPlay={onCanPlay}
      />
    </div>
  );
}

/**
 * Scroll-Ratio eines Web/Docs/PDF-Segments zum lokalen Zeitpunkt.
 * `static-hero` steht immer oben (ratio 0), sonst spiegelt die Vorschau
 * exakt die Worker-Interpolation über die ScrollFrames.
 */
function segmentScrollRatio(
  segment: WebsiteSegment | GDocsSegment | PdfSegment,
  segmentTimeMs: number,
): number {
  if (segment.captureMode === "static-hero") return 0;
  return interpolateScrollRatio(segment.scrollFrames, segmentTimeMs);
}

/**
 * FullPage-Screenshot, animiert per translateY über die skalierte
 * Bildhöhe — deckungsgleich mit dem Worker-Scroll-Render.
 */
function ScrollingImagePreview({
  imageUrl,
  scrollRatio,
}: {
  imageUrl: string;
  scrollRatio: number;
}) {
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const imgRef = React.useRef<HTMLImageElement | null>(null);
  const [maxScrollPx, setMaxScrollPx] = React.useState(0);

  // Container- + skalierte Bildhöhe live messen (Bild lädt asynchron,
  // Bühne resized responsive).
  React.useEffect(() => {
    const container = containerRef.current;
    const img = imgRef.current;
    if (!container || !img) return;
    const update = () =>
      setMaxScrollPx(Math.max(0, img.offsetHeight - container.clientHeight));
    update();
    const ro = new ResizeObserver(update);
    ro.observe(container);
    ro.observe(img);
    return () => ro.disconnect();
  }, [imageUrl]);

  const ratio = Math.min(1, Math.max(0, scrollRatio));
  return (
    <div ref={containerRef} className="absolute inset-0 overflow-hidden bg-white">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        ref={imgRef}
        src={imageUrl}
        alt="Website-Vorschau"
        draggable={false}
        className="block h-auto w-full select-none"
        style={{
          transform: `translateY(${-ratio * maxScrollPx}px)`,
          willChange: "transform",
        }}
      />
    </div>
  );
}

/** Overlay-Badge: markiert, dass die Vorschau nur die Fallback-URL zeigt. */
function FallbackUrlBadge() {
  return (
    <span className="absolute right-2 top-2 z-10 rounded-full bg-ink/70 px-2.5 py-1 text-[10px] font-medium text-white backdrop-blur-sm">
      Vorschau: Fallback-URL
    </span>
  );
}

function RenderWebsite({
  segment,
  segmentTimeMs,
}: {
  segment: WebsiteSegment;
  segmentTimeMs: number;
}) {
  // Vorrang: am Segment persistierter Screenshot. Sonst Live-Hook über die
  // Fallback-URL (Modul-Cache dedupliziert Jobs). Der Hook wird nur
  // angestoßen, wenn kein persistiertes Bild existiert UND eine URL da ist.
  const fallbackUrl = segment.fallbackUrl.trim();
  const hookUrl =
    !segment.previewImageUrl && fallbackUrl ? fallbackUrl : null;
  const preview = useSegmentPreview(hookUrl);
  const imageUrl = segment.previewImageUrl || preview.data?.imageUrl || null;

  if (imageUrl) {
    return (
      <div className="absolute inset-0">
        <ScrollingImagePreview
          imageUrl={imageUrl}
          scrollRatio={segmentScrollRatio(segment, segmentTimeMs)}
        />
        {/* Personalisierte URLs gibt es erst pro Lead — Vorschau zeigt
            immer die Fallback-URL. */}
        {segment.urlColumn && <FallbackUrlBadge />}
      </div>
    );
  }

  const showUrl =
    segment.fallbackUrl ||
    (segment.urlColumn
      ? `Spalte: ${segment.urlColumn}`
      : "Website aus Leadliste (Zuweisung im Mapping-Schritt)");
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-surface-soft p-8">
      <div className="w-full max-w-md rounded-squircle-md border border-line bg-surface px-6 py-5 shadow-card">
        <div className="mb-3 flex items-center gap-2 text-brand-deep">
          <Globe className="size-5" />
          <span className="text-xs font-semibold uppercase tracking-wide">
            Website ({CAPTURE_MODE_LABELS[segment.captureMode]})
          </span>
        </div>
        <p className="mb-3 break-all text-sm font-medium text-ink">
          {showUrl}
        </p>
        <p className="text-xs leading-relaxed text-ink-muted">
          {preview.status === "loading"
            ? "Vorschau wird geladen — das dauert 5–15 Sekunden …"
            : preview.status === "error"
              ? `Vorschau konnte nicht geladen werden: ${preview.error ?? "Unbekannter Fehler"}`
              : "Wird beim Generieren live aufgenommen. Lade im Segment-Panel eine Vorschau, um die Seite hier zu sehen."}
        </p>
      </div>
    </div>
  );
}

function RenderGSlide({ segment }: { segment: GSlideSegment }) {
  // Wenn ein Thumbnail vorliegt, zeigen wir es auf schwarzem 16:9-Hintergrund
  // mit object-fit:contain — so wie es im finalen Render erscheint.
  if (segment.thumbnailUrl) {
    return (
      <div className="absolute inset-0 flex items-center justify-center bg-ink">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={segment.thumbnailUrl}
          alt={`Folie ${segment.slideIndex + 1}`}
          className="h-full w-full object-contain"
        />
      </div>
    );
  }
  // Fallback: schöne Placeholder-Karte für noch nicht geladene Thumbnails.
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-surface-soft p-8">
      <div className="w-full max-w-md rounded-squircle-md border border-line bg-surface px-6 py-5 shadow-card">
        <div className="mb-3 flex items-center gap-2 text-brand-deep">
          <Presentation className="size-5" />
          <span className="text-xs font-semibold uppercase tracking-wide">
            Google Slide · Folie {segment.slideIndex + 1}
          </span>
        </div>
        <p className="text-xs leading-relaxed text-ink-muted">
          Thumbnail wird beim Import generiert. Falls leer: im Segment-Editor
          „Aktualisieren" klicken.
        </p>
      </div>
    </div>
  );
}

function RenderCanva({ segment }: { segment: CanvaSegment }) {
  // Wenn ein Thumbnail vorliegt, zeigen wir es auf schwarzem 16:9-Hintergrund
  // mit object-fit:contain — exakt so wie es im finalen Render erscheint.
  if (segment.thumbnailUrl) {
    return (
      <div className="absolute inset-0 flex items-center justify-center bg-ink animate-in fade-in duration-300">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={segment.thumbnailUrl}
          alt={
            segment.fileName
              ? `${segment.fileName} · Folie ${segment.slideIndex + 1}`
              : `Folie ${segment.slideIndex + 1}`
          }
          className="h-full w-full object-contain"
        />
      </div>
    );
  }
  // Fallback: schöne Placeholder-Karte, solange das Thumbnail fehlt.
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-surface-soft p-8">
      <div className="w-full max-w-md rounded-squircle-md border border-line bg-surface px-6 py-5 shadow-card">
        <div className="mb-3 flex items-center gap-2 text-brand-deep">
          <Wand2 className="size-5" />
          <span className="text-xs font-semibold uppercase tracking-wide">
            Canva · Folie {segment.slideIndex + 1}
          </span>
        </div>
        {segment.fileName && (
          <p className="mb-3 break-all text-sm font-medium text-ink">
            {segment.fileName}
          </p>
        )}
        <p className="text-xs leading-relaxed text-ink-muted">
          Thumbnail wird beim Import generiert. Falls leer: im
          Segment-Editor „Aktualisieren" klicken.
        </p>
      </div>
    </div>
  );
}

function RenderGDocs({
  segment,
  segmentTimeMs,
}: {
  segment: GDocsSegment;
  segmentTimeMs: number;
}) {
  // Vorrang: persistierte Seiten-PNGs am Segment. Sonst Live-Hook über die
  // Docs-URL (liefert nach der API-Erweiterung permanente pageImageUrls).
  const hasPersisted =
    !!segment.previewPageUrls && segment.previewPageUrls.length > 0;
  const docsUrl = segment.docsUrl.trim();
  const preview = useSegmentPreview(!hasPersisted && docsUrl ? docsUrl : null);

  const pageUrls = hasPersisted
    ? (segment.previewPageUrls as string[])
    : (preview.data?.pageImageUrls ?? []);
  const docWidth = hasPersisted
    ? (segment.previewDocWidth ?? 0)
    : (preview.data?.docWidth ?? 0);
  // Die GDocs-Pipeline liefert als docHeight die GESAMT-Stapelhöhe —
  // DocStackPreview erwartet die Höhe EINER Seite.
  const docHeight = perPageHeightFromStackHeight(
    hasPersisted
      ? (segment.previewDocHeight ?? 0)
      : (preview.data?.docHeight ?? 0),
    pageUrls.length,
  );

  if (pageUrls.length > 0) {
    return (
      <DocStackPreview
        pageUrls={pageUrls}
        docWidth={docWidth}
        docHeight={docHeight}
        scrollRatio={segmentScrollRatio(segment, segmentTimeMs)}
        variant="gdocs"
      />
    );
  }

  return (
    <div className="absolute inset-0 flex items-center justify-center bg-surface-soft p-8">
      <div className="w-full max-w-md rounded-squircle-md border border-line bg-surface px-6 py-5 shadow-card">
        <div className="mb-3 flex items-center gap-2 text-brand-deep">
          <FileText className="size-5" />
          <span className="text-xs font-semibold uppercase tracking-wide">
            Google Doc ({CAPTURE_MODE_LABELS[segment.captureMode]})
          </span>
        </div>
        <p className="mb-3 break-all text-sm font-medium text-ink">
          {segment.docsUrl || "Keine Docs-URL gesetzt"}
        </p>
        <p className="text-xs leading-relaxed text-ink-muted">
          {preview.status === "loading"
            ? "Vorschau wird geladen — das dauert 5–15 Sekunden …"
            : preview.status === "error"
              ? `Vorschau konnte nicht geladen werden: ${preview.error ?? "Unbekannter Fehler"}`
              : "Google-Doc wird live geladen, wenn das Video gerendert wird."}
        </p>
      </div>
    </div>
  );
}

function RenderPdf({
  segment,
  segmentTimeMs,
}: {
  segment: PdfSegment;
  segmentTimeMs: number;
}) {
  // Die Seiten-PNGs entstehen synchron beim Upload — kein Hook nötig.
  if (segment.pageUrls.length > 0) {
    return (
      <DocStackPreview
        pageUrls={segment.pageUrls}
        docWidth={segment.docWidth}
        docHeight={segment.docHeight}
        scrollRatio={segmentScrollRatio(segment, segmentTimeMs)}
        fileName={segment.fileName}
        variant="pdf"
      />
    );
  }
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-surface-soft p-8">
      <div className="w-full max-w-md rounded-squircle-md border border-line bg-surface px-6 py-5 shadow-card">
        <div className="mb-3 flex items-center gap-2 text-brand-deep">
          <FileText className="size-5" />
          <span className="text-xs font-semibold uppercase tracking-wide">
            PDF ({CAPTURE_MODE_LABELS[segment.captureMode]})
          </span>
        </div>
        <p className="text-xs leading-relaxed text-ink-muted">
          Noch kein PDF hochgeladen. Lade im Segment-Panel eine Datei hoch,
          um die Vorschau zu sehen.
        </p>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Public renderer                                                    */
/* ------------------------------------------------------------------ */

export interface PreviewSegmentRenderProps {
  segment: Segment;
  /** Local time inside this segment (ms). Used to sync video playback. */
  segmentTimeMs: number;
  /** Optional sample data for `{{placeholder}}` substitution in text. */
  sampleData?: Record<string, string>;
  /**
   * The parent receives the video element ref to drive `currentTime`/play/pause
   * against the global scrubber state. Only set for VideoSegment.
   */
  videoRef?: React.RefObject<HTMLVideoElement>;
  /** Bei VideoSegment: weitergereicht an das <video>-Element. */
  onVideoLoadedMetadata?: React.ReactEventHandler<HTMLVideoElement>;
  /** Bei VideoSegment: weitergereicht an das <video>-Element. */
  onVideoCanPlay?: React.ReactEventHandler<HTMLVideoElement>;
}

export function PreviewSegmentRender({
  segment,
  segmentTimeMs,
  sampleData,
  videoRef,
  onVideoLoadedMetadata,
  onVideoCanPlay,
}: PreviewSegmentRenderProps): React.ReactElement | null {
  switch (segment.kind) {
    case "text":
      return <RenderText segment={segment} sampleData={sampleData} />;
    case "image":
      return <RenderImage segment={segment} />;
    case "video":
      return (
        <RenderVideo
          segment={segment}
          videoRef={videoRef}
          onLoadedMetadata={onVideoLoadedMetadata}
          onCanPlay={onVideoCanPlay}
        />
      );
    case "website":
      return <RenderWebsite segment={segment} segmentTimeMs={segmentTimeMs} />;
    case "gdocs":
      return <RenderGDocs segment={segment} segmentTimeMs={segmentTimeMs} />;
    case "pdf":
      return <RenderPdf segment={segment} segmentTimeMs={segmentTimeMs} />;
    case "gslide":
      return <RenderGSlide segment={segment} />;
    case "canva":
      return <RenderCanva segment={segment} />;
    case "slide":
      return <RenderSlide segment={segment} sampleData={sampleData} />;
  }
}

/**
 * Freie Folie: nutzt den geteilten SlideRender (gleiche Komponente wie
 * Worker + Folien-Editor) und skaliert die 1280×720-Bühne per
 * ResizeObserver auf die Container-Breite.
 */
function RenderSlide({
  segment,
  sampleData,
}: {
  segment: SlideSegment;
  sampleData?: Record<string, string>;
}) {
  const ref = React.useRef<HTMLDivElement | null>(null);
  const [scale, setScale] = React.useState(0);

  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setScale(el.clientWidth / SLIDE_STAGE_WIDTH);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div ref={ref} className="absolute inset-0 overflow-hidden">
      {scale > 0 && (
        <SlideRender slide={segment} leadData={sampleData} scale={scale} />
      )}
    </div>
  );
}
