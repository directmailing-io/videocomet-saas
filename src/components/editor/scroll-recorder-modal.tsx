"use client";

import * as React from "react";
import {
  Check,
  Clock,
  Loader2,
  RotateCcw,
  Square,
  AlertCircle,
  Video as VideoIcon,
  VideoOff,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ScrollFrame, Segment } from "@/lib/segments/types";
import { friendlyScreenshotError } from "@/lib/screenshot-error-text";
import { segmentStartMs } from "@/lib/segments/timeline";
import {
  DOC_VIEWER_HEIGHT_PX,
  DOC_VIEWER_WIDTH_PX,
  PDF_TOOLBAR_HEIGHT_PX,
  docStackLayout,
} from "@/lib/segments/doc-geometry";
import {
  buildPdfToolbarHtml,
  getPdfViewerCss,
} from "@/worker/lib/pdf-viewer-html";
import { WebcamMonitor } from "./webcam-monitor";

/**
 * Preview source – three mutually-exclusive variants that the modal
 * needs to support side-by-side:
 *
 *  - `image`:  Legacy fullPage JPG for normal websites. Scrolled by a
 *              wrapping <div> with overflow-auto.
 *  - `iframe`: Same-origin HTML preview for Google-Docs URLs. Scrolled
 *              by the iframe's own content window (so the fixed
 *              Google-Docs-style toolbar at top:0/height:160px stays
 *              put just like in the real renderer).
 *  - `pages`:  Bereits vorgerasterte Seiten-PNGs (PDF-Segmente) — kein
 *              Screenshot-Job nötig, der Seiten-Stapel wird direkt in
 *              einem overflow-auto-<div> gescrollt (gleiche Sampling-
 *              Mechanik wie `image` über imageViewportRef).
 *
 * All produce a {t,y} ratio (0..1) stream — only the sampling source
 * differs (DOM div vs iframe.contentDocument.scrollingElement).
 */
type PreviewSource =
  | {
      kind: "image";
      imageUrl: string;
    }
  | {
      kind: "iframe";
      previewUrl: string;
      docWidth: number;
      docHeight: number;
      pageCount: number;
    }
  | {
      kind: "pages";
      pageUrls: string[];
      docWidth: number;
      docHeight: number;
      fileName?: string;
    };

/** Direkte Seiten-Quelle (PDF): umgeht den Screenshot-Job komplett. */
export interface ScrollRecorderPagesSource {
  pageUrls: string[];
  /** Pixel-Maße EINER Seite (150 dpi) — für das Seiten-Seitenverhältnis. */
  docWidth: number;
  docHeight: number;
  /** Dateiname für die Viewer-Toolbar. */
  fileName?: string;
}

type Phase =
  | { kind: "loading" }
  | { kind: "failed"; message: string }
  | { kind: "ready" }
  | { kind: "countdown"; n: 3 | 2 | 1 }
  | { kind: "recording"; elapsedMs: number }
  | { kind: "done"; frames: ScrollFrame[] };

interface ScrollRecorderModalProps {
  open: boolean;
  onClose: () => void;
  targetUrl: string;
  segmentDurationMs: number;
  initialFrames?: ScrollFrame[];
  onSave: (frames: ScrollFrame[]) => void;
  /**
   * Webcam-PiP-Vorschau während der Aufnahme. Optional — wenn null oder
   * leer, ist der Toggle disabled (mit Hinweis).
   */
  webcamUrl?: string | null;
  /**
   * Vollständige Segment-Liste der Timeline. Wird für das Berechnen
   * der Webcam-Start/End-Sekunden benötigt.
   */
  allSegments?: Segment[] | null;
  /**
   * Index des aktuellen Segments innerhalb von `allSegments`. Null
   * (oder ohne `allSegments`) → Toggle disabled.
   */
  currentSegmentIndex?: number | null;
  /**
   * Optionale dritte Quelle: bereits vorgerenderte Seiten-PNGs (PDF).
   * Wenn gesetzt, wird KEIN Screenshot-Job gestartet — der Stapel ist
   * sofort scrollbar.
   */
  pages?: ScrollRecorderPagesSource | null;
  /**
   * Nebeneffekt-Hook: wird gefeuert, sobald der Screenshot-Job „done"
   * meldet. Der Aufrufer kann damit die Preview-Felder am Segment
   * persistieren (previewImageUrl bzw. previewPageUrls) — das Modal
   * selbst kennt das Segment nicht.
   */
  onPreviewLoaded?: (data: ScreenshotResult) => void;
}

/** localStorage-Key für die Persistenz des Webcam-Monitor-Toggles. */
const WEBCAM_MONITOR_STORAGE_KEY = "vc:webcam-monitor:enabled";

export interface ScreenshotResult {
  status: "pending" | "running" | "done" | "failed";
  // Website JPG flow
  imageUrl?: string;
  width?: number;
  height?: number;
  // Google-Docs HTML preview flow
  previewUrl?: string;
  /** Permanente Bunny-Seiten-PNGs (GDocs) — zum Persistieren am Segment. */
  pageImageUrls?: string[];
  docWidth?: number;
  docHeight?: number;
  pageCount?: number;
  error?: string;
}

