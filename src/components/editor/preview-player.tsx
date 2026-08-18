"use client";

/**
 * preview-player — 16:9 Live-Vorschau der Kampagnen-Timeline (Editor-Step 3).
 *
 * State-Machine (kurz):
 *   playheadMs              authoritativer Timeline-Cursor in ms
 *   playing                 true → echte Wiedergabe (video.play()) läuft
 *   ─────────────────────────────────────────────────────────────────────
 *   PLAY              setzt playing=true. Effekt unten ruft .play() auf
 *                     allen Media-Elementen + startet RAF-Tick (+delta).
 *   PAUSE             setzt playing=false. Effekt ruft .pause() + stoppt RAF.
 *   SEEK              Slider-Drag: setzt currentTime hart auf beiden Videos,
 *                     setzt playheadMs neu. Falls playing → erneut .play().
 *   SEGMENT-CHANGE    Aktive Folie ändert sich (Cut). React rendert neue
 *                     <video src=…>. onLoadedMetadata setzt currentTime auf
 *                     den Offset innerhalb der Folie und ruft .play() falls
 *                     playing. Davor zeigen wir den Loader.
 *   DRIFT             RAF prüft alle ~250ms |video.currentTime - playhead|.
 *                     >150ms → harter Seek. Sonst lassen wir das Video laufen
 *                     (echte 30/60 fps).
 *   VISIBILITY        Tab versteckt → pausieren, sonst würde RAF sowieso
 *                     gethrottlet und der Sync-Loop driften.
 *
 * Warum echte Wiedergabe statt Scrubbing?
 *   Chromium dekodiert beim Setzen von .currentTime nur an I-Frames sauber.
 *   60×/s currentTime zu schreiben (alter Scrub-Modus) flackerte sichtbar.
 *   .play() lässt den Decoder selbst zwischen Keyframes interpolieren →
 *   weiche Wiedergabe ohne Frame-Stutter.
 */

import * as React from "react";
import { Play, Pause, Loader2, VideoOff, Volume2, VolumeX } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Segment } from "@/lib/segments/types";
import { segmentStartMs } from "@/lib/segments/timeline";
import {
  PreviewSegmentRender,
  getActiveSegment,
  getTotalDurationMs,
} from "./preview-segment-render";

export interface PreviewPlayerProps {
  segments: Segment[];
  webcamUrl: string | null;
  webcamDurationSec: number | null;
  pipPosition: "bottom-left" | "bottom-right";
  pipShape: "square" | "rounded" | "circle";
  /** Optional lead data used for `{{firstName}}`-style placeholder preview. */
  sampleData?: Record<string, string>;
  /**
   * Externer Seek-Befehl (z. B. Klick in die Timeline oder Segment-Auswahl).
   * `nonce` erzwingt die Ausführung auch bei gleichem `ms`-Wert.
   */
  seekRequest?: { ms: number; nonce: number } | null;
  /** Meldet den Playhead (gedrosselt) nach außen, z. B. an die Timeline. */
  onTimeChange?: (ms: number) => void;
  /** Klick auf die Webcam-Blase in der Vorschau. */
  onPipClick?: () => void;
  /** Hebt die Webcam-Blase hervor (z. B. wenn im Inspector ausgewählt). */
  pipSelected?: boolean;
  /**
   * Externer Pause-Befehl (z. B. Reviewer: Klick ins Kommentar-Feld). Bei
   * neuem `nonce` wird `playing` auf false gesetzt — analog zu `seekRequest`,
   * kein Play-Befehl.
   */
  pauseRequest?: { nonce: number } | null;
}

/* ------------------------------------------------------------------ */
/* Konstanten                                                          */
/* ------------------------------------------------------------------ */

/** Ab dieser Drift in Sek. wird hart geseekt statt weiter laufen zu lassen. */
const DRIFT_THRESHOLD_SEC = 0.15;

/** Drift-Check Intervall in ms (nicht jeden Frame, sonst stottert es). */
const DRIFT_CHECK_INTERVAL_MS = 250;

/** Max. automatische Neulade-Versuche der Webcam-Spur (mit Cache-Buster). */
const WEBCAM_MAX_RETRIES = 2;

