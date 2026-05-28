"use client";

/**
 * preview-player — 16:9 live preview of a campaign editor timeline.
 *
 * What it does:
 *   Takes the same Segment list and PiP settings that drive the worker render
 *   pipeline and plays them back in the browser so the user can iterate on
 *   timing/composition without round-tripping through FFmpeg.
 *
 * Layout:
 *   16:9 stage = active segment (text/image/video/website/gdocs)
 *   PiP overlay = the recorded webcam clip, positioned + shaped per props
 *   Controls    = play/pause + time readout + scrubber
 *
 * Playback model:
 *   We own a single `currentTimeMs` integer in state that ranges
 *   [0, totalDurationMs]. While `playing`, a requestAnimationFrame loop
 *   advances it by the wall-clock delta since the previous frame so playback
 *   stays correct even when the tab is throttled. The webcam video element
 *   and any active VideoSegment have their `.currentTime` driven from the
 *   same clock — they don't run their own playback, they just follow.
 *
 * Why follow-mode for media elements:
 *   Letting HTMLMediaElement play itself would desynchronise from the timeline
 *   the moment a user scrubs, switches segments, or pauses. Driving currentTime
 *   from a single authoritative clock keeps the segment cuts frame-accurate.
 */

import * as React from "react";
import { Play, Pause } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Segment } from "@/lib/segments/types";
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
}

/* ------------------------------------------------------------------ */
/* Time formatting                                                    */
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
/* PiP geometry                                                       */
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
/* Component                                                          */
/* ------------------------------------------------------------------ */