const SAMPLE_INTERVAL_MS = 50;

function formatMs(ms: number): string {
  const total = Math.max(0, Math.floor(ms));
  const s = Math.floor(total / 1000);
  const cs = Math.floor((total % 1000) / 10);
  const mm = String(Math.floor(s / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return `${mm}:${ss}.${String(cs).padStart(2, "0")}`;
}

/**
 * Modal that lets the user record their own scroll movement over a
 * server-rendered preview (fullPage JPG for websites, or pixel-perfect
 * HTML preview with fixed Google-Docs toolbar for Google-Docs URLs).
 *
 * Pipeline:
 *   1. POST /api/screenshot  -> { jobId }
 *   2. GET  /api/screenshot/<jobId>  (poll until status === "done")
 *   3. Render preview in a 16:9 viewport:
 *        - image flow  -> scrollable <div> wrapping the JPG
 *        - iframe flow -> <iframe src={previewUrl}>, scrolled internally
 *   4. On "Aufnahme starten" -> 3-2-1 countdown -> record scroll for the
 *      segment duration (or until manual stop).
 *   5. On stop -> show summary, "Übernehmen" calls onSave with frames.
 */
export function ScrollRecorderModal({
  open,
  onClose,
  targetUrl,
  segmentDurationMs,
  initialFrames,
  onSave,
  webcamUrl,
  allSegments,
  currentSegmentIndex,
  pages,
  onPreviewLoaded,
}: ScrollRecorderModalProps) {
  const [phase, setPhase] = React.useState<Phase>({ kind: "loading" });
  const [source, setSource] = React.useState<PreviewSource | null>(null);
  const [jobId, setJobId] = React.useState<string | null>(null);
  const [iframeLoaded, setIframeLoaded] = React.useState(false);

  // ── Webcam-Monitor Toggle ──────────────────────────────────────────
  // Persistiert in localStorage unter `vc:webcam-monitor:enabled`.
  // Default OFF beim allerersten Aufruf (Key existiert nicht).
  const [webcamMonitorEnabled, setWebcamMonitorEnabled] = React.useState(false);
  React.useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(WEBCAM_MONITOR_STORAGE_KEY);
      if (raw === "1" || raw === "true") setWebcamMonitorEnabled(true);
    } catch {
      /* SSR / private mode → bleibt OFF */
    }
  }, []);
  const setWebcamMonitorEnabledPersisted = React.useCallback(
    (next: boolean) => {
      setWebcamMonitorEnabled(next);
      if (typeof window === "undefined") return;
      try {
        window.localStorage.setItem(
          WEBCAM_MONITOR_STORAGE_KEY,
          next ? "1" : "0",
        );
      } catch {
        /* ignore */
      }
    },
    [],
  );

  // Voraussetzungen für den Webcam-Monitor:
  //   - es gibt eine Webcam-URL
  //   - wir kennen die Position des Segments in der Timeline
  const webcamMonitorAvailable = Boolean(
    webcamUrl &&
      webcamUrl.length > 0 &&
      allSegments &&
      currentSegmentIndex != null &&
      currentSegmentIndex >= 0,
  );

  const imageViewportRef = React.useRef<HTMLDivElement | null>(null);
  const iframeRef = React.useRef<HTMLIFrameElement | null>(null);
  const startTimeRef = React.useRef<number>(0);
  const framesRef = React.useRef<ScrollFrame[]>([]);
  const samplerRef = React.useRef<ReturnType<typeof setInterval> | null>(null);
  const autoStopRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const rafTickRef = React.useRef<number | null>(null);
  const countdownRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimers = React.useCallback(() => {
    if (samplerRef.current !== null) {
      clearInterval(samplerRef.current);
      samplerRef.current = null;
    }
    if (autoStopRef.current !== null) {
      clearTimeout(autoStopRef.current);
      autoStopRef.current = null;
    }
    if (rafTickRef.current !== null) {
      cancelAnimationFrame(rafTickRef.current);
      rafTickRef.current = null;
    }
    if (countdownRef.current !== null) {
      clearTimeout(countdownRef.current);
      countdownRef.current = null;
    }
  }, []);

  // Reset state on modal close
  React.useEffect(() => {
    if (!open) {
      clearTimers();
      framesRef.current = [];
      setPhase({ kind: "loading" });
      setSource(null);
      setJobId(null);
      setIframeLoaded(false);
    }
  }, [open, clearTimers]);

  // onPreviewLoaded in einer Ref, damit acceptDoneResponse stabil bleibt.
  const onPreviewLoadedRef = React.useRef(onPreviewLoaded);
  React.useEffect(() => {
    onPreviewLoadedRef.current = onPreviewLoaded;
  }, [onPreviewLoaded]);

  // Helper that turns a "done" response into a PreviewSource, or
  // signals a failure if the shape is unrecognised.
  const acceptDoneResponse = React.useCallback(
    (data: ScreenshotResult): boolean => {
      // Nebeneffekt: Preview-Daten an den Aufrufer melden, damit er sie
      // am Segment persistieren kann (previewImageUrl/previewPageUrls).
      onPreviewLoadedRef.current?.(data);
      if (data.previewUrl) {
        setSource({
          kind: "iframe",
          previewUrl: data.previewUrl,
          docWidth: data.docWidth ?? 850,
          docHeight: data.docHeight ?? 0,
          pageCount: data.pageCount ?? 0,
        });
        setIframeLoaded(false);
        setPhase({ kind: "ready" });
        return true;
      }
      if (data.imageUrl) {
        setSource({ kind: "image", imageUrl: data.imageUrl });
        setPhase({ kind: "ready" });
        return true;
      }
      setPhase({
        kind: "failed",
        message:
          "Vorschau-Antwort ohne Bild- oder HTML-Quelle. Bitte erneut versuchen.",
      });
      return false;
    },
    [],
  );

  // Kick off screenshot job when modal opens
  React.useEffect(() => {
    if (!open) return;
    // Direkte Seiten-Quelle (PDF-Segmente): Seiten-PNGs existieren schon —
    // Screenshot-Job komplett überspringen, sofort ready.
    if (pages && pages.pageUrls.length > 0) {
      setSource({
        kind: "pages",
        pageUrls: pages.pageUrls,
        docWidth: pages.docWidth,
        docHeight: pages.docHeight,
        fileName: pages.fileName,
      });
      setPhase({ kind: "ready" });
      return;
    }
    if (!targetUrl) {
      setPhase({ kind: "failed", message: "Keine URL angegeben." });
      return;
    }
    let cancelled = false;
    let pollTimer: ReturnType<typeof setTimeout> | null = null;
    const pollStartTime = Date.now();
    const POLL_TIMEOUT_MS = 60_000;

    const poll = async (id: string) => {
      if (Date.now() - pollStartTime > POLL_TIMEOUT_MS) {
        setPhase({
          kind: "failed",
          message:
            "Vorschau-Erzeugung dauerte zu lange. Der Worker antwortet nicht.",
        });
        return;
      }
      try {
        const res = await fetch(`/api/screenshot/${id}`, {
          method: "GET",
          credentials: "same-origin",
        });
        if (cancelled) return;
        if (!res.ok) {
          setPhase({
            kind: "failed",
            message: `Vorschau konnte nicht geladen werden (HTTP ${res.status}).`,
          });
          return;
        }
        const data = (await res.json()) as ScreenshotResult;
        if (cancelled) return;
        if (data.status === "done") {
          acceptDoneResponse(data);
          return;
        }
        if (data.status === "failed") {
          setPhase({
            kind: "failed",
            message: friendlyScreenshotError(data.error),
          });
          return;
        }
        pollTimer = setTimeout(() => poll(id), 1000);
      } catch (err) {
        if (cancelled) return;
        setPhase({
          kind: "failed",
          message: err instanceof Error ? err.message : "Netzwerkfehler.",
        });
      }
    };

    const start = async () => {
      try {
        setPhase({ kind: "loading" });
        const res = await fetch("/api/screenshot", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: targetUrl }),
        });
        if (cancelled) return;
        if (!res.ok) {
          let msg = `HTTP ${res.status}`;
          try {
            const j = (await res.json()) as { error?: string };
            if (j.error) msg = j.error;
          } catch {
            /* ignore */
          }
          setPhase({ kind: "failed", message: msg });
          return;
        }
        const j = (await res.json()) as { jobId: string };
        setJobId(j.jobId);
        void poll(j.jobId);
      } catch (err) {
        if (cancelled) return;
        setPhase({
          kind: "failed",
          message: err instanceof Error ? err.message : "Netzwerkfehler.",
        });
      }
    };

    void start();
    return () => {
      cancelled = true;
      if (pollTimer) clearTimeout(pollTimer);
    };
  }, [open, targetUrl, acceptDoneResponse, pages]);

  // Read the current scroll ratio from whichever viewport is active.
  const readScrollRatio = React.useCallback((): number => {
    if (source?.kind === "iframe") {
      const ifr = iframeRef.current;
      const doc = ifr?.contentDocument;
      const win = ifr?.contentWindow;
      const scroller = doc?.scrollingElement as HTMLElement | null | undefined;
      if (!scroller || !win) return 0;
      const max = scroller.scrollHeight - win.innerHeight;
      if (max <= 0) return 0;
      return Math.min(1, Math.max(0, scroller.scrollTop / max));
    }
    const el = imageViewportRef.current;
    if (!el) return 0;
    const max = el.scrollHeight - el.clientHeight;
    return max > 0 ? Math.min(1, Math.max(0, el.scrollTop / max)) : 0;
  }, [source]);

  // Reset whichever viewport is active to the top.
  const resetScrollToTop = React.useCallback(() => {
    if (source?.kind === "iframe") {
      try {
        iframeRef.current?.contentWindow?.scrollTo(0, 0);
      } catch {
        /* cross-origin guard – shouldn't trigger for our proxy, but be safe */
      }
    } else if (imageViewportRef.current) {
      imageViewportRef.current.scrollTop = 0;
    }
  }, [source]);

  const sampleNow = React.useCallback(() => {
    const t = performance.now() - startTimeRef.current;
    const y = readScrollRatio();
    const arr = framesRef.current;
    const last = arr[arr.length - 1];
    if (last && Math.abs(last.y - y) < 0.001 && t - last.t < 200) {
      // Skip near-duplicate sample when user is idle.
      return;
    }
    arr.push({ t, y });
  }, [readScrollRatio]);

  const stopRecording = React.useCallback(() => {
    clearTimers();
    // Ensure trailing frame at exact stop time.
    sampleNow();
    setPhase({ kind: "done", frames: framesRef.current });
  }, [clearTimers, sampleNow]);

  const startActualRecording = React.useCallback(() => {
    startTimeRef.current = performance.now();
    framesRef.current = [{ t: 0, y: 0 }];
    setPhase({ kind: "recording", elapsedMs: 0 });

    const tick = () => {
      const elapsed = performance.now() - startTimeRef.current;
      setPhase({ kind: "recording", elapsedMs: elapsed });
      rafTickRef.current = requestAnimationFrame(tick);
    };
    rafTickRef.current = requestAnimationFrame(tick);

    samplerRef.current = setInterval(sampleNow, SAMPLE_INTERVAL_MS);
    autoStopRef.current = setTimeout(stopRecording, segmentDurationMs);
  }, [sampleNow, segmentDurationMs, stopRecording]);

  const beginRecording = React.useCallback(() => {
    if (!source) return;
    if (source.kind === "iframe" && !iframeLoaded) return;
    resetScrollToTop();
    framesRef.current = [];

    let count: 3 | 2 | 1 = 3;
    setPhase({ kind: "countdown", n: count });
    const step = () => {
      if (count === 1) {
        startActualRecording();
        return;
      }
      count = (count - 1) as 2 | 1;
      setPhase({ kind: "countdown", n: count });
      countdownRef.current = setTimeout(step, 800);
    };
    countdownRef.current = setTimeout(step, 800);
  }, [source, iframeLoaded, resetScrollToTop, startActualRecording]);

  // Sample on scroll events too (so user motion is captured immediately).
  // The listener target differs per flow:
  //   - image  -> the outer <div> with overflow-auto
  //   - iframe -> the iframe's own contentWindow (same-origin proxy
  //              guarantees JS access)
  React.useEffect(() => {
    if (phase.kind !== "recording") return;

    if (source?.kind === "iframe") {
      const win = iframeRef.current?.contentWindow;
      if (!win) return;
      const onScroll = () => sampleNow();
      win.addEventListener("scroll", onScroll, { passive: true });
      return () => win.removeEventListener("scroll", onScroll);
    }

    const el = imageViewportRef.current;
    if (!el) return;
    const onScroll = () => sampleNow();
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [phase.kind, sampleNow, source]);

  // Countdown lockout: freeze the scroll source so the user cannot move
  // before the recording actually begins.
  React.useEffect(() => {
    if (source?.kind !== "iframe") return;
    if (phase.kind !== "countdown") return;
    const doc = iframeRef.current?.contentDocument;
    const root = doc?.documentElement;
    if (!root) return;
    // Reset to top first so applying overflow:hidden doesn't visually shift.
    try {
      iframeRef.current?.contentWindow?.scrollTo(0, 0);
    } catch {
      /* ignore */
    }
    const prev = root.style.overflow;
    root.style.overflow = "hidden";
    return () => {
      root.style.overflow = prev;
    };
  }, [phase.kind, source]);

  // Cleanup on unmount
  React.useEffect(() => clearTimers, [clearTimers]);

  // If user re-opens with existing frames, keep them visible as a hint.
  const initialHint = React.useMemo(() => {
    if (!initialFrames || initialFrames.length === 0) return null;
    const lastT = initialFrames[initialFrames.length - 1]?.t ?? 0;
    return `Vorherige Aufnahme: ${initialFrames.length} Frames, ${formatMs(lastT)} lang.`;
  }, [initialFrames]);

  // ── Webcam-Monitor: Start/End-Sec + State-Mapping ─────────────────────
  // Berechnet das Webcam-Zeitfenster aus dem Segment-Index. Identische
  // Akkumulations-Logik wie im PreviewPlayer (siehe segmentStartMs).
  const webcamWindow = React.useMemo(() => {
    if (!webcamMonitorAvailable || !allSegments || currentSegmentIndex == null) {
      return null;
    }
    const startMs = segmentStartMs(allSegments, currentSegmentIndex);
    const seg = allSegments[currentSegmentIndex];
    const durMs = seg?.durationMs ?? segmentDurationMs;
    return {
      startSec: startMs / 1000,
      endSec: (startMs + Math.max(0, durMs)) / 1000,
    };
  }, [
    webcamMonitorAvailable,
    allSegments,
    currentSegmentIndex,
    segmentDurationMs,
  ]);

  // Mapping Phase → WebcamMonitor-State.
  //   recording                → "playing"
  //   countdown                → "paused" (Video bleibt am ersten Frame)
  //   loading | failed | ready
  //   | done                   → "paused"
  const webcamMonitorState: "idle" | "playing" | "paused" =
    phase.kind === "recording" ? "playing" : "paused";

  const webcamMonitorElapsedMs =
    phase.kind === "recording" ? phase.elapsedMs : undefined;

  // ── Retry (POST /api/screenshot again on the same URL) ─────────────────
  const retryScreenshot = React.useCallback(() => {
    setJobId(null);
    setSource(null);
    setIframeLoaded(false);
    setPhase({ kind: "loading" });
    void (async () => {
      try {
        const res = await fetch("/api/screenshot", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: targetUrl }),
        });
        if (!res.ok) {
          setPhase({
            kind: "failed",
            message: `HTTP ${res.status}`,
          });
          return;
        }
        const j = (await res.json()) as { jobId: string };
        setJobId(j.jobId);
        const poll = async () => {
          const r = await fetch(`/api/screenshot/${j.jobId}`);
          if (!r.ok) {
            setPhase({
              kind: "failed",
              message: `HTTP ${r.status}`,
            });
            return;
          }
          const d = (await r.json()) as ScreenshotResult;
          if (d.status === "done") {
            acceptDoneResponse(d);
          } else if (d.status === "failed") {
            setPhase({
              kind: "failed",
              message: d.error || "Fehler.",
            });
          } else {
            setTimeout(poll, 1000);
          }
        };
        void poll();
      } catch (err) {
        setPhase({
          kind: "failed",
          message: err instanceof Error ? err.message : "Netzwerkfehler.",
        });
      }
    })();
  }, [targetUrl, acceptDoneResponse]);

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) {
          if (phase.kind === "recording" || phase.kind === "countdown") {
            const ok = window.confirm(
              "Aufnahme läuft. Abbrechen und Daten verwerfen?",
            );
            if (!ok) return;
          }
          clearTimers();
          onClose();
        }
      }}
    >
      <DialogContent
        size="xl"
        className="max-w-4xl w-[min(96vw,1024px)] max-h-[90vh] grid-rows-[auto_1fr_auto]"
      >
        <div>
          <DialogTitle>Scroll-Aufnahme</DialogTitle>
          <DialogDescription>
            Scrolle frei durch die Vorschau — nur deine Bewegung wird
            aufgezeichnet und läuft später über die personalisierte Seite
            jedes Leads.
          </DialogDescription>
          {initialHint && phase.kind === "ready" && (
            <p className="mt-2 text-xs text-ink-muted">{initialHint}</p>
          )}
        </div>

        <ViewportArea
          phase={phase}
          source={source}
          imageViewportRef={imageViewportRef}
          iframeRef={iframeRef}
          segmentDurationMs={segmentDurationMs}
          onIframeLoad={() => setIframeLoaded(true)}
          onIframeError={() =>
            setPhase({
              kind: "failed",
              message:
                "HTML-Vorschau konnte nicht geladen werden. Bitte erneut versuchen.",
            })
          }
          onRetry={retryScreenshot}
        />

        <Controls
          phase={phase}
          source={source}
          iframeLoaded={iframeLoaded}
          segmentDurationMs={segmentDurationMs}
          webcamMonitorAvailable={webcamMonitorAvailable}
          webcamMonitorEnabled={webcamMonitorEnabled}
          onToggleWebcamMonitor={setWebcamMonitorEnabledPersisted}
          onStart={beginRecording}
          onStop={stopRecording}
          onSave={() => {
            if (phase.kind === "done") {
              onSave(phase.frames);
              clearTimers();
              onClose();
            }
          }}
          onRestart={() => {
            framesRef.current = [];
            setPhase({ kind: "ready" });
            resetScrollToTop();
          }}
          onCancel={() => {
            if (phase.kind === "recording" || phase.kind === "countdown") {
              const ok = window.confirm(
                "Aufnahme läuft. Abbrechen und Daten verwerfen?",
              );
              if (!ok) return;
            }
            clearTimers();
            onClose();
          }}
        />
      </DialogContent>

      {/* Webcam-Monitor: floating PiP-Vorschau über dem ganzen Viewport.
          Wird nur gerendert, wenn:
            - Toggle in der Toolbar ist AN
            - Modal sichtbar (open)
            - Webcam-URL + Segment-Index verfügbar
          Beim Klick auf das ×-Icon im Monitor wird der Toggle deaktiviert. */}
      {open &&
        webcamMonitorEnabled &&
        webcamMonitorAvailable &&
        webcamWindow &&
        webcamUrl && (
          <WebcamMonitor
            webcamUrl={webcamUrl}
            startSec={webcamWindow.startSec}
            endSec={webcamWindow.endSec}
            state={webcamMonitorState}
            elapsedMs={webcamMonitorElapsedMs}
            onClose={() => setWebcamMonitorEnabledPersisted(false)}
          />
        )}
    </Dialog>
  );
}

