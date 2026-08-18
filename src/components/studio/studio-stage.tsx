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
import { AlertCircle, Pause, Play, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";
import { MEDIA_STAGE_BG, type Segment } from "@/lib/segments/types";
import { pickBunnyMp4Fallback } from "@/lib/bunny/mp4-fallback";
import {
  DocStackPreview,
  perPageHeightFromStackHeight,
} from "@/components/editor/doc-stack-preview";
import { PreviewSegmentRender } from "@/components/editor/preview-segment-render";
import {
  docStackLayout,
  type DocViewerVariant,
} from "@/lib/segments/doc-geometry";
import { clamp01 } from "./internal";

export interface StudioStageProps {
  segment: Segment;
  /** Vertikale Scroll-Position 0..1 der Szene. */
  scrollRatio: number;
  /** Scroll-Eingabe erlauben; ohne Callback ist die Bühne rein passiv. */
  onScrollRatio?: (y: number) => void;
  /**
   * Mausposition über der Bühne melden (normiert 0..1 des 16:9-
   * Ausschnitts). Nur gesetzt, wenn der Cursor aufgezeichnet werden soll.
   */
  onCursorMove?: (x: number, y: number) => void;
  /** Maus hat die Bühne verlassen. */
  onCursorLeave?: () => void;
  /** Badge „Standbild" auf Text-Folien anzeigen (Live-Phase). */
  showStaticBadge?: boolean;
  /**
   * Video-Szene: Quell-Position (Sekunden), an der das Video steht bzw.
   * beim nächsten Play fortsetzt. Default: trimStartMs des Segments.
   */
  mediaStartSec?: number;
  /**
   * Video-Szene: Play/Pause-Meldung an den Host (inkl. aktueller
   * Quell-Position in Sekunden). Ohne Callback ist das Video gesperrt.
   */
  onMediaPlayback?: (playing: boolean, timeSec: number) => void;
  /**
   * Video-Szene: bei Erhöhung pausiert das Video und springt zurück auf
   * `mediaStartSec` (Aufnahme-Start: Standby → Countdown).
   */
  mediaResetNonce?: number;
  className?: string;
}

interface DocStackMeta {
  pageUrls: string[];
  docWidth: number;
  docHeight: number;
  fileName?: string;
  variant: DocViewerVariant;
}

function docStackMeta(segment: Segment): DocStackMeta | null {
  if (segment.kind === "gdocs") {
    if (!segment.previewPageUrls || segment.previewPageUrls.length === 0) {
      return null;
    }
    // previewDocHeight ist die GESAMT-Stapelhöhe (Pipeline-Semantik) —
    // DocStackPreview braucht die Höhe EINER Seite.
    return {
      pageUrls: segment.previewPageUrls,
      docWidth: segment.previewDocWidth ?? 0,
      docHeight: perPageHeightFromStackHeight(
        segment.previewDocHeight ?? 0,
        segment.previewPageUrls.length,
      ),
      variant: "gdocs",
    };
  }
  if (segment.kind === "pdf") {
    if (segment.pageUrls.length === 0) return null;
    return {
      pageUrls: segment.pageUrls,
      docWidth: segment.docWidth,
      docHeight: segment.docHeight,
      fileName: segment.fileName,
      variant: "pdf",
    };
  }
  return null;
}

export function StudioStage({
  segment,
  scrollRatio,
  onScrollRatio,
  onCursorMove,
  onCursorLeave,
  showStaticBadge = false,
  mediaStartSec,
  onMediaPlayback,
  mediaResetNonce = 0,
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
        const layout = docStackLayout({
          stageWidth: w,
          stageHeight: h,
          pageAspect: aspect,
          pageCount: doc.pageUrls.length,
          variant: doc.variant,
        });
        setMaxScrollPx(layout.maxScrollPx);
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
        variant={doc.variant}
      />
    );
  } else if (
    (segment.kind === "gslide" || segment.kind === "canva") &&
    segment.thumbnailUrl
  ) {
    // Folie aus Google Slides bzw. hochgeladener PPTX: Standbild,
    // contain auf Weiß.
    content = (
      <div className="absolute inset-0 bg-white">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={segment.thumbnailUrl}
          alt=""
          draggable={false}
          className="size-full select-none object-contain"
        />
      </div>
    );
  } else if (segment.kind === "text") {
    content = <PreviewSegmentRender segment={segment} segmentTimeMs={0} />;
  } else if (segment.kind === "image" && segment.publicUrl) {
    // Bild-Szene: contain auf dunklem Grund — identisch zum Worker-Render
    // (MEDIA_STAGE_BG, media-segment-render.ts).
    content = (
      <div
        className="absolute inset-0"
        style={{ backgroundColor: MEDIA_STAGE_BG }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={segment.publicUrl}
          alt=""
          draggable={false}
          className="size-full select-none object-contain"
        />
      </div>
    );
  } else if (segment.kind === "video" && segment.publicUrl) {
    content = (
      <StageVideo
        url={segment.publicUrl}
        startSec={mediaStartSec ?? segment.trimStartMs / 1000}
        resetNonce={mediaResetNonce}
        onPlayback={onMediaPlayback}
      />
    );
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
      onPointerMove={
        onCursorMove
          ? (e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              if (rect.width <= 0 || rect.height <= 0) return;
              onCursorMove(
                clamp01((e.clientX - rect.left) / rect.width),
                clamp01((e.clientY - rect.top) / rect.height),
              );
            }
          : undefined
      }
      onPointerLeave={onCursorLeave}
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

/* ------------------------------------------------------------------ */
/* Video-Szene                                                         */
/* ------------------------------------------------------------------ */

/**
 * StageVideo — Video-Szene mit eigenem großen Play/Pause-Overlay (keine
 * nativen Controls). Contain auf MEDIA_STAGE_BG, exakt wie der spätere
 * Worker-Render. Der Host bekommt jede Play/Pause-Aktion inkl. aktueller
 * Quell-Position gemeldet (Live-Phase loggt daraus mediaPlay/mediaPause);
 * beim Unmount (Szenenwechsel) wird automatisch pausiert + gemeldet.
 *
 * Der Play-Button liegt auf z-20 ÜBER dem Klick-Schutz der Bühne (z-10).
 * Während der Wiedergabe blendet er aus und erscheint beim Hover wieder.
 */
function StageVideo({
  url,
  startSec,
  resetNonce,
  onPlayback,
}: {
  url: string;
  startSec: number;
  resetNonce: number;
  onPlayback?: (playing: boolean, timeSec: number) => void;
}) {
  const videoRef = React.useRef<HTMLVideoElement | null>(null);
  const [playing, setPlaying] = React.useState(false);
  const [failed, setFailed] = React.useState(false);
  /** Erzwingt frisches Laden nach „Erneut versuchen". */
  const [loadNonce, setLoadNonce] = React.useState(0);
  /** Wie viele Auto-Retries schon gelaufen sind (frisch geuploadete Videos
   *  brauchen 15-60s bis Bunny die MP4 bereit hat). */
  const autoRetryRef = React.useRef(0);
  const [autoRetrying, setAutoRetrying] = React.useState(false);

  // Bunny-Stream-HLS → progressive MP4 (480p existiert für jedes Video —
  // sobald Bunny fertig encodiert hat).
  const src = React.useMemo(() => pickBunnyMp4Fallback(url), [url]);

  const startSecRef = React.useRef(startSec);
  React.useEffect(() => {
    startSecRef.current = startSec;
  }, [startSec]);
  const onPlaybackRef = React.useRef(onPlayback);
  React.useEffect(() => {
    onPlaybackRef.current = onPlayback;
  }, [onPlayback]);
  const playingRef = React.useRef(false);
  React.useEffect(() => {
    playingRef.current = playing;
  }, [playing]);

  // Initial (und nach Retry) auf die Fortsetzungsposition springen —
  // das ist zugleich das Poster-Standbild.
  React.useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const seek = () => {
      if (startSecRef.current > 0) v.currentTime = startSecRef.current;
    };
    if (v.readyState >= 1) seek();
    else v.addEventListener("loadedmetadata", seek, { once: true });
    return () => v.removeEventListener("loadedmetadata", seek);
  }, [loadNonce]);

  // Aufnahme-Start (Standby → Countdown): pausieren + zurückspulen.
  const mountedNonceRef = React.useRef(resetNonce);
  React.useEffect(() => {
    if (resetNonce === mountedNonceRef.current) return;
    mountedNonceRef.current = resetNonce;
    const v = videoRef.current;
    if (!v) return;
    v.pause();
    v.currentTime = startSecRef.current;
    setPlaying(false);
  }, [resetNonce]);

  // Unmount (Szenenwechsel/Phasenwechsel): laufende Wiedergabe pausiert
  // implizit → dem Host melden, damit Position + mediaPause-Event stimmen.
  React.useEffect(() => {
    return () => {
      const v = videoRef.current;
      if (v && playingRef.current) {
        v.pause();
        onPlaybackRef.current?.(false, v.currentTime);
      }
    };
  }, []);

  const toggle = React.useCallback(() => {
    const v = videoRef.current;
    if (!v || !onPlaybackRef.current) return;
    if (v.paused) {
      void v
        .play()
        .then(() => {
          setPlaying(true);
          onPlaybackRef.current?.(true, v.currentTime);
        })
        .catch(() => setFailed(true));
    } else {
      v.pause();
      setPlaying(false);
      onPlaybackRef.current?.(false, v.currentTime);
    }
  }, []);

  const handleEnded = React.useCallback(() => {
    const v = videoRef.current;
    setPlaying(false);
    onPlaybackRef.current?.(false, v ? v.currentTime : 0);
  }, []);

  const retry = React.useCallback(() => {
    setFailed(false);
    setAutoRetrying(false);
    setPlaying(false);
    autoRetryRef.current = 0;
    setLoadNonce((n) => n + 1);
    videoRef.current?.load();
  }, []);

  // Auto-Retry bei Load-Fehler: Bunny braucht nach dem Upload 15-60s
  // Encoding-Zeit für den 480p-MP4-Fallback. In dieser Zeit gibt Bunny
  // 404 zurück — der User sah bisher „Video konnte nicht geladen werden"
  // und musste manuell klicken. Wir versuchen leise 5× mit Backoff.
  const handleError = React.useCallback(() => {
    if (autoRetryRef.current < 5) {
      autoRetryRef.current += 1;
      setAutoRetrying(true);
      const delayMs = Math.min(3000 + autoRetryRef.current * 2000, 15000);
      window.setTimeout(() => {
        setLoadNonce((n) => n + 1);
        videoRef.current?.load();
      }, delayMs);
    } else {
      setAutoRetrying(false);
      setFailed(true);
    }
  }, []);
  const handleLoadedData = React.useCallback(() => {
    // Erfolgreich geladen → Auto-Retry-Counter zurücksetzen.
    autoRetryRef.current = 0;
    setAutoRetrying(false);
    setFailed(false);
  }, []);

  const locked = !onPlayback;

  return (
    <div
      className="group absolute inset-0"
      style={{ backgroundColor: MEDIA_STAGE_BG }}
    >
      <video
        key={loadNonce}
        ref={videoRef}
        src={src}
        playsInline
        preload="metadata"
        onEnded={handleEnded}
        onError={handleError}
        onLoadedData={handleLoadedData}
        className="size-full object-contain"
      />

      {autoRetrying && !failed && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-2 bg-black/40 text-white">
          <span className="inline-block size-5 rounded-full border-2 border-white/40 border-t-white animate-spin" />
          <p className="max-w-xs text-center text-xs leading-relaxed">
            Dein Video wird gerade fertig aufbereitet…
          </p>
        </div>
      )}
      {failed ? (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-black/50 text-white">
          <AlertCircle className="size-6" />
          <p className="max-w-xs text-center text-xs leading-relaxed">
            Das Video konnte nicht geladen werden. Direkt nach dem Hochladen
            kann die Aufbereitung noch einen Moment dauern.
          </p>
          <button
            type="button"
            onClick={retry}
            className="flex items-center gap-1.5 rounded-full bg-white/90 px-4 py-1.5 text-xs font-semibold text-ink shadow-card transition-colors hover:bg-white"
          >
            <RotateCcw className="size-3.5" />
            Erneut versuchen
          </button>
        </div>
      ) : (
        !locked && (
          <button
            type="button"
            aria-label={playing ? "Video pausieren" : "Video abspielen"}
            onClick={toggle}
            className={cn(
              "absolute left-1/2 top-1/2 z-20 flex size-16 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 text-ink shadow-lift backdrop-blur-sm transition-all duration-300 hover:scale-105 hover:bg-white",
              playing
                ? "opacity-0 group-hover:opacity-100"
                : "opacity-100",
            )}
          >
            {playing ? (
              <Pause className="size-6 fill-current" />
            ) : (
              <Play className="size-6 translate-x-0.5 fill-current" />
            )}
          </button>
        )
      )}
    </div>
  );
}
