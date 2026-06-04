"use client";

/**
 * webcam-monitor — Draggable PiP-Overlay, das während der Scroll-Aufzeichnung
 * die Webcam-Spur synchron zum Zeit-Fenster der aktuellen Folie zeigt.
 *
 * Reines Presentational-Component: kein eigener Recording-State, alle
 * Lifecycle-Entscheidungen kommen über `state`-Prop vom Scroll-Recorder.
 *
 * State-Verhalten (kurz):
 *   mount             currentTime = startSec, paused. preload="metadata".
 *   state="playing"   → play(). state="paused" | "idle" → pause().
 *   currentTime ≥ end → automatisch pause() (kein Über-die-Folie-Spielen).
 *   elapsedMs gesetzt → alle 500ms Drift-Check; |Δ| > 0.3s → Hard-Seek.
 *
 * Layout:
 *   240 × 160 px, fixed, draggable per Header. Position in localStorage.
 *   Header-Bar: REC-Dot + mm:ss/mm:ss + ×.  Mitte: <video>. Unten: Progress.
 */

import * as React from "react";
import { Volume2, VolumeX, Volume1, X } from "lucide-react";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/* Public Interface (FIX — Agent B verlässt sich darauf)               */
/* ------------------------------------------------------------------ */

export interface WebcamMonitorProps {
  webcamUrl: string;
  startSec: number;
  endSec: number;
  /** Lifecycle wird vom Recorder gesteuert */
  state: "idle" | "playing" | "paused";
  /** Recording-Position relative zum Start der Folie (für Time-Strip + Drift) */
  elapsedMs?: number;
  onClose?: () => void;
}

/* ------------------------------------------------------------------ */
/* Konstanten                                                          */
/* ------------------------------------------------------------------ */

const BOX_W = 240;
const BOX_H = 160;
const DEFAULT_MARGIN = 24;

const POS_STORAGE_KEY = "vc:webcam-monitor:pos";
const VOL_STORAGE_KEY = "vc:webcam-monitor:vol";

/** Drift-Check Intervall in ms (siehe Spec). */
const DRIFT_CHECK_INTERVAL_MS = 500;
/** Drift-Schwelle in Sekunden (siehe Spec). */
const DRIFT_THRESHOLD_SEC = 0.3;

/** Erlaubte Volume-Stufen (Cycle: 0 → 0.3 → 1 → 0). */
const VOLUME_STEPS = [0, 0.3, 1] as const;
type VolumeStep = (typeof VOLUME_STEPS)[number];

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

/**
 * Normalisiert eine Bunny-HLS-URL auf ihren MP4-Fallback. Native <video>
 * spielt HLS nur in Safari — der MP4-Fallback existiert immer für aktivierte
 * MP4-Streams in Bunny.
 *
 * Pattern wiederverwendet aus `lib/db/queries/custom-lp-public.ts`.
 */
function normalizeWebcamUrl(url: string): string {
  if (!url) return url;
  return url.replace(/\/playlist\.m3u8(?:\?.*)?$/, "/play_720p.mp4");
}

function formatMMSS(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  const total = Math.floor(sec);
  const mm = Math.floor(total / 60);
  const ss = total % 60;
  return `${mm}:${ss.toString().padStart(2, "0")}`;
}

/** Liest Position aus localStorage und clamped sie auf den sichtbaren Viewport. */
function readStoredPosition(): { x: number; y: number } | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(POS_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (
      parsed &&
      typeof parsed === "object" &&
      typeof (parsed as { x?: unknown }).x === "number" &&
      typeof (parsed as { y?: unknown }).y === "number"
    ) {
      return { x: (parsed as { x: number }).x, y: (parsed as { y: number }).y };
    }
  } catch {
    /* ignore */
  }
  return null;
}