export function PreviewPlayer({
  segments,
  webcamUrl,
  webcamDurationSec,
  pipPosition,
  pipShape,
  sampleData,
}: PreviewPlayerProps) {
  const totalDurationMs = React.useMemo(
    () => getTotalDurationMs(segments),
    [segments],
  );

  const [currentTimeMs, setCurrentTimeMs] = React.useState(0);
  const [playing, setPlaying] = React.useState(false);
  const [webcamReady, setWebcamReady] = React.useState(false);

  // refs used by the requestAnimationFrame loop
  const rafRef = React.useRef<number | null>(null);
  const lastTickRef = React.useRef<number | null>(null);
  const playingRef = React.useRef(false);
  const totalRef = React.useRef(totalDurationMs);
  React.useEffect(() => {
    totalRef.current = totalDurationMs;
  }, [totalDurationMs]);

  // Refs for media follow-mode
  const webcamRef = React.useRef<HTMLVideoElement | null>(null);
  const segmentVideoRef = React.useRef<HTMLVideoElement | null>(null);

  // Clamp/reset playhead when the timeline shape changes.
  React.useEffect(() => {
    if (totalDurationMs <= 0) {
      setCurrentTimeMs(0);
      setPlaying(false);
      return;
    }
    setCurrentTimeMs((prev) => (prev > totalDurationMs ? totalDurationMs : prev));
    // Only re-run when the timeline shape changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [totalDurationMs]);

  /* ------------------------------------------------------------------ */
  /* RAF playback loop                                                  */
  /* ------------------------------------------------------------------ */

  React.useEffect(() => {
    playingRef.current = playing;
    if (!playing) {
      lastTickRef.current = null;
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      return;
    }

    const step = (now: number) => {
      if (!playingRef.current) return;
      const last = lastTickRef.current;
      if (last !== null) {
        const delta = now - last;
        setCurrentTimeMs((prev) => {
          const next = prev + delta;
          if (next >= totalRef.current) {
            // Reached the end → pause + snap to 0
            playingRef.current = false;
            setPlaying(false);
            return 0;
          }
          return next;
        });
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
  }, [playing]);

  /* ------------------------------------------------------------------ */
  /* Active segment + media follow-mode                                 */
  /* ------------------------------------------------------------------ */

  const active = React.useMemo(
    () => getActiveSegment(segments, currentTimeMs),
    [segments, currentTimeMs],
  );

  // Sync webcam clip currentTime to the global clock. Clamp to its duration.
  React.useEffect(() => {
    const el = webcamRef.current;
    if (!el || !webcamReady) return;
    const targetSec = currentTimeMs / 1000;
    const dur =
      typeof webcamDurationSec === "number" && webcamDurationSec > 0
        ? webcamDurationSec
        : Number.isFinite(el.duration)
          ? el.duration
          : null;
    const clamped =
      dur !== null && dur > 0
        ? Math.min(targetSec, Math.max(0, dur - 0.05))
        : targetSec;
    // Avoid hammering currentTime with sub-frame changes that would cause flicker.
    if (Math.abs(el.currentTime - clamped) > 0.05) {
      try {
        el.currentTime = clamped;
      } catch {
        /* ignore */
      }
    }
  }, [currentTimeMs, webcamDurationSec, webcamReady]);

  // Sync the active VideoSegment's currentTime, taking trimStartMs into account.
  React.useEffect(() => {
    if (!active) return;
    if (active.segment.kind !== "video") return;
    const el = segmentVideoRef.current;
    if (!el) return;
    const trimStart = active.segment.trimStartMs ?? 0;
    const targetSec = (active.segmentTimeMs + trimStart) / 1000;
    const dur = Number.isFinite(el.duration) ? el.duration : null;
    const clamped =
      dur !== null && dur > 0
        ? Math.min(targetSec, Math.max(0, dur - 0.05))
        : targetSec;
    if (Math.abs(el.currentTime - clamped) > 0.05) {
      try {
        el.currentTime = clamped;
      } catch {
        /* ignore */
      }
    }
  }, [active, currentTimeMs]);

  /* ------------------------------------------------------------------ */
  /* Handlers                                                           */
  /* ------------------------------------------------------------------ */

  function togglePlay() {
    if (totalDurationMs <= 0) return;
    setPlaying((p) => !p);
  }

  function onScrub(e: React.ChangeEvent<HTMLInputElement>) {
    const v = Number(e.target.value);
    if (!Number.isFinite(v)) return;
    setCurrentTimeMs(Math.max(0, Math.min(totalDurationMs, v)));
  }

  /* ------------------------------------------------------------------ */
  /* Render                                                             */
  /* ------------------------------------------------------------------ */

  const hasContent = segments.length > 0;
  const pipPosCls = pipPositionClass(pipPosition);
  const pipShapeCls = pipShapeClass(pipShape);
  const progressPct =
    totalDurationMs > 0
      ? Math.max(0, Math.min(100, (currentTimeMs / totalDurationMs) * 100))
      : 0;

  return (
    <div className="w-full max-w-[800px]">
      {/* Stage */}
      <div className="relative aspect-video w-full overflow-hidden rounded-squircle-md bg-ink shadow-card">
        {!hasContent ? (
          <div className="absolute inset-0 flex items-center justify-center p-6 text-center">
            <p className="max-w-sm text-sm text-white/80">
              Füge Segmente hinzu, um die Vorschau zu sehen.
            </p>
          </div>
        ) : active ? (
          <PreviewSegmentRender
            segment={active.segment}
            segmentTimeMs={active.segmentTimeMs}
            sampleData={sampleData}
            videoRef={
              active.segment.kind === "video" ? segmentVideoRef : undefined
            }
          />
        ) : null}

        {/* Webcam PiP overlay — 25% of the stage width */}
        {webcamUrl && (
          <div
            className={cn(
              "absolute overflow-hidden bg-ink shadow-lg ring-1 ring-black/10",
              pipPosCls,
              pipShapeCls,
            )}
            style={
              pipShape === "circle"
                ? { width: "25%" }
                : { width: "25%", aspectRatio: "16 / 9" }
            }
          >
            {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
            <video
              ref={webcamRef}
              src={webcamUrl}
              muted
              playsInline
              preload="auto"
              className="h-full w-full object-cover"
              onLoadedMetadata={() => setWebcamReady(true)}
            />
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

        <span className="font-mono text-xs tabular-nums text-ink-muted">
          {formatTime(currentTimeMs)} / {formatTime(totalDurationMs)}
        </span>

        <input
          type="range"
          min={0}
          max={Math.max(0, totalDurationMs)}
          step={10}
          value={Math.min(currentTimeMs, totalDurationMs)}
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