/** Nach so vielen ms ohne dekodierbares Frame gilt die Webcam als hängend. */
const WEBCAM_STALL_TIMEOUT_MS = 10_000;

/* ------------------------------------------------------------------ */
/* Formatierung                                                       */
/* ------------------------------------------------------------------ */

function formatTime(ms: number): string {
  const totalMs = Math.max(0, Math.floor(ms));
  const totalSec = Math.floor(totalMs / 1000);
  const mm = Math.floor(totalSec / 60);
  const ss = totalSec % 60;
  const milli = totalMs % 1000;
  return `${mm}:${ss.toString().padStart(2, "0")}.${milli
    .toString()
    .padStart(3, "0")}`;
}

/* ------------------------------------------------------------------ */
/* PiP-Geometrie                                                      */
/* ------------------------------------------------------------------ */

function pipPositionClass(pos: "bottom-left" | "bottom-right"): string {
  if (pos === "bottom-left") return "bottom-4 left-4";
  return "bottom-4 right-4";
}

function pipShapeClass(shape: "square" | "rounded" | "circle"): string {
  if (shape === "square") return "rounded-none";
  if (shape === "rounded") return "rounded-squircle-md";
  return "rounded-full aspect-square";
}

/* ------------------------------------------------------------------ */
/* Hilfsfunktionen Segmente                                            */
/* ------------------------------------------------------------------ */

// `getSegmentStartMs` ist nach `@/lib/segments/timeline#segmentStartMs`
// gewandert, damit auch der Scroll-Recorder + Webcam-Monitor die identische
// Akkumulations-Logik nutzen können.

/**
 * Sucht das nächste Video-Segment ab `fromIndex` (inkl.) und gibt dessen URL
 * zurück — wird zum Preloaden in einem Hidden-<video> benutzt, damit der
 * nächste Cut nicht 200ms schwarz wird.
 */