function readStoredVolume(): VolumeStep {
  if (typeof window === "undefined") return 0.3;
  try {
    const raw = window.localStorage.getItem(VOL_STORAGE_KEY);
    if (!raw) return 0.3;
    const v = Number(raw);
    if (VOLUME_STEPS.includes(v as VolumeStep)) return v as VolumeStep;
  } catch {
    /* ignore */
  }
  return 0.3;
}

function clampToViewport(pos: { x: number; y: number }): { x: number; y: number } {
  if (typeof window === "undefined") return pos;
  const maxX = Math.max(0, window.innerWidth - BOX_W);
  const maxY = Math.max(0, window.innerHeight - BOX_H);
  return {
    x: Math.max(0, Math.min(maxX, pos.x)),
    y: Math.max(0, Math.min(maxY, pos.y)),
  };
}

function getDefaultPosition(): { x: number; y: number } {
  if (typeof window === "undefined") {
    return { x: 0, y: 0 };
  }
  return {
    x: Math.max(0, window.innerWidth - BOX_W - DEFAULT_MARGIN),
    y: Math.max(0, window.innerHeight - BOX_H - DEFAULT_MARGIN),
  };
}

function nextVolumeStep(current: VolumeStep): VolumeStep {
  const idx = VOLUME_STEPS.indexOf(current);
  const next = VOLUME_STEPS[(idx + 1) % VOLUME_STEPS.length];
  return next;
}

/* ------------------------------------------------------------------ */
/* Komponente                                                          */
/* ------------------------------------------------------------------ */

