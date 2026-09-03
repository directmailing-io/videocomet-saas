"use client";

import * as React from "react";
import { setTrackingSlug, track } from "@/lib/tracker";
import { WatchAccumulator } from "@/lib/analytics/watch-coverage";

/**
 * Public landing-page video player.
 *
 * Prefers an iframe embed (Bunny Stream) when an embed URL is supplied,
 * otherwise falls back to a native <video> element. Either way the player
 * is responsive (16:9) and fills its container.
 *
 * Tracking (new unified pipeline → /api/track/event):
 *  - `video_play` on the first play event.
 *  - `video_progress` every 5 seconds while playing AND on pause/seek/end,
 *    carrying `atSec`, `playedSec` (UNIQUE watched seconds = union of watched
 *    intervals, see lib/analytics/watch-coverage.ts), `durationSec`,
 *    `coveragePct`, `segments`. Bunny iframes are tracked via player.js.
 *  - `video_ended` once when the media reaches the end.
 *  - `pagehide`/`beforeunload` flushes a final `video_progress` via
 *    sendBeacon so we don't lose the last few seconds when the recipient
 *    closes the tab.
 *
 * Legacy endpoints (`/api/track/video-start`, `/api/track/video-progress`)
 * are kept for the milestone-based tracking the worker already understands;
 * the new pipeline runs in parallel and feeds the realtime analytics view.
 */

export type VideoOrientation = "landscape" | "portrait" | "square";

export interface VideoPlayerProps {
  leadId: string;
  slug?: string;
  bunnyEmbedUrl?: string | null;
  videoSrc?: string | null;
  thumbnailUrl?: string | null;
  title?: string;
  /**
   * Aspect-ratio-Hinweis für den Player-Container. `landscape` rendert wie
   * gewohnt 16:9 mit `object-contain`. `portrait` (z.B. Smartphone-Webcam,
   * 404x720) bekommt einen 9:16-Container mit max-Höhe + `object-cover`,
   * damit nicht riesige schwarze Streifen links/rechts entstehen. `square`
   * 1:1. `null`/unknown → Bestandsverhalten (16:9, defensive default).
   */
  videoOrientation?: VideoOrientation | null;
}

/**
 * Klassen für den Outer-Container abhängig von der Video-Orientation.
 * Der Container ist immer `relative` (damit das absolute `<video>` greift),
 * mit `bg-black` als Letterbox-Color falls `object-contain` greift.
 */
function containerClassFor(orientation: VideoOrientation | null | undefined): string {
  if (orientation === "portrait") {
    return "relative w-full max-w-[min(420px,90vw)] mx-auto aspect-[9/16] max-h-[80vh] bg-black";
  }
  if (orientation === "square") {
    return "relative w-full max-w-md mx-auto aspect-square bg-black";
  }
  // landscape + null/unknown → Bestand
  return "relative w-full aspect-video bg-black";
}

/**
 * `object-cover` für Portrait/Square — sonst hätte der Container ggf. wieder
 * Streifen innerhalb der korrigierten Bounding-Box. Bei landscape bleibt
 * `object-contain` der safe default (kein Crop, falls die Quelle abweicht).
 */
function videoObjectFitClassFor(
  orientation: VideoOrientation | null | undefined,
): string {
  if (orientation === "portrait" || orientation === "square") {
    return "object-cover";
  }
  return "object-contain";
}

function legacyTrackEvent(
  path: string,
  payload: Record<string, unknown>,
): void {
  try {
    const body = JSON.stringify(payload);
    if (
      typeof navigator !== "undefined" &&
      typeof navigator.sendBeacon === "function"
    ) {
      const blob = new Blob([body], { type: "application/json" });
      const ok = navigator.sendBeacon(path, blob);
      if (ok) return;
    }
    fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true,
    }).catch(() => {
      /* swallow — tracking must never break the page */
    });
  } catch {
    /* swallow */
  }
}