/**
 * Two viewport components live side-by-side here on purpose:
 *
 *  - ImageViewport:  scrolled by the outer <div> (overflow-auto). Locking
 *                    the user out during countdown is a CSS toggle.
 *  - IframeViewport: scrolled by the iframe's own contentWindow. The
 *                    iframe loads a same-origin proxied HTML preview that
 *                    already styles itself (fixed 160px Google-Docs
 *                    toolbar + scrolling doc-stack column).
 *
 * The two flows can't share a single scroll container because the iframe
 * must own its own scroll mechanics (so the inner fixed toolbar stays put
 * exactly as in the worker-rendered HTML, identical to the final video).
 */
function ViewportArea({
  phase,
  source,
  imageViewportRef,
  iframeRef,
  segmentDurationMs,
  onIframeLoad,
  onIframeError,
}: {
  phase: Phase;
  source: PreviewSource | null;
  imageViewportRef: React.MutableRefObject<HTMLDivElement | null>;
  iframeRef: React.MutableRefObject<HTMLIFrameElement | null>;
  segmentDurationMs: number;
  onIframeLoad: () => void;
  onIframeError: () => void;
  onRetry: () => void;
}) {
  if (phase.kind === "loading") {
    return (
      <div className="flex flex-col items-center justify-center gap-3 rounded-squircle-md bg-surface-soft py-20">
        <Loader2 className="size-6 animate-spin text-brand-deep" />
        <p className="text-sm text-ink-muted">
          Lade Vorschau des Dokuments…
        </p>
        <p className="text-xs text-ink-muted">
          Dies kann 5–15 Sekunden dauern.
        </p>
      </div>
    );
  }

  if (phase.kind === "failed") {
    return (
      <div className="flex flex-col items-center justify-center gap-3 rounded-squircle-md bg-danger-soft/60 py-12 px-6 text-center">
        <AlertCircle className="size-6 text-danger" />
        <p className="text-sm font-semibold text-ink">
          Vorschau konnte nicht geladen werden
        </p>
        <p className="text-xs text-ink-muted max-w-md">{phase.message}</p>
      </div>
    );
  }

  return (
    <div className="relative">
      {/* progress bar during recording */}
      {phase.kind === "recording" && (
        <div className="absolute inset-x-0 top-0 z-10 h-1 bg-line">
          <div
            className="h-full bg-brand transition-[width] duration-100"
            style={{
              width: `${Math.min(100, (phase.elapsedMs / segmentDurationMs) * 100)}%`,
            }}
          />
        </div>
      )}

      {source?.kind === "iframe" ? (
        <IframeViewport
          previewUrl={source.previewUrl}
          iframeRef={iframeRef}
          onLoad={onIframeLoad}
          onError={onIframeError}
        />
      ) : source?.kind === "pages" ? (
        <PagesViewport
          pageUrls={source.pageUrls}
          docWidth={source.docWidth}
          docHeight={source.docHeight}
          fileName={source.fileName}
          viewportRef={imageViewportRef}
          lockScroll={phase.kind === "countdown"}
        />
      ) : (
        <ImageViewport
          imageUrl={source?.kind === "image" ? source.imageUrl : undefined}
          viewportRef={imageViewportRef}
          lockScroll={phase.kind === "countdown"}
        />
      )}

      {/* countdown overlay – sits above the iframe so pointer-events:none
          there still blocks the user from triggering content interactions */}
      {phase.kind === "countdown" && (
        <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-ink/40 backdrop-blur-sm rounded-squircle-md">
          <div className="text-white text-8xl font-bold drop-shadow-lg">
            {phase.n}
          </div>
        </div>
      )}

      {/* recording badge */}
      {phase.kind === "recording" && (
        <div className="absolute top-3 right-3 z-20 flex items-center gap-2 rounded-full bg-danger px-3 py-1.5 text-white text-xs font-semibold shadow-lift">
          <span className="size-2 rounded-full bg-white animate-pulse" />
          REC {formatMs(phase.elapsedMs)} / {formatMs(segmentDurationMs)}
        </div>
      )}
    </div>
  );
}