export function WebcamMonitor({
  webcamUrl,
  startSec,
  endSec,
  state,
  elapsedMs,
  onClose,
}: WebcamMonitorProps) {
  /* ── Refs ─────────────────────────────────────────────────────── */
  const videoRef = React.useRef<HTMLVideoElement | null>(null);
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  /** Drag-Origin (Maus-Position relativ zur Box-Ecke). */
  const dragOriginRef = React.useRef<{ dx: number; dy: number } | null>(null);
  /** Letzter Drift-Check Timestamp (perf.now()). */
  const lastDriftCheckRef = React.useRef(0);
  /** Drift-RAF-Handle. */
  const driftRafRef = React.useRef<number | null>(null);

  /* ── State ────────────────────────────────────────────────────── */

  /**
   * Effektive End-Sekunde. Wird nach `onLoadedMetadata` ggf. auf
   * `video.duration` gekappt, wenn die Webcam-Quelle kürzer ist als die Folie.
   * `cappedNotice` zeigt dann einen kleinen Hinweis am Boden.
   */
  const [effectiveEndSec, setEffectiveEndSec] = React.useState(endSec);
  const [cappedNotice, setCappedNotice] = React.useState<string | null>(null);

  const [position, setPosition] = React.useState<{ x: number; y: number }>(() => ({
    x: 0,
    y: 0,
  }));
  const [dragging, setDragging] = React.useState(false);

  const [volume, setVolume] = React.useState<VolumeStep>(0.3);

  /** Aktuelle Wiedergabezeit der Webcam (nur für Time-Strip + Progress). */
  const [currentSec, setCurrentSec] = React.useState<number>(startSec);

  /* Reset des effektiven End-Wertes wenn endSec von außen geändert wird */
  React.useEffect(() => {
    setEffectiveEndSec(endSec);
    setCappedNotice(null);
  }, [endSec, webcamUrl, startSec]);

  /* ── Mount: Position + Volume aus localStorage hydratisieren ──── */
  React.useEffect(() => {
    const stored = readStoredPosition();
    const initial = stored ?? getDefaultPosition();
    setPosition(clampToViewport(initial));
    setVolume(readStoredVolume());
    // Nur beim Mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ── Position bei Viewport-Resize clampen ─────────────────────── */
  React.useEffect(() => {
    function onResize() {
      setPosition((p) => clampToViewport(p));
    }
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  /* ── Volume an Video binden + persistieren ────────────────────── */
  React.useEffect(() => {
    const el = videoRef.current;
    if (el) {
      el.volume = volume;
      el.muted = volume === 0;
    }
    try {
      window.localStorage.setItem(VOL_STORAGE_KEY, String(volume));
    } catch {
      /* ignore */
    }
  }, [volume]);

  /* ── Mount: currentTime auf startSec setzen, paused starten ───── */
  React.useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    // Wenn Metadata bereits geladen, sofort seeken. Sonst übernimmt
    // onLoadedMetadata das (siehe unten).
    if (Number.isFinite(el.duration) && el.duration > 0) {
      try {
        el.currentTime = startSec;
      } catch {
        /* ignore */
      }
    }
    setCurrentSec(startSec);
    // bewusst nur bei src/startSec-Wechsel
  }, [webcamUrl, startSec]);

  /* ── State-Prop → play() / pause() ────────────────────────────── */
  React.useEffect(() => {
    const el = videoRef.current;
    if (!el) return;

    if (state === "playing") {
      // Wenn wir am/nach Ende sind, vorher auf startSec zurücksetzen,
      // damit ein Re-Take auch tatsächlich neu losläuft.
      if (el.currentTime >= effectiveEndSec - 0.01) {
        try {
          el.currentTime = startSec;
        } catch {
          /* ignore */
        }
      }
      el.play().catch(() => {
        /* Autoplay-Policy: ignore */
      });
    } else {
      if (!el.paused) {
        try {
          el.pause();
        } catch {
          /* ignore */
        }
      }
    }
  }, [state, startSec, effectiveEndSec]);

  /* ── Drift-Korrektur + End-Cap-Pause (rAF-Loop, throttled 500ms) */
  React.useEffect(() => {
    if (state !== "playing") {
      if (driftRafRef.current !== null) {
        cancelAnimationFrame(driftRafRef.current);
        driftRafRef.current = null;
      }
      lastDriftCheckRef.current = 0;
      return;
    }

    function tick(now: number) {
      const el = videoRef.current;
      if (!el) {
        driftRafRef.current = requestAnimationFrame(tick);
        return;
      }

      // Time-Strip + Progress (jeden Frame, ist billig).
      setCurrentSec(el.currentTime);

      // End-Cap: hartes Stop, kein Über-die-Folie-Spielen.
      if (el.currentTime >= effectiveEndSec - 0.01) {
        try {
          el.pause();
        } catch {
          /* ignore */
        }
        setCurrentSec(effectiveEndSec);
        // Kein weiterer Drift-Check nötig.
        driftRafRef.current = requestAnimationFrame(tick);
        return;
      }

      // Drift-Check max alle DRIFT_CHECK_INTERVAL_MS.
      if (
        typeof elapsedMs === "number" &&
        now - lastDriftCheckRef.current > DRIFT_CHECK_INTERVAL_MS
      ) {
        lastDriftCheckRef.current = now;
        const target = startSec + elapsedMs / 1000;
        if (Math.abs(el.currentTime - target) > DRIFT_THRESHOLD_SEC) {
          try {
            el.currentTime = target;
          } catch {
            /* ignore */
          }
        }
      }

      driftRafRef.current = requestAnimationFrame(tick);
    }

    lastDriftCheckRef.current = performance.now();
    driftRafRef.current = requestAnimationFrame(tick);
    return () => {
      if (driftRafRef.current !== null) {
        cancelAnimationFrame(driftRafRef.current);
        driftRafRef.current = null;
      }
    };
    // elapsedMs absichtlich nicht in den Deps — wir lesen es im Closure
    // bei jedem Tick frisch, indem der Effekt bei state-Wechsel neu
    // mountet. Bei "playing" sehen wir den jeweils aktuellsten Wert,
    // weil React den Effekt-Body schließt — ABER wir wollen, dass eine
    // Änderung von elapsedMs IM Verlauf einer Aufnahme wirkt, deshalb
    // verlassen wir uns auf den Drift-Threshold + die Schließung über
    // Refs (videoRef + startSec/effectiveEndSec deps unten).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, startSec, effectiveEndSec, elapsedMs]);

  /* ── Drag-Handling ────────────────────────────────────────────── */

  /** Maus an Header gedrückt — Drag-Origin festhalten. */
  function onHeaderMouseDown(e: React.MouseEvent<HTMLDivElement>) {
    // Buttons im Header sollen NICHT das Drag triggern.
    const target = e.target as HTMLElement;
    if (target.closest("[data-no-drag]")) return;

    e.preventDefault();
    dragOriginRef.current = {
      dx: e.clientX - position.x,
      dy: e.clientY - position.y,
    };
    setDragging(true);
  }

  React.useEffect(() => {
    if (!dragging) return;

    function onMove(e: MouseEvent) {
      const origin = dragOriginRef.current;
      if (!origin) return;
      const next = clampToViewport({
        x: e.clientX - origin.dx,
        y: e.clientY - origin.dy,
      });
      setPosition(next);
    }

    function onUp() {
      setDragging(false);
      dragOriginRef.current = null;
      // Position persistieren.
      try {
        const snap = clampToViewport(position);
        window.localStorage.setItem(POS_STORAGE_KEY, JSON.stringify(snap));
      } catch {
        /* ignore */
      }
    }

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    // Wir wollen die jeweils aktuelle Position lesen können beim mouseup;
    // deshalb `position` in den Deps.
  }, [dragging, position]);

  /* ── Video-Event-Handler ──────────────────────────────────────── */

  function onLoadedMetadata() {
    const el = videoRef.current;
    if (!el) return;

    // End-Sec ggf. cappen.
    const dur = el.duration;
    if (Number.isFinite(dur) && dur > 0 && dur < endSec) {
      setEffectiveEndSec(Math.min(endSec, dur));
      setCappedNotice(`endet bei ${formatMMSS(dur - startSec)}`);
    } else {
      setEffectiveEndSec(endSec);
      setCappedNotice(null);
    }

    // currentTime auf startSec setzen.
    try {
      el.currentTime = startSec;
    } catch {
      /* ignore */
    }
    setCurrentSec(startSec);

    // Volume + Mute neu anwenden (manchmal resetted der Browser).
    el.volume = volume;
    el.muted = volume === 0;
  }

  function onTimeUpdate() {
    const el = videoRef.current;
    if (!el) return;
    setCurrentSec(el.currentTime);
  }

  /* ── Progress-Bar Click → Seek ────────────────────────────────── */

  function onProgressClick(e: React.MouseEvent<HTMLDivElement>) {
    const el = videoRef.current;
    if (!el) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.max(
      0,
      Math.min(1, (e.clientX - rect.left) / rect.width),
    );
    const target = startSec + ratio * (effectiveEndSec - startSec);
    try {
      el.currentTime = target;
    } catch {
      /* ignore */
    }
    setCurrentSec(target);
  }

  /* ── Volume-Toggle ────────────────────────────────────────────── */

  function cycleVolume() {
    setVolume((v) => nextVolumeStep(v));
  }

  /* ── Derived ──────────────────────────────────────────────────── */

  const normalizedUrl = React.useMemo(
    () => normalizeWebcamUrl(webcamUrl),
    [webcamUrl],
  );
  const hasValidUrl = Boolean(normalizedUrl && normalizedUrl.trim().length > 0);

  const totalSec = Math.max(0, effectiveEndSec - startSec);
  const localSec = Math.max(0, Math.min(totalSec, currentSec - startSec));
  const progressPct = totalSec > 0 ? (localSec / totalSec) * 100 : 0;

  const isRec = state === "playing";

  /* ── Render ───────────────────────────────────────────────────── */

  return (
    <div
      ref={containerRef}
      className={cn(
        "fixed z-[60] flex flex-col overflow-hidden rounded-squircle-md border border-brand/30 bg-ink text-white",
        dragging ? "shadow-lift" : "shadow-card",
        "select-none",
      )}
      style={{
        width: BOX_W,
        height: BOX_H,
        left: position.x,
        top: position.y,
      }}
      role="dialog"
      aria-label="Webcam-Monitor"
    >
      {/* Header — Drag-Handle */}
      <div
        onMouseDown={onHeaderMouseDown}
        className={cn(
          "flex h-7 shrink-0 items-center gap-2 border-b border-white/10 bg-black/60 px-2 text-[11px] font-medium",
          dragging ? "cursor-grabbing" : "cursor-grab",
        )}
      >
        {/* REC-Dot */}
        <span
          className={cn(
            "size-2 rounded-full",
            isRec ? "bg-danger animate-pulse" : "bg-white/30",
          )}
          aria-hidden="true"
        />
        <span className="font-mono tabular-nums tracking-tight">
          {formatMMSS(localSec)} / {formatMMSS(totalSec)}
        </span>

        <div className="ml-auto flex items-center gap-1" data-no-drag>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              aria-label="Webcam-Monitor schließen"
              title="Schließen"
              className="inline-flex size-5 items-center justify-center rounded-full text-white/70 transition-colors hover:bg-white/10 hover:text-white"
            >
              <X className="size-3" />
            </button>
          )}
        </div>
      </div>

      {/* Mitte — Video / Placeholder */}
      <div className="relative flex-1 overflow-hidden bg-black">
        {hasValidUrl ? (
          // eslint-disable-next-line jsx-a11y/media-has-caption
          <video
            ref={videoRef}
            src={normalizedUrl}
            preload="metadata"
            playsInline
            className="h-full w-full object-cover"
            onLoadedMetadata={onLoadedMetadata}
            onTimeUpdate={onTimeUpdate}
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center px-3 text-center text-[11px] leading-snug text-white/60">
            Kein Webcam-Video ausgewählt
          </div>
        )}

        {/* Volume-Button (links unten, über Video) */}
        {hasValidUrl && (
          <button
            type="button"
            onClick={cycleVolume}
            data-no-drag
            aria-label={
              volume === 0
                ? "Webcam-Ton an (30%)"
                : volume === 0.3
                  ? "Webcam-Ton laut (100%)"
                  : "Webcam-Ton aus"
            }
            title={
              volume === 0
                ? "Ton aus"
                : volume === 0.3
                  ? "Ton 30 %"
                  : "Ton 100 %"
            }
            className="absolute bottom-1 left-1 inline-flex size-6 items-center justify-center rounded-full bg-black/55 text-white/85 transition-colors hover:bg-black/80 hover:text-white"
          >
            {volume === 0 ? (
              <VolumeX className="size-3.5" />
            ) : volume === 0.3 ? (
              <Volume1 className="size-3.5" />
            ) : (
              <Volume2 className="size-3.5" />
            )}
          </button>
        )}

        {/* Cap-Hinweis, falls Webcam kürzer als Folie */}
        {cappedNotice && (
          <div className="absolute bottom-1 right-1 rounded-full bg-black/60 px-1.5 py-0.5 text-[9px] font-medium text-white/80">
            {cappedNotice}
          </div>
        )}
      </div>

      {/* Progress-Bar */}
      <div
        onClick={hasValidUrl ? onProgressClick : undefined}
        data-no-drag
        role="slider"
        aria-label="Webcam-Position innerhalb der Folie"
        aria-valuemin={0}
        aria-valuemax={Math.max(0, Math.round(totalSec))}
        aria-valuenow={Math.max(0, Math.round(localSec))}
        className={cn(
          "h-1.5 w-full shrink-0 bg-white/10",
          hasValidUrl ? "cursor-pointer" : "cursor-default",
        )}
      >
        <div
          className="h-full bg-brand transition-[width] duration-75"
          style={{ width: `${progressPct}%` }}
        />
      </div>
    </div>
  );
}