const PROGRESS_MILESTONES = [25, 50, 75, 100] as const;
const PROGRESS_TICK_MS = 5000;
const PLAYERJS_SRC = "https://assets.mediadelivery.net/playerjs/playerjs-latest.min.js";

/** Minimaler Typ fuer Bunnys player.js (postMessage-Bruecke in den iframe). */
interface PlayerJsPlayer {
  on(event: string, cb: (data?: unknown) => void): void;
  getDuration(cb: (d: number) => void): void;
  getCurrentTime(cb: (t: number) => void): void;
}
declare global {
  interface Window {
    playerjs?: { Player: new (el: HTMLIFrameElement | string) => PlayerJsPlayer };
  }
}

let playerJsLoading: Promise<boolean> | null = null;
function loadPlayerJs(): Promise<boolean> {
  if (typeof window === "undefined") return Promise.resolve(false);
  if (window.playerjs) return Promise.resolve(true);
  if (playerJsLoading) return playerJsLoading;
  playerJsLoading = new Promise<boolean>((resolve) => {
    try {
      const s = document.createElement("script");
      s.src = PLAYERJS_SRC;
      s.async = true;
      s.onload = () => resolve(Boolean(window.playerjs));
      s.onerror = () => resolve(false);
      document.head.appendChild(s);
    } catch {
      resolve(false);
    }
  });
  return playerJsLoading;
}