function ImageViewport({
  imageUrl,
  viewportRef,
  lockScroll,
}: {
  imageUrl: string | undefined;
  viewportRef: React.MutableRefObject<HTMLDivElement | null>;
  lockScroll: boolean;
}) {
  return (
    <div
      ref={viewportRef}
      className={cn(
        "aspect-video w-full overflow-auto rounded-squircle-md bg-white shadow-card",
        lockScroll && "overflow-hidden",
      )}
    >
      {imageUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={imageUrl}
          alt="Dokument-Vorschau"
          className="block w-full h-auto select-none"
          draggable={false}
        />
      )}
    </div>
  );
}

/**
 * Scrollbarer Seiten-Stapel für die `pages`-Quelle (PDF): exakt die
 * Worker-Geometrie (doc-geometry.ts) — Seitenbreite 826/1280, skalierter
 * 24px-Gap, sticky Drive-Toolbar (56px skaliert), KEIN Außen-Padding.
 * Dadurch entspricht `scrollTop/(scrollHeight−clientHeight)` 1:1 der
 * Worker-scrollRatio. Echtes overflow-auto-Scrolling (der Recorder
 * sampelt scrollTop des Divs, identisch zum image-Flow).
 */
function PagesViewport({
  pageUrls,
  docWidth,
  docHeight,
  fileName,
  viewportRef,
  lockScroll,
}: {
  pageUrls: string[];
  docWidth: number;
  docHeight: number;
  fileName?: string;
  viewportRef: React.MutableRefObject<HTMLDivElement | null>;
  lockScroll: boolean;
}) {
  const [stage, setStage] = React.useState({ width: 0, height: 0 });
  React.useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const update = () =>
      setStage({ width: el.clientWidth, height: el.clientHeight });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [viewportRef]);

  const pageAspect =
    docWidth > 0 && docHeight > 0 ? docWidth / docHeight : 1 / Math.SQRT2;
  const layout = docStackLayout({
    stageWidth: stage.width,
    stageHeight: stage.height,
    pageAspect,
    pageCount: pageUrls.length,
    variant: "pdf",
  });

  const toolbarCss = React.useMemo(() => getPdfViewerCss(), []);
  const toolbarHtml = React.useMemo(
    () =>
      buildPdfToolbarHtml({
        fileName: fileName || "Dokument.pdf",
        pageCount: Math.max(1, pageUrls.length),
      }),
    [fileName, pageUrls.length],
  );

  return (
    <div
      ref={viewportRef}
      className={cn(
        "aspect-video w-full overflow-auto rounded-squircle-md bg-[#525659] shadow-card",
        lockScroll && "overflow-hidden",
      )}
    >
      <style dangerouslySetInnerHTML={{ __html: toolbarCss }} />
      {/* Sticky Toolbar: Layout-Höhe = skalierte 56px, Inhalt ist das echte
          Worker-HTML in 1280px Breite, per transform skaliert
          (position:fixed wird vom transform eingefangen). */}
      <div className="sticky top-0 z-10" style={{ height: layout.toolbarPx }}>
        <div
          style={{
            width: `${DOC_VIEWER_WIDTH_PX}px`,
            height: `${PDF_TOOLBAR_HEIGHT_PX}px`,
            transform: `scale(${layout.scale})`,
            transformOrigin: "top left",
          }}
          dangerouslySetInnerHTML={{ __html: toolbarHtml }}
        />
      </div>
      <div
        className="flex flex-col items-center"
        style={{ gap: `${layout.gapPx}px` }}
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
  );
}

