"use client";

import * as React from "react";

/**
 * Public landing-page video player.
 *
 * Prefers an iframe embed (Bunny Stream) when an embed URL is supplied,
 * otherwise falls back to a native <video> element. Either way the player
 * is responsive (16:9) and fills its container.
 *
 * Tracking:
 *  - `video-start` is reported on the first play event of the session.
 *  - `video-progress` is reported when the user crosses 25/50/75/100%
 *    thresholds. Each milestone fires at most once per page load. We use
 *    `navigator.sendBeacon` so events survive page-unload navigations.
 *
 * When using the iframe player we cannot observe progress without the
 * postMessage handshake from Bunny — so we only attempt fine-grained
 * tracking in the native fallback. The video-start event still fires
 * (the iframe at least signals load completion via onLoad).
 */

export interface VideoPlayerProps {
  leadId: string;
  bunnyEmbedUrl?: string | null;
  videoSrc?: string | null;
  thumbnailUrl?: string | null;
  title?: string;
}

function trackEvent(path: string, payload: Record<string, unknown>): void {
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
    // Fallback (some Safari versions reject Blob beacons of certain types).
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

export function VideoPlayer({
  leadId,
  bunnyEmbedUrl,
  videoSrc,
  thumbnailUrl,
  title,
}: VideoPlayerProps) {
  const videoRef = React.useRef<HTMLVideoElement | null>(null);
  const startedRef = React.useRef(false);
  const reachedRef = React.useRef<Set<number>>(new Set());

  const onPlay = React.useCallback(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    trackEvent("/api/track/video-start", { leadId });
  }, [leadId]);

  const onTimeUpdate = React.useCallback(() => {
    const video = videoRef.current;
    if (!video || !video.duration || Number.isNaN(video.duration)) return;
    const pct = (video.currentTime / video.duration) * 100;
    for (const milestone of PROGRESS_MILESTONES) {
      if (pct >= milestone && !reachedRef.current.has(milestone)) {
        reachedRef.current.add(milestone);
        trackEvent("/api/track/video-progress", {
          leadId,
          percent: milestone,
        });
      }
    }
  }, [leadId]);

  const onEnded = React.useCallback(() => {
    if (!reachedRef.current.has(100)) {
      reachedRef.current.add(100);
      trackEvent("/api/track/video-progress", { leadId, percent: 100 });
    }
  }, [leadId]);

  // iframe path: we cannot inspect play/progress from a cross-origin
  // iframe without Bunny's player.js integration. The "video-start"
  // is approximated by the first interaction with the iframe surface:
  // we render a transparent overlay that captures pointer events once,
  // then disappears (the click also activates the iframe controls).
  const [iframeArmed, setIframeArmed] = React.useState(true);
  const fireIframeStart = React.useCallback(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    trackEvent("/api/track/video-start", { leadId });
    setIframeArmed(false);
  }, [leadId]);

  if (bunnyEmbedUrl) {
    return (
      <div className="relative w-full aspect-video bg-black">
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
      <div className="relative w-full aspect-video bg-black">
        <video
          ref={videoRef}
          src={videoSrc}
          poster={thumbnailUrl ?? undefined}
          controls
          playsInline
          preload="metadata"
          className="absolute inset-0 h-full w-full object-contain"
          onPlay={onPlay}
          onTimeUpdate={onTimeUpdate}
          onEnded={onEnded}
        />
      </div>
    );
  }

  // No video yet — render a calm placeholder. The page-shell already
  // shows a "Wird erstellt" notice when the lead is still pending.
  return (
    <div className="relative w-full aspect-video bg-ink/5 flex items-center justify-center text-sm text-ink-muted">
      Video wird vorbereitet
    </div>
  );
}

/**
 * CTA button with click-tracking. Renders as an <a> so right-click /
 * middle-click / open-in-new-tab continue to work normally.
 */
export interface CtaButtonProps {
  leadId: string;
  label: string;
  href: string;
  className?: string;
  children: React.ReactNode;
}

export function CtaButton({
  leadId,
  label,
  href,
  className,
  children,
}: CtaButtonProps) {
  const handleClick = React.useCallback(() => {
    trackEvent("/api/track/cta-click", { leadId, label, href });
  }, [leadId, label, href]);
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      onClick={handleClick}
      onAuxClick={handleClick}
      className={className}
    >
      {children}
    </a>
  );
}