function findNextVideoUrl(
  segments: Segment[],
  fromIndex: number,
): string | null {
  for (let i = fromIndex; i < segments.length; i++) {
    const s = segments[i];
    if (s.kind === "video" && s.publicUrl) return s.publicUrl;
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Komponente                                                          */
/* ------------------------------------------------------------------ */

export function PreviewPlayer({
  segments,
  webcamUrl,
  webcamDurationSec,
  pipPosition,
  pipShape,
  sampleData,
  seekRequest,
  onTimeChange,
  onPipClick,
  pipSelected,
  pauseRequest,
}: PreviewPlayerProps) {
  const totalDurationMs = React.useMemo(
    () => getTotalDurationMs(segments),
    [segments],
  );

  const [playheadMs, setPlayheadMs] = React.useState(0);
  const [playing, setPlaying] = React.useState(false);
  /** True, sobald das aktive Video-Segment `canplay` gefeuert hat. */
  const [stageVideoReady, setStageVideoReady] = React.useState(true);
  /**
   * Webcam-Ton. Default AN: Die Wiedergabe startet immer über den
   * Play-Button (User-Geste), daher greift die Autoplay-Policy nicht —
   * unmuted play() ist erlaubt.
   */
  const [webcamMuted, setWebcamMuted] = React.useState(false);
  /**
   * Tatsächliche src der Webcam-Spur. Weicht von `webcamUrl` ab, sobald der
   * Selbstheiler mit Cache-Buster neu lädt: Browser wie CDN-Edges cachen die
   * Datei bis zu 30 Tage — eine direkt nach dem Upload gecachte kaputte
   * Kopie würde sonst dauerhaft als schwarzer PiP ausgeliefert.
   */
  const [webcamSrc, setWebcamSrc] = React.useState(webcamUrl);
  /** True, wenn auch alle Neulade-Versuche kein Bild geliefert haben. */
  const [webcamFailed, setWebcamFailed] = React.useState(false);
  const webcamRetryRef = React.useRef(0);
  /** Spiegel von webcamSrc — macht den Retry idempotent pro fehlgeschlagener src. */
  const webcamSrcRef = React.useRef(webcamUrl);
  React.useEffect(() => {
    webcamRetryRef.current = 0;
    webcamSrcRef.current = webcamUrl;
    setWebcamFailed(false);
    setWebcamSrc(webcamUrl);
  }, [webcamUrl]);

  const retryWebcamLoad = React.useCallback(
    (failedSrc: string | null) => {
      // onError + Watchdog (+ StrictMode-Doppel-Effects) können denselben
      // Fehler mehrfach melden — nur der erste Melder pro src zählt.
      if (!webcamUrl || !failedSrc || webcamSrcRef.current !== failedSrc)
        return;
      if (webcamRetryRef.current >= WEBCAM_MAX_RETRIES) {
        setWebcamFailed(true);
        return;
      }
      webcamRetryRef.current += 1;
      const sep = webcamUrl.includes("?") ? "&" : "?";
      const next = `${webcamUrl}${sep}vcretry=${webcamRetryRef.current}-${Date.now()}`;
      webcamSrcRef.current = next;
      setWebcamSrc(next);
    },
    [webcamUrl],
  );

  // Watchdog: Wenn die Webcam nach dem (Neu-)Laden nicht binnen Timeout
  // mindestens ein Frame dekodieren konnte (readyState < HAVE_CURRENT_DATA),
  // einmal mit Cache-Buster neu laden. Der Sofort-Check fängt Fehler ab, die
  // schon vor der React-Hydration gefeuert haben — das SSR-<video> beginnt
  // sofort zu laden, onError ist da noch nicht verdrahtet.
  React.useEffect(() => {
    if (!webcamSrc || webcamFailed) return;
    const el = webcamRef.current;
    if (el && el.error) {
      retryWebcamLoad(webcamSrc);
      return;
    }
    const timer = setTimeout(() => {
      const current = webcamRef.current;
      if (current && current.readyState < 2) retryWebcamLoad(webcamSrc);
    }, WEBCAM_STALL_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [webcamSrc, webcamFailed, retryWebcamLoad]);

  // ── Refs ────────────────────────────────────────────────────────────
  /** Letzter timestamp aus rAF — für Delta-Berechnung. */
  const lastTickRef = React.useRef<number | null>(null);
  /** rAF-Handle, damit wir bei Pause/Unmount abbrechen können. */
  const rafRef = React.useRef<number | null>(null);
  /** playing in einer Ref, damit der RAF-Closure aktuelle Werte sieht. */
  const playingRef = React.useRef(false);
  /** playhead in einer Ref — wir aktualisieren ihn pro Tick. */
  const playheadRef = React.useRef(0);
  /** Total in einer Ref für End-Detection im rAF. */
  const totalRef = React.useRef(totalDurationMs);
  /** Letzter Drift-Check Timestamp. */
  const lastDriftCheckRef = React.useRef(0);

  /** Aktives Bühnen-Video (kind === "video"). */
  const stageVideoRef = React.useRef<HTMLVideoElement | null>(null);
  /** Webcam-PiP-Video. */
  const webcamRef = React.useRef<HTMLVideoElement | null>(null);
  /** webcamMuted in einer Ref, damit Play-Handler den aktuellen Wert sehen. */
  const webcamMutedRef = React.useRef(webcamMuted);
  React.useEffect(() => {
    webcamMutedRef.current = webcamMuted;
  }, [webcamMuted]);
  /** onTimeChange in einer Ref, damit der rAF-Closure aktuell bleibt. */
  const onTimeChangeRef = React.useRef(onTimeChange);
  React.useEffect(() => {
    onTimeChangeRef.current = onTimeChange;
  }, [onTimeChange]);
  /** Letzter Timestamp, zu dem onTimeChange gefeuert hat (Throttle). */
  const lastTimeEmitRef = React.useRef(0);

  const emitTime = React.useCallback((ms: number) => {
    onTimeChangeRef.current?.(ms);
  }, []);

  // ── Aktive Folie + Offsets ──────────────────────────────────────────
  const active = React.useMemo(
    () => getActiveSegment(segments, playheadMs),
    [segments, playheadMs],
  );
  const activeIndex = active?.index ?? -1;
  const isVideoSegment = active?.segment.kind === "video";
  const stageVideoSrc =
    active && active.segment.kind === "video" ? active.segment.publicUrl : null;
  const stageTrimStartMs =
    active && active.segment.kind === "video"
      ? (active.segment.trimStartMs ?? 0)
      : 0;

  /** URL des NÄCHSTEN Video-Segments (nach dem aktuellen) → Preload-Hint. */
  const nextVideoUrl = React.useMemo(
    () =>
      activeIndex >= 0 ? findNextVideoUrl(segments, activeIndex + 1) : null,
    [segments, activeIndex],
  );

  // Refs synchron halten
  React.useEffect(() => {
    playheadRef.current = playheadMs;
  }, [playheadMs]);
  React.useEffect(() => {
    totalRef.current = totalDurationMs;
  }, [totalDurationMs]);

  // Bei neuem Video-Segment: Loader anzeigen, bis canplay zurückkommt.
  React.useEffect(() => {
    if (isVideoSegment && stageVideoSrc) {
      setStageVideoReady(false);
    } else {
      setStageVideoReady(true);
    }
  }, [activeIndex, stageVideoSrc, isVideoSegment]);

  // Clamp/Reset bei Timeline-Änderung
  React.useEffect(() => {
    if (totalDurationMs <= 0) {
      setPlayheadMs(0);
      setPlaying(false);
      return;
    }
    setPlayheadMs((prev) => (prev > totalDurationMs ? totalDurationMs : prev));
    // Nur bei Längenänderung neu auswerten.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [totalDurationMs]);

  // Externer Pause (Reviewer: Klick ins Kommentar-Feld). Nur bei neuem nonce.
  const pauseNonce = pauseRequest?.nonce ?? null;
  React.useEffect(() => {
    if (pauseNonce === null) return;
    setPlaying(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pauseNonce]);

  // Externer Seek (Timeline-Klick, Segment-Auswahl): Playhead hart setzen.
  const seekNonce = seekRequest?.nonce ?? null;
  React.useEffect(() => {
    if (seekNonce === null || !seekRequest) return;
    const clamped = Math.max(0, Math.min(totalRef.current, seekRequest.ms));
    playheadRef.current = clamped;
    setPlayheadMs(clamped);
    hardSeekAll(clamped);
    if (playingRef.current) {
      setMediaPlayback(true);
    }
    emitTime(clamped);
    // Nur auf neue nonce reagieren.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seekNonce]);

  /* ------------------------------------------------------------------ */
  /* Drift-Check + lokale Seek-Helfer                                   */
  /* ------------------------------------------------------------------ */

  /** Start-Offset (ms) der aktiven Folie in der Timeline — wird zum
   *  Umrechnen von playheadMs in den segmentlokalen Offset gebraucht. */
  const activeStartMs = React.useMemo(
    () => (activeIndex >= 0 ? segmentStartMs(segments, activeIndex) : 0),
    [segments, activeIndex],
  );

  /**
   * Berechnet die Soll-`currentTime` des Bühnen-Videos relativ zur Quelle.
   * Nimmt den AKTUELLEN playMs entgegen (nicht aus dem closure), damit der
   * Drift-Check während der rAF-Schleife mit dem aktuellen Cursor rechnet.
   */
  const computeStageTargetSec = React.useCallback(
    (playMs: number): number | null => {
      if (!active || active.segment.kind !== "video") return null;
      const segLocalMs = Math.max(0, playMs - activeStartMs);
      const trim = active.segment.trimStartMs ?? 0;
      return (segLocalMs + trim) / 1000;
    },
    [active, activeStartMs],
  );

  /**
   * Berechnet die Soll-`currentTime` der Webcam-Spur (immer am globalen
   * Playhead, geclamped auf die Webcam-Dauer falls bekannt).
   */
  const computeWebcamTargetSec = React.useCallback(
    (playMs: number): number => {
      const target = playMs / 1000;
      if (
        typeof webcamDurationSec === "number" &&
        webcamDurationSec > 0 &&
        target > webcamDurationSec - 0.05
      ) {
        return Math.max(0, webcamDurationSec - 0.05);
      }
      return target;
    },
    [webcamDurationSec],
  );

  /** Setzt currentTime auf beiden Spuren OHNE play()/pause() zu verändern. */
  const hardSeekAll = React.useCallback(
    (playMs: number) => {
      const webEl = webcamRef.current;
      if (webEl) {
        const t = computeWebcamTargetSec(playMs);
        try {
          if (Math.abs(webEl.currentTime - t) > 0.02) webEl.currentTime = t;
        } catch {
          /* ignore */
        }
      }
      const stEl = stageVideoRef.current;
      if (stEl && isVideoSegment) {
        const t = computeStageTargetSec(playMs);
        if (t !== null) {
          try {
            if (Math.abs(stEl.currentTime - t) > 0.02) stEl.currentTime = t;
          } catch {
            /* ignore */
          }
        }
      }
    },
    [computeStageTargetSec, computeWebcamTargetSec, isVideoSegment],
  );

  /** Ruft play() oder pause() auf beiden Spuren auf. */
  const setMediaPlayback = React.useCallback(
    (shouldPlay: boolean) => {
      const stEl = stageVideoRef.current;
      const webEl = webcamRef.current;

      if (shouldPlay) {
        // Ton folgt dem User-Toggle. play() läuft immer nach einer
        // User-Geste (Play-Button), daher blockiert die Autoplay-Policy
        // auch unmuted nicht.
        if (webEl) {
          webEl.muted = webcamMutedRef.current;
          // play() liefert ein Promise, das bei abgebrochenem play()
          // (z.B. wenn unmittelbar gepaust wird) rejected — wir ignorieren das.
          webEl.play().catch(() => {});
        }
        if (stEl && isVideoSegment) {
          stEl.muted = true;
          stEl.play().catch(() => {});
        }
      } else {
        if (webEl && !webEl.paused) {
          try {
            webEl.pause();
          } catch {
            /* ignore */
          }
        }
        if (stEl && !stEl.paused) {
          try {
            stEl.pause();
          } catch {
            /* ignore */
          }
        }
      }
    },
    [isVideoSegment],
  );

  /* ------------------------------------------------------------------ */
  /* Wiedergabe-Loop                                                     */
  /* ------------------------------------------------------------------ */

  React.useEffect(() => {
    playingRef.current = playing;

    if (!playing) {
      lastTickRef.current = null;
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      setMediaPlayback(false);
      return;
    }

    // Bei Start: Soll-Positionen einmalig setzen + .play() auslösen.
    // Drift-Timer auf "jetzt" zurücksetzen, sonst feuert er sofort.
    hardSeekAll(playheadRef.current);
    setMediaPlayback(true);
    lastDriftCheckRef.current = performance.now();

    const step = (now: number) => {
      if (!playingRef.current) return;

      const last = lastTickRef.current;
      if (last !== null) {
        const delta = now - last;
        const nextMs = playheadRef.current + delta;

        if (nextMs >= totalRef.current) {
          // Ende der Timeline erreicht → pausieren + zurück auf Start.
          playingRef.current = false;
          setPlaying(false);
          setPlayheadMs(0);
          onTimeChangeRef.current?.(0);
          return;
        }
        playheadRef.current = nextMs;
        // React-State weniger oft updaten als rAF feuert wäre ideal,
        // aber wir brauchen es für die Folien-Wechsel-Detection.
        setPlayheadMs(nextMs);

        // Timeline-Playhead gedrosselt nach außen melden (~4×/s reicht).
        if (now - lastTimeEmitRef.current > 250) {
          lastTimeEmitRef.current = now;
          onTimeChangeRef.current?.(nextMs);
        }

        // Drift-Check (max alle DRIFT_CHECK_INTERVAL_MS).
        if (now - lastDriftCheckRef.current > DRIFT_CHECK_INTERVAL_MS) {
          lastDriftCheckRef.current = now;
          const webEl = webcamRef.current;
          if (webEl && !webEl.paused) {
            const target = computeWebcamTargetSec(nextMs);
            if (Math.abs(webEl.currentTime - target) > DRIFT_THRESHOLD_SEC) {
              try {
                webEl.currentTime = target;
              } catch {
                /* ignore */
              }
            }
          }
          const stEl = stageVideoRef.current;
          if (stEl && isVideoSegment && !stEl.paused) {
            const target = computeStageTargetSec(nextMs);
            if (
              target !== null &&
              Math.abs(stEl.currentTime - target) > DRIFT_THRESHOLD_SEC
            ) {
              try {
                stEl.currentTime = target;
              } catch {
                /* ignore */
              }
            }
          }
        }
      }
      lastTickRef.current = now;
      rafRef.current = requestAnimationFrame(step);
    };

    rafRef.current = requestAnimationFrame(step);
    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      lastTickRef.current = null;
    };
    // Wir hängen nur an `playing`. Die Drift-/Seek-Helfer sind Refs-basiert
    // genug, dass uns ihre Identitäts-Wechsel nicht stören.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing]);

  /* ------------------------------------------------------------------ */
  /* Tab-Visibility: bei Hide pausieren                                  */
  /* ------------------------------------------------------------------ */

  React.useEffect(() => {
    function onVisibility() {
      if (document.hidden && playingRef.current) {
        setPlaying(false);
      }
    }
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  /* ------------------------------------------------------------------ */
  /* Folien-Wechsel: nach loadedmetadata Position setzen + ggf. play()   */
  /* ------------------------------------------------------------------ */

  // Wenn das aktive Segment KEIN Video ist, müssen wir trotzdem die Webcam
  // auf Stand halten (sie läuft ja über alle Folien weiter, weil sie an
  // playheadMs hängt und nicht segmentlokal ist).
  // Ist es ein Video, übernimmt onLoadedMetadata weiter unten.

  // Bei nicht-Video-Folien: Webcam-currentTime einmal angleichen, damit nach
  // mehreren rein-textuellen Folien die Drift nicht akkumuliert.
  React.useEffect(() => {
    if (isVideoSegment) return;
    const webEl = webcamRef.current;
    if (!webEl) return;
    const target = computeWebcamTargetSec(playheadMs);
    if (Math.abs(webEl.currentTime - target) > DRIFT_THRESHOLD_SEC) {
      try {
        webEl.currentTime = target;
      } catch {
        /* ignore */
      }
    }
    // Auch hier: bei laufender Wiedergabe sicherstellen, dass Webcam läuft.
    if (playing && webEl.paused) {
      webEl.muted = webcamMutedRef.current;
      webEl.play().catch(() => {});
    } else if (!playing && !webEl.paused) {
      try {
        webEl.pause();
      } catch {
        /* ignore */
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeIndex, isVideoSegment]);

  /* ------------------------------------------------------------------ */
  /* Event-Handler                                                      */
  /* ------------------------------------------------------------------ */

  function togglePlay() {
    if (totalDurationMs <= 0) return;
    // Wenn am Ende: vor dem Play auf 0 springen.
    if (playheadMs >= totalDurationMs) {
      playheadRef.current = 0;
      setPlayheadMs(0);
    }
    setPlaying((p) => !p);
  }

  function onScrub(e: React.ChangeEvent<HTMLInputElement>) {
    const v = Number(e.target.value);
    if (!Number.isFinite(v)) return;
    const clamped = Math.max(0, Math.min(totalDurationMs, v));
    playheadRef.current = clamped;
    setPlayheadMs(clamped);
    // Beide Spuren auf neue Position bringen — egal ob playing oder nicht.
    hardSeekAll(clamped);
    // Bei laufender Wiedergabe: nach dem Seek wieder anschieben.
    if (playingRef.current) {
      setMediaPlayback(true);
    }
    emitTime(clamped);
  }

  /* ------------------------------------------------------------------ */
  /* Video-Event-Handler für das BÜHNEN-Video                            */
  /* ------------------------------------------------------------------ */

  /**
   * onLoadedMetadata feuert nach jeder neuen src — d.h. bei jedem Folien-
   * Wechsel auf ein neues Video. Wir setzen currentTime auf den korrekten
   * Offset (trimStart + lokaler Folien-Offset) und starten ggf. play().
   */
  function onStageVideoLoadedMetadata() {
    const el = stageVideoRef.current;
    if (!el) return;
    const target = computeStageTargetSec(playheadRef.current);
    if (target !== null) {
      try {
        // Gleicher Guard wie bei der Webcam: kein Demuxer-Seek auf die
        // (fast) identische Position — tödlich für unindizierte WebMs.
        if (Math.abs(el.currentTime - target) > 0.05) el.currentTime = target;
      } catch {
        /* ignore */
      }
    }
  }

  function onStageVideoCanPlay() {
    setStageVideoReady(true);
    if (playingRef.current) {
      const el = stageVideoRef.current;
      if (el) {
        el.muted = true;
        el.play().catch(() => {});
      }
    }
  }

  function onWebcamLoadedMetadata() {
    const el = webcamRef.current;
    if (!el) return;
    const target = computeWebcamTargetSec(playheadRef.current);
    try {
      // Nur seeken, wenn die Position wirklich abweicht: Eine currentTime-
      // Zuweisung direkt in loadedmetadata (auch auf 0!) triggert bei
      // unindizierten MediaRecorder-WebMs einen Demuxer-Seek, der mit
      // PIPELINE_ERROR_READ scheitert und das Video tötet → schwarzer PiP.
      if (Math.abs(el.currentTime - target) > 0.05) el.currentTime = target;
    } catch {
      /* ignore */
    }
    if (playingRef.current) {
      el.muted = webcamMutedRef.current;
      el.play().catch(() => {});
    }
  }

  function toggleWebcamMute() {
    setWebcamMuted((m) => {
      const next = !m;
      const el = webcamRef.current;
      if (el) el.muted = next;
      return next;
    });
  }

  /* ------------------------------------------------------------------ */
  /* Render                                                             */
  /* ------------------------------------------------------------------ */

  const hasContent = segments.length > 0;
  const pipPosCls = pipPositionClass(pipPosition);
  const pipShapeCls = pipShapeClass(pipShape);
  const progressPct =
    totalDurationMs > 0
      ? Math.max(0, Math.min(100, (playheadMs / totalDurationMs) * 100))
      : 0;

  const showLoader = isVideoSegment && !stageVideoReady;

  return (
    <div className="w-full max-w-[800px]">
      {/* Bühne */}
      <div className="relative aspect-video w-full overflow-hidden rounded-squircle-md bg-ink shadow-card">
        {!hasContent ? (
          <div className="absolute inset-0 flex items-center justify-center p-6 text-center">
            <p className="max-w-sm text-sm text-white/80">
              Füge Segmente hinzu, um die Vorschau zu sehen.
            </p>
          </div>
        ) : active ? (
          <PreviewSegmentRender
            // Key auf den Segment-Wechsel — erzwingt frisches <video>-Element,
            // damit src nicht "weiterläuft" wenn die nächste Folie wieder
            // ein Video ist (sonst hängt der alte currentTime/play-State an).
            key={`seg-${active.index}-${active.segment.id}`}
            segment={active.segment}
            segmentTimeMs={active.segmentTimeMs}
            sampleData={sampleData}
            videoRef={isVideoSegment ? stageVideoRef : undefined}
            onVideoLoadedMetadata={onStageVideoLoadedMetadata}
            onVideoCanPlay={onStageVideoCanPlay}
          />
        ) : null}

        {/* Loader-Overlay solange ein Video lädt/seekt. */}
        {showLoader && (
          <div className="absolute inset-0 flex items-center justify-center bg-ink/40 backdrop-blur-[1px]">
            <Loader2 className="size-7 animate-spin text-white/90" />
          </div>
        )}

        {/* Hidden Preload des NÄCHSTEN Video-Segments, damit der Cut nicht
            200ms schwarz wird. Browser hält die Daten dann im Cache. */}
        {nextVideoUrl && nextVideoUrl !== stageVideoSrc && (
          // eslint-disable-next-line jsx-a11y/media-has-caption
          <video
            src={nextVideoUrl}
            preload="auto"
            muted
            playsInline
            className="hidden"
            aria-hidden="true"
          />
        )}

        {/* Webcam-PiP-Overlay — 25% der Bühnenbreite */}
        {webcamUrl && (
          <div
            role={onPipClick ? "button" : undefined}
            tabIndex={onPipClick ? 0 : undefined}
            aria-label={onPipClick ? "Webcam-Einblendung bearbeiten" : undefined}
            onClick={onPipClick}
            onKeyDown={
              onPipClick
                ? (e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onPipClick();
                    }
                  }
                : undefined
            }
            className={cn(
              "absolute overflow-hidden bg-ink shadow-lg ring-1 ring-black/10",
              pipPosCls,
              pipShapeCls,
              onPipClick &&
                "cursor-pointer transition-shadow hover:ring-2 hover:ring-brand/60",
              pipSelected && "ring-2 ring-brand",
            )}
            style={
              pipShape === "circle"
                ? { width: "25%" }
                : { width: "25%", aspectRatio: "16 / 9" }
            }
          >
            {webcamFailed ? (
              <div className="flex h-full w-full flex-col items-center justify-center gap-1 text-white/70">
                <VideoOff className="size-5" />
                <span className="px-2 text-center text-[10px] leading-tight">
                  Video lädt nicht — Seite neu laden
                </span>
              </div>
            ) : (
              // eslint-disable-next-line jsx-a11y/media-has-caption
              <video
                key={webcamSrc ?? "none"}
                ref={webcamRef}
                src={webcamSrc ?? undefined}
                muted={webcamMuted}
                playsInline
                preload="auto"
                className="h-full w-full object-cover"
                onLoadedMetadata={onWebcamLoadedMetadata}
                onError={() => retryWebcamLoad(webcamSrc)}
              />
            )}
          </div>
        )}
      </div>

      {/* Controls */}
      <div className="mt-3 flex items-center gap-3 rounded-squircle-sm border border-line bg-surface px-4 py-2">
        <button
          type="button"
          onClick={togglePlay}
          disabled={!hasContent}
          aria-label={playing ? "Pause" : "Abspielen"}
          className={cn(
            "inline-flex size-9 items-center justify-center rounded-full transition-colors",
            hasContent
              ? "bg-[#AA8CF5] text-white hover:bg-[#7C5CE8]"
              : "cursor-not-allowed bg-line text-ink-muted",
          )}
        >
          {playing ? (
            <Pause className="size-4 fill-current" />
          ) : (
            <Play className="size-4 fill-current" />
          )}
        </button>

        <button
          type="button"
          onClick={toggleWebcamMute}
          disabled={!webcamUrl}
          aria-label={webcamMuted ? "Ton einschalten" : "Ton ausschalten"}
          title={webcamMuted ? "Ton einschalten" : "Ton ausschalten"}
          className={cn(
            "inline-flex size-8 items-center justify-center rounded-full transition-colors",
            webcamUrl
              ? "text-ink-muted hover:bg-surface-soft hover:text-ink"
              : "cursor-not-allowed text-line",
          )}
        >
          {webcamMuted ? (
            <VolumeX className="size-4" />
          ) : (
            <Volume2 className="size-4" />
          )}
        </button>

        <span className="font-mono text-xs tabular-nums text-ink-muted">
          {formatTime(playheadMs)} / {formatTime(totalDurationMs)}
        </span>

        <input
          type="range"
          min={0}
          max={Math.max(0, totalDurationMs)}
          step={10}
          value={Math.min(playheadMs, totalDurationMs)}
          onChange={onScrub}
          disabled={!hasContent}
          aria-label="Vorschau scrubben"
          className={cn(
            "h-1 flex-1 cursor-pointer appearance-none rounded-full bg-line",
            "[&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:w-3",
            "[&::-webkit-slider-thumb]:appearance-none",
            "[&::-webkit-slider-thumb]:rounded-full",
            "[&::-webkit-slider-thumb]:bg-[#AA8CF5]",
            "[&::-webkit-slider-thumb]:shadow",
            "[&::-moz-range-thumb]:h-3 [&::-moz-range-thumb]:w-3",
            "[&::-moz-range-thumb]:rounded-full",
            "[&::-moz-range-thumb]:border-0",
            "[&::-moz-range-thumb]:bg-[#AA8CF5]",
            !hasContent && "cursor-not-allowed opacity-50",
          )}
          style={{
            background: hasContent
              ? `linear-gradient(to right, #AA8CF5 0%, #AA8CF5 ${progressPct}%, #ebebeb ${progressPct}%, #ebebeb 100%)`
              : undefined,
          }}
        />
      </div>
    </div>
  );
}