/**
 * GDocs-Vorschau: iframe fest im Worker-Referenz-Viewport 1280×720 und per
 * CSS-transform auf die Modalbreite skaliert. Nur so stimmen die
 * Proportionen (850px-Stapel, 160px-Toolbar) mit dem Worker-Render überein
 * — bei variabler iframe-Breite wäre die scrollRatio nicht 1:1 übertragbar.
 */
function IframeViewport({
  previewUrl,
  iframeRef,
  onLoad,
  onError,
}: {
  previewUrl: string;
  iframeRef: React.MutableRefObject<HTMLIFrameElement | null>;
  onLoad: () => void;
  onError: () => void;
}) {
  const wrapRef = React.useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = React.useState(0);
  React.useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const update = () => setWidth(el.clientWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const scale = width > 0 ? width / DOC_VIEWER_WIDTH_PX : 0;

  return (
    <div
      ref={wrapRef}
      className="relative aspect-video w-full overflow-hidden rounded-squircle-md bg-white shadow-card"
    >
      <iframe
        ref={iframeRef}
        src={previewUrl}
        onLoad={onLoad}
        onError={onError}
        title="Google-Docs-Vorschau"
        className="block bg-white"
        style={{
          width: `${DOC_VIEWER_WIDTH_PX}px`,
          height: `${DOC_VIEWER_HEIGHT_PX}px`,
          transform: `scale(${scale})`,
          transformOrigin: "top left",
        }}
      />
    </div>
  );
}

function Controls({
  phase,
  source,
  iframeLoaded,
  segmentDurationMs,
  webcamMonitorAvailable,
  webcamMonitorEnabled,
  onToggleWebcamMonitor,
  onStart,
  onStop,
  onSave,
  onRestart,
  onCancel,
}: {
  phase: Phase;
  source: PreviewSource | null;
  iframeLoaded: boolean;
  segmentDurationMs: number;
  webcamMonitorAvailable: boolean;
  webcamMonitorEnabled: boolean;
  onToggleWebcamMonitor: (next: boolean) => void;
  onStart: () => void;
  onStop: () => void;
  onSave: () => void;
  onRestart: () => void;
  onCancel: () => void;
}) {
  // Der Webcam-Monitor-Toggle ist nur in den Phasen sichtbar/sinnvoll, in
  // denen man "noch keine Aufnahme läuft" — also Loading/Ready/Done. Während
  // Countdown/Recording bleibt er ausgeblendet (der Recorder kümmert sich
  // ums State-Mapping eigenständig). Damit der User in Phase=failed nicht
  // verwirrt wird, blenden wir den Toggle dort ebenfalls aus.
  const showToggle =
    phase.kind === "loading" ||
    phase.kind === "ready" ||
    phase.kind === "done";

  const toggle = showToggle ? (
    <WebcamMonitorToggle
      available={webcamMonitorAvailable}
      enabled={webcamMonitorEnabled}
      onChange={onToggleWebcamMonitor}
    />
  ) : null;

  if (phase.kind === "loading") {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3">
        {toggle ?? <span />}
        <Button variant="ghost" onClick={onCancel}>
          Abbrechen
        </Button>
      </div>
    );
  }
  if (phase.kind === "failed") {
    return (
      <div className="flex justify-end">
        <Button variant="ghost" onClick={onCancel}>
          Schließen
        </Button>
      </div>
    );
  }
  if (phase.kind === "ready") {
    // For the iframe flow we must wait until the HTML preview has loaded
    // before we attach scroll listeners or sample contentDocument, so the
    // button is disabled until then. For the image flow this is irrelevant.
    const waitingForIframe =
      source?.kind === "iframe" && !iframeLoaded;
    return (
      <div className="flex flex-wrap items-center gap-3">
        {toggle}
        <span className="inline-flex items-center gap-1.5 rounded-full bg-canvas-deep px-3 py-1.5 text-xs font-medium text-ink-muted">
          <Clock className="size-3.5" />
          {waitingForIframe
            ? "Vorschau wird gerendert …"
            : `max. ${formatMs(segmentDurationMs)}`}
        </span>
        <div className="ml-auto flex items-center gap-3">
          <Button variant="ghost" onClick={onCancel}>
            Abbrechen
          </Button>
          <Button
            onClick={onStart}
            disabled={waitingForIframe}
            iconLeft={
              <span className="size-2.5 rounded-full bg-danger ring-2 ring-white/40" />
            }
          >
            Aufnahme starten
          </Button>
        </div>
      </div>
    );
  }
  if (phase.kind === "countdown") {
    return (
      <div className="flex justify-end">
        <Button variant="ghost" onClick={onCancel}>
          Abbrechen
        </Button>
      </div>
    );
  }
  if (phase.kind === "recording") {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <span className="inline-flex items-center gap-2 rounded-full bg-danger-soft/70 px-3 py-1.5 text-xs font-semibold text-danger tabular-nums">
          <span className="size-2 animate-pulse rounded-full bg-danger" />
          {formatMs(phase.elapsedMs)} / {formatMs(segmentDurationMs)}
        </span>
        <p className="text-xs text-ink-muted">
          Scrolle frei. Auto-Stop bei {formatMs(segmentDurationMs)}.
        </p>
        <div className="ml-auto">
          <Button
            variant="danger"
            onClick={onStop}
            iconLeft={<Square className="size-4" />}
          >
            Aufnahme stoppen
          </Button>
        </div>
      </div>
    );
  }
  if (phase.kind === "done") {
    const lastT = phase.frames[phase.frames.length - 1]?.t ?? 0;
    return (
      <div className="flex flex-wrap items-center gap-3">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-ok-soft px-3 py-1.5 text-xs font-semibold text-ok">
          <Check className="size-3.5" />
          {formatMs(lastT)} aufgenommen
        </span>
        <div className="ml-auto flex items-center gap-3">
          <Button
            variant="ghost"
            onClick={onRestart}
            iconLeft={<RotateCcw className="size-4" />}
          >
            Erneut aufnehmen
          </Button>
          <Button onClick={onSave} iconLeft={<Check className="size-4" />}>
            Übernehmen
          </Button>
        </div>
      </div>
    );
  }
  return null;
}

