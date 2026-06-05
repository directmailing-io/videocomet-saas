"use client";

import * as React from "react";
import { setTrackingSlug, track } from "@/lib/tracker";

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
 *    carrying `atSec`, `playedSec` (monotonic max-watched), `durationSec`.
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
  const startedRef = React.useRef(false);
  const reachedRef = React.useRef<Set<number>>(new Set());
  // Monotonic high-water-mark: even if the user seeks backwards the value
  // never decreases. Bumped on every timeupdate tick.
  const maxPlayedSecRef = React.useRef(0);
  const intervalRef = React.useRef<ReturnType<typeof setInterval> | null>(null);

  // Ensure the tracker module knows the slug even on direct deep-links
  // (TrackerInit also calls this, but it is cheap and idempotent).
  React.useEffect(() => {
    if (slug) setTrackingSlug(slug);
  }, [slug]);

  const snapshotProgress = React.useCallback(() => {
    const video = videoRef.current;
    if (!video) return null;
    const dur = Number.isFinite(video.duration) ? video.duration : 0;
    return {
      atSec: Math.round(video.currentTime * 10) / 10,
      playedSec:
        Math.round(maxPlayedSecRef.current * 10) / 10,
      durationSec: Math.round(dur * 10) / 10,
    };
  }, []);

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
      if (!video || video.paused || video.ended) return;
      if (video.currentTime > maxPlayedSecRef.current) {
        maxPlayedSecRef.current = video.currentTime;
      }
      const snap = snapshotProgress();
      if (snap) track("video_progress", snap);
    }, PROGRESS_TICK_MS);
  }, [clearTick, snapshotProgress]);

  const onPlay = React.useCallback(() => {
    const video = videoRef.current;
    const atSec = video ? Math.round(video.currentTime * 10) / 10 : 0;
    track("video_play", { atSec });
    if (!startedRef.current) {
      startedRef.current = true;
      legacyTrackEvent("/api/track/video-start", { leadId });
    }
    startTick();
  }, [leadId, startTick]);

  const onTimeUpdate = React.useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.currentTime > maxPlayedSecRef.current) {
      maxPlayedSecRef.current = video.currentTime;
    }
    if (!video.duration || Number.isNaN(video.duration)) return;
    const pct = (video.currentTime / video.duration) * 100;
    for (const milestone of PROGRESS_MILESTONES) {
      if (pct >= milestone && !reachedRef.current.has(milestone)) {
        reachedRef.current.add(milestone);
        legacyTrackEvent("/api/track/video-progress", {
          leadId,
          percent: milestone,
        });
      }
    }
  }, [leadId]);

  const onPause = React.useCallback(() => {
    clearTick();
    const snap = snapshotProgress();
    if (snap) track("video_progress", snap);
  }, [clearTick, snapshotProgress]);

  const onSeeked = React.useCallback(() => {
    const snap = snapshotProgress();
    if (snap) track("video_progress", snap);
  }, [snapshotProgress]);

  const onEnded = React.useCallback(() => {
    clearTick();
    const video = videoRef.current;
    const dur = video && Number.isFinite(video.duration) ? video.duration : 0;
    if (dur > maxPlayedSecRef.current) maxPlayedSecRef.current = dur;
    const snap = snapshotProgress() ?? {
      atSec: dur,
      playedSec: dur,
      durationSec: dur,
    };
    track("video_progress", snap);
    track("video_ended", {
      atSec: snap.durationSec,
      playedSec: snap.playedSec,
      durationSec: snap.durationSec,
    });
    if (!reachedRef.current.has(100)) {
      reachedRef.current.add(100);
      legacyTrackEvent("/api/track/video-progress", { leadId, percent: 100 });
    }
  }, [clearTick, leadId, snapshotProgress]);

  // Flush a final progress beacon when the page is unloaded mid-play. We
  // listen on both pagehide (modern Safari + back-forward cache) and
  // beforeunload (other browsers) — both fire sendBeacon happily.
  React.useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const flush = () => {
      const snap = snapshotProgress();
      if (snap) track("video_progress", snap);
    };
    window.addEventListener("pagehide", flush);
    window.addEventListener("beforeunload", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      window.removeEventListener("beforeunload", flush);
    };
  }, [snapshotProgress]);

  // Belt-and-braces: clear the interval on unmount so we never leak a
  // recurring timer after the component leaves the tree.
  React.useEffect(() => {
    return () => clearTick();
  }, [clearTick]);

  // iframe path: we cannot inspect play/progress from a cross-origin
  // iframe without Bunny's player.js integration. The "video-start"
  // is approximated by the first interaction with the iframe surface:
  // we render a transparent overlay that captures pointer events once,
  // then disappears (the click also activates the iframe controls).
  const [iframeArmed, setIframeArmed] = React.useState(true);
  const fireIframeStart = React.useCallback(() => {
    track("video_play", { atSec: 0 });
    if (startedRef.current) return;
    startedRef.current = true;
    legacyTrackEvent("/api/track/video-start", { leadId });
    setIframeArmed(false);
  }, [leadId]);

  const containerClass = containerClassFor(videoOrientation);
  const videoFitClass = videoObjectFitClassFor(videoOrientation);

  if (bunnyEmbedUrl) {
    return (
      <div className={containerClass}>
        <iframe
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