export function VideoPlayer({
  leadId,
  slug,
  bunnyEmbedUrl,
  videoSrc,
  thumbnailUrl,
  title,
  videoOrientation,
}: VideoPlayerProps) {
  const videoRef = React.useRef<HTMLVideoElement | null>(null);
  const iframeRef = React.useRef<HTMLIFrameElement | null>(null);
  const startedRef = React.useRef(false);
  const reachedRef = React.useRef<Set<number>>(new Set());
  const intervalRef = React.useRef<ReturnType<typeof setInterval> | null>(null);
  // Gesehene Zeitleisten-Abschnitte (Vereinigung, kein Doppelzaehlen).
  const accRef = React.useRef(new WatchAccumulator());
  // Letzter bekannter Stand (fuer iframe: kommt aus player.js-Events).
  const posRef = React.useRef({ atSec: 0, durationSec: 0, playing: false });
  const lastSentRef = React.useRef<string>("");

  React.useEffect(() => {
    if (slug) setTrackingSlug(slug);
  }, [slug]);

  const buildSnapshot = React.useCallback(() => {
    const video = videoRef.current;
    if (video) {
      const dur = Number.isFinite(video.duration) ? video.duration : 0;
      return accRef.current.snapshot(dur, video.currentTime);
    }
    return accRef.current.snapshot(posRef.current.durationSec, posRef.current.atSec);
  }, []);

  /** video_progress senden; identische Snapshots hintereinander nicht doppelt. */
  const sendProgress = React.useCallback(
    (force = false) => {
      const snap = buildSnapshot();
      const key = `${snap.atSec}|${snap.playedSec}|${snap.durationSec}`;
      if (!force && key === lastSentRef.current) return;
      lastSentRef.current = key;
      track("video_progress", {
        atSec: snap.atSec,
        playedSec: snap.playedSec,
        durationSec: snap.durationSec,
        coveragePct: snap.coveragePct,
        maxSec: snap.maxSec,
        segments: snap.segments,
      });
    },
    [buildSnapshot],
  );

  /** Legacy-Meilensteine (25/50/75/100) nach erreichter Position. */
  const fireMilestones = React.useCallback(
    (atSec: number, durationSec: number) => {
      if (!durationSec) return;
      const pct = (atSec / durationSec) * 100;
      for (const milestone of PROGRESS_MILESTONES) {
        if (pct >= milestone && !reachedRef.current.has(milestone)) {
          reachedRef.current.add(milestone);
          legacyTrackEvent("/api/track/video-progress", { leadId, percent: milestone });
        }
      }
    },
    [leadId],
  );

  const clearTick = React.useCallback(() => {
    if (intervalRef.current !== null) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  const startTick = React.useCallback(() => {
    clearTick();
    intervalRef.current = setInterval(() => {
      const video = videoRef.current;
      if (video ? video.paused || video.ended : !posRef.current.playing) return;
      sendProgress();
    }, PROGRESS_TICK_MS);
  }, [clearTick, sendProgress]);

  const onPlayStart = React.useCallback(
    (atSec: number) => {
      track("video_play", { atSec: Math.round(atSec * 10) / 10 });
      if (!startedRef.current) {
        startedRef.current = true;
        legacyTrackEvent("/api/track/video-start", { leadId });
      }
      startTick();
    },
    [leadId, startTick],
  );

  // ── Natives <video> ─────────────────────────────────────────────────────
  const onPlay = React.useCallback(() => {
    const video = videoRef.current;
    onPlayStart(video ? video.currentTime : 0);
  }, [onPlayStart]);

  const onTimeUpdate = React.useCallback(() => {
    const video = videoRef.current;
    if (!video || video.seeking) return;
    accRef.current.tick(video.currentTime);
    if (video.duration && !Number.isNaN(video.duration)) {
      fireMilestones(video.currentTime, video.duration);
    }
  }, [fireMilestones]);

  const onPause = React.useCallback(() => {
    clearTick();
    accRef.current.close();
    sendProgress(true);
  }, [clearTick, sendProgress]);

  const onSeeking = React.useCallback(() => {
    accRef.current.seek();
  }, []);

  const onSeeked = React.useCallback(() => {
    accRef.current.seek();
    sendProgress(true);
  }, [sendProgress]);

  const onEnded = React.useCallback(() => {
    clearTick();
    const video = videoRef.current;
    const dur = video && Number.isFinite(video.duration) ? video.duration : posRef.current.durationSec;
    accRef.current.ended(dur);
    const snap = accRef.current.snapshot(dur, dur);
    track("video_progress", {
      atSec: snap.atSec,
      playedSec: snap.playedSec,
      durationSec: snap.durationSec,
      coveragePct: snap.coveragePct,
      maxSec: snap.maxSec,
      segments: snap.segments,
    });
    track("video_ended", {
      atSec: snap.durationSec,
      playedSec: snap.playedSec,
      durationSec: snap.durationSec,
      coveragePct: snap.coveragePct,
    });
    if (!reachedRef.current.has(100)) {
      reachedRef.current.add(100);
      legacyTrackEvent("/api/track/video-progress", { leadId, percent: 100 });
    }
  }, [clearTick, leadId]);

  // Letzten Stand beim Verlassen der Seite sichern (sendBeacon).
  React.useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const flush = () => {
      accRef.current.close();
      sendProgress(true);
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flush();
    };
    window.addEventListener("pagehide", flush);
    window.addEventListener("beforeunload", flush);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("pagehide", flush);
      window.removeEventListener("beforeunload", flush);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [sendProgress]);

  React.useEffect(() => {
    return () => clearTick();
  }, [clearTick]);

  // ── Bunny-iframe: Fortschritt ueber player.js ───────────────────────────
  // Vorher wurde hier nur der erste Klick gezaehlt; deshalb stand in den
  // Auswertungen fuer alle Bunny-Videos „0 Sekunden“. player.js liefert
  // timeupdate {seconds, duration}, play, pause, seeked, ended.
  const [iframeArmed, setIframeArmed] = React.useState(true);
  const playerJsReadyRef = React.useRef(false);

  React.useEffect(() => {
    if (!bunnyEmbedUrl) return undefined;
    let cancelled = false;
    let player: PlayerJsPlayer | null = null;
    void loadPlayerJs().then((ok) => {
      if (cancelled || !ok || !iframeRef.current || !window.playerjs) return;
      try {
        player = new window.playerjs.Player(iframeRef.current);
        player.on("ready", () => {
          playerJsReadyRef.current = true;
          player?.getDuration((d) => {
            if (Number.isFinite(d) && d > 0) posRef.current.durationSec = d;
          });
        });
        player.on("play", () => {
          posRef.current.playing = true;
          onPlayStart(posRef.current.atSec);
          setIframeArmed(false);
        });
        player.on("pause", () => {
          posRef.current.playing = false;
          clearTick();
          accRef.current.close();
          sendProgress(true);
        });
        player.on("seeked", () => {
          accRef.current.seek();
          sendProgress(true);
        });
        player.on("timeupdate", (data) => {
          const d = (data ?? {}) as { seconds?: number; duration?: number };
          if (typeof d.duration === "number" && d.duration > 0) posRef.current.durationSec = d.duration;
          if (typeof d.seconds === "number") {
            posRef.current.atSec = d.seconds;
            if (posRef.current.playing) accRef.current.tick(d.seconds);
            fireMilestones(d.seconds, posRef.current.durationSec);
          }
        });
        player.on("ended", () => {
          posRef.current.playing = false;
          onEnded();
        });
      } catch {
        // player.js nicht verfuegbar → Fallback bleibt der Klick-Overlay
      }
    });
    return () => {
      cancelled = true;
    };
  }, [bunnyEmbedUrl, clearTick, fireMilestones, onEnded, onPlayStart, sendProgress]);

  // Fallback-Overlay (ohne player.js): erster Klick = video_play.
  const fireIframeStart = React.useCallback(() => {
    setIframeArmed(false);
    if (playerJsReadyRef.current) return; // player.js meldet play selbst
    onPlayStart(0);
  }, [onPlayStart]);

  const containerClass = containerClassFor(videoOrientation);
  const videoFitClass = videoObjectFitClassFor(videoOrientation);

  if (bunnyEmbedUrl) {
    return (
      <div className={containerClass}>
        <iframe
          ref={iframeRef}
          src={bunnyEmbedUrl}
          title={title ?? "Video"}
          loading="lazy"
          allow="accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture"
          allowFullScreen
          className="absolute inset-0 h-full w-full border-0"
        />
        {iframeArmed && (
          <button
            type="button"
            onClick={fireIframeStart}
            aria-label="Video starten"
            className="absolute inset-0 cursor-pointer bg-transparent"
          />
        )}
      </div>
    );
  }

  if (videoSrc) {
    return (
      <div className={containerClass}>
        <video
          ref={videoRef}
          src={videoSrc}
          poster={thumbnailUrl ?? undefined}
          controls
          playsInline
          preload="metadata"
          className={`absolute inset-0 h-full w-full ${videoFitClass}`}
          onPlay={onPlay}
          onTimeUpdate={onTimeUpdate}
          onPause={onPause}
          onSeeking={onSeeking}
          onSeeked={onSeeked}
          onEnded={onEnded}
        />
      </div>
    );
  }

  // No video yet — render a calm placeholder. The page-shell already
  // shows a "Wird erstellt" notice when the lead is still pending.
  // Placeholder erbt die korrigierte Aspect-Ratio damit der Layout-Shift
  // beim spaeteren Hydrate des echten Players minimal ist.
  const placeholderClass = containerClass.replace("bg-black", "bg-ink/5");
  return (
    <div
      className={`${placeholderClass} flex items-center justify-center text-sm text-ink-muted`}
    >
      Video wird vorbereitet
    </div>
  );
}

/**
 * `<CtaButton>` lived here historically. It now ships from the shared
 * block-component library so any block can render a tracked CTA without
 * pulling on the public-page tree. The re-export keeps existing imports
 * working without forcing a churn-only PR across callers.
 */
export { CtaButton } from "@/components/landing-blocks/cta-button";
export type {
  CtaButtonProps,
  CtaPosition,
} from "@/components/landing-blocks/cta-button";