/**
 * Toggle-Switch für die Webcam-PiP-Vorschau in der Recorder-Toolbar.
 *
 * - Persistenz erfolgt im Parent (localStorage Key `vc:webcam-monitor:enabled`).
 * - Disabled, wenn entweder keine Webcam-URL existiert oder wir den Segment-
 *   Index nicht kennen (`available === false`). Der `title`-Tooltip erklärt
 *   den Grund, damit der User nicht raten muss.
 */
function WebcamMonitorToggle({
  available,
  enabled,
  onChange,
}: {
  available: boolean;
  enabled: boolean;
  onChange: (next: boolean) => void;
}) {
  const Icon = enabled ? VideoIcon : VideoOff;
  const disabledTitle =
    "Wähle erst in Schritt 1 ein Webcam-Video";
  const activeTitle = enabled
    ? "Webcam-Vorschau ausblenden"
    : "Webcam-Vorschau einblenden";
  return (
    <button
      type="button"
      onClick={() => available && onChange(!enabled)}
      disabled={!available}
      aria-pressed={enabled}
      title={available ? activeTitle : disabledTitle}
      className={cn(
        "inline-flex items-center gap-2 self-start rounded-full px-3 py-1.5 text-xs font-medium transition-colors",
        available
          ? enabled
            ? "bg-brand-soft text-brand-deep hover:bg-brand-100"
            : "bg-canvas-deep text-ink hover:bg-line-soft"
          : "bg-surface-soft text-ink-muted cursor-not-allowed",
      )}
    >
      <Icon className="size-3.5" />
      <span>Webcam mit Ton einblenden</span>
      <span
        aria-hidden
        className={cn(
          "ml-1 inline-flex h-4 w-7 items-center rounded-full transition-colors",
          available && enabled ? "bg-brand" : "bg-ink/15",
        )}
      >
        <span
          className={cn(
            "inline-block size-3 transform rounded-full bg-white shadow-sm transition-transform",
            available && enabled ? "translate-x-3.5" : "translate-x-0.5",
          )}
        />
      </span>
    </button>
  );
}
