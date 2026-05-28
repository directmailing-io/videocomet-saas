"use client";

/**
 * preview-segment-render — pure rendering helpers for the live editor preview.
 *
 * The editor's timeline emits a `Segment` discriminated union (see
 * `@/lib/segments/types`). This module knows how to draw each kind onto the
 * 16:9 preview stage so the user sees roughly what the worker will render.
 *
 * What this file is NOT:
 *   No state, no refs, no playback loop. Pure presentation. The host component
 *   owns currentTimeMs and computes the active segment + segmentTimeMs before
 *   asking us to render. Video segment timing is driven via the `videoRef`
 *   prop so the parent can sync `currentTime` against the global scrubber.
 */

import * as React from "react";
import { Globe, FileText, ImageOff, VideoOff } from "lucide-react";
import type {
  Segment,
  TextSegment,
  ImageSegment,
  VideoSegment,
  WebsiteSegment,
  GDocsSegment,
} from "@/lib/segments/types";

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
}: {
  segment: VideoSegment;
  videoRef?: React.RefObject<HTMLVideoElement>;
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
      />
    </div>
  );
}

function RenderWebsite({ segment }: { segment: WebsiteSegment }) {
  const showUrl = segment.fallbackUrl || `Spalte: ${segment.urlColumn || "?"}`;
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-surface-soft p-8">
      <div className="w-full max-w-md rounded-squircle-md border border-line bg-surface px-6 py-5 shadow-card">
        <div className="mb-3 flex items-center gap-2 text-brand-deep">
          <Globe className="size-5" />
          <span className="text-xs font-semibold uppercase tracking-wide">
            Website ({segment.captureMode === "scroll" ? "Scroll" : "Screenshot"})
          </span>
        </div>
        <p className="mb-3 break-all text-sm font-medium text-ink">
          {showUrl}
        </p>
        <p className="text-xs leading-relaxed text-ink-muted">
          Wird beim Generieren live aufgenommen. In der Vorschau zeigen wir
          nur eine Platzhalter-Karte, damit dein Browser keine fremde Seite
          öffnen muss.
        </p>
      </div>
    </div>
  );
}

function RenderGDocs({ segment }: { segment: GDocsSegment }) {
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-surface-soft p-8">
      <div className="w-full max-w-md rounded-squircle-md border border-line bg-surface px-6 py-5 shadow-card">
        <div className="mb-3 flex items-center gap-2 text-brand-deep">
          <FileText className="size-5" />
          <span className="text-xs font-semibold uppercase tracking-wide">
            Google Doc ({segment.captureMode === "scroll" ? "Scroll" : "Screenshot"})
          </span>
        </div>
        <p className="mb-3 break-all text-sm font-medium text-ink">
          {segment.docsUrl || "Keine Docs-URL gesetzt"}
        </p>
        <p className="text-xs leading-relaxed text-ink-muted">
          Google-Doc wird live geladen, wenn das Video gerendert wird. Die
          Vorschau zeigt nur einen Platzhalter.
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
}

export function PreviewSegmentRender({
  segment,
  segmentTimeMs: _segmentTimeMs,
  sampleData,
  videoRef,
}: PreviewSegmentRenderProps): React.ReactElement | null {
  switch (segment.kind) {
    case "text":
      return <RenderText segment={segment} sampleData={sampleData} />;
    case "image":
      return <RenderImage segment={segment} />;
    case "video":
      return <RenderVideo segment={segment} videoRef={videoRef} />;
    case "website":
      return <RenderWebsite segment={segment} />;
    case "gdocs":
      return <RenderGDocs segment={segment} />;
  }
  // Exhaustive: all union members handled above. TS will flag missing cases.
  return null;
}
