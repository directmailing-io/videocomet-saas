"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import type { Segment } from "@/lib/segments/types";
import { totalDurationMs as sumDuration } from "@/lib/segments/duration";
import { TimelineRuler } from "./timeline-ruler";
import { TimelineSegmentBlock } from "./timeline-segment-block";

export interface TimelineProps {
  segments: Segment[];
  /** Aktuelle Playhead-Position in ms. */
  currentTimeMs: number;
  /** Optional: Skaliere auf diese Gesamtdauer (z. B. Webcam-Länge). */
  totalDurationMs?: number;
  /**
   * Hartes Limit: Summe aller Segmente darf diesen Wert nicht überschreiten.
   * Typischerweise == webcamDurationMs. Wenn undefined, kein Limit.
   */
  webcamDurationMs?: number | null;
  selectedSegmentId: string | null;
  onSelectSegment: (id: string | null) => void;
  onSegmentsChange: (segments: Segment[]) => void;
  onSeek: (timeMs: number) => void;
  className?: string;
}

/**
 * Minimal-Breite eines Sekunden-Schritts. Damit die Tick-Marks gut lesbar
 * sind, zoomen wir die Timeline so, dass jede Sekunde mindestens diese
 * Pixelbreite belegt - auch wenn die Gesamtdauer sehr kurz ist.
 */
const MIN_PX_PER_SECOND = 60;

export function Timeline({
  segments,
  currentTimeMs,
  totalDurationMs,
  webcamDurationMs,
  selectedSegmentId,
  onSelectSegment,
  onSegmentsChange,
  onSeek,
  className,
}: TimelineProps) {
  const segmentsTotalMs = React.useMemo(() => sumDuration(segments), [segments]);
  // Wenn totalDurationMs gesetzt, nutzen wir das als Skala, sonst Summe.
  const scaleMs = Math.max(1, totalDurationMs ?? segmentsTotalMs);

  // Container-Breite messen, damit wir Mindest-Zoom anwenden können.
  const containerRef = React.useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = React.useState(0);

  React.useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 0;
      setContainerWidth(w);
    });
    observer.observe(el);
    setContainerWidth(el.clientWidth);
    return () => observer.disconnect();
  }, []);

  // Mindestens MIN_PX_PER_SECOND pro Sekunde - oder Container-Breite, je nachdem was größer ist.
  const minScrollWidth = (scaleMs / 1000) * MIN_PX_PER_SECOND;
  const trackWidth = Math.max(minScrollWidth, containerWidth || minScrollWidth);
  const msPerPx = scaleMs / Math.max(1, trackWidth);
  const pxPerMs = 1 / msPerPx;

  // Live-Preview für Trim: lokaler Overlay-State, der Original-Props nicht mutiert.
  const [previewSegments, setPreviewSegments] = React.useState<Segment[] | null>(null);
  const displaySegments = previewSegments ?? segments;

  function applyTrimPreview(id: string, newDurationMs: number) {
    setPreviewSegments(() => {
      const base = segments;
      return base.map((s) => (s.id === id ? { ...s, durationMs: newDurationMs } : s));
    });
  }

  function commitTrim(id: string, newDurationMs: number) {
    setPreviewSegments(null);
    const next = segments.map((s) =>
      s.id === id ? { ...s, durationMs: newDurationMs } : s,
    );
    onSegmentsChange(next);
  }

  function moveSegment(id: string, direction: -1 | 1) {
    const idx = segments.findIndex((s) => s.id === id);
    if (idx < 0) return;
    const target = idx + direction;
    if (target < 0 || target >= segments.length) return;
    const next = [...segments];
    const [removed] = next.splice(idx, 1);
    next.splice(target, 0, removed);
    onSegmentsChange(next);
  }

  // Playhead - geklemmt auf [0, scaleMs].
  const clampedTimeMs = Math.min(scaleMs, Math.max(0, currentTimeMs));
  const playheadLeft = clampedTimeMs * pxPerMs;

  // Playhead-Drag-State.
  const seekDragRef = React.useRef(false);

  function seekFromEvent(event: PointerEvent | React.PointerEvent) {
    const trackEl = trackAreaRef.current;
    if (!trackEl) return;
    const rect = trackEl.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const ratio = Math.min(1, Math.max(0, x / Math.max(1, rect.width)));
    onSeek(Math.round(ratio * scaleMs));
  }

  const trackAreaRef = React.useRef<HTMLDivElement>(null);

  function handleTrackPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    // Nur auf den Track-Hintergrund reagieren, nicht auf Segment-Blöcke.
    if (event.target !== event.currentTarget) return;
    onSelectSegment(null);
    seekDragRef.current = true;
    seekFromEvent(event);
    const onMove = (e: PointerEvent) => {
      if (!seekDragRef.current) return;
      seekFromEvent(e);
    };
    const onUp = () => {
      seekDragRef.current = false;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  function handleRulerPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    seekDragRef.current = true;
    seekFromEvent(event);
    const onMove = (e: PointerEvent) => {
      if (!seekDragRef.current) return;
      seekFromEvent(e);
    };
    const onUp = () => {
      seekDragRef.current = false;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  function handlePlayheadPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    event.stopPropagation();
    seekDragRef.current = true;
    seekFromEvent(event);
    const onMove = (e: PointerEvent) => {
      if (!seekDragRef.current) return;
      seekFromEvent(e);
    };
    const onUp = () => {
      seekDragRef.current = false;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  // Pro Segment das Maximum berechnen: webcamDurationMs minus Summe der
  // anderen Segmente. Damit kann der Block den User beim Trim hart begrenzen.
  const maxPerSegmentMs = React.useMemo(() => {
    const map = new Map<string, number>();
    if (webcamDurationMs == null) return map;
    const totalAll = sumDuration(segments);
    for (const seg of segments) {
      const otherSum = totalAll - seg.durationMs;
      map.set(seg.id, Math.max(200, webcamDurationMs - otherSum));
    }
    return map;
  }, [segments, webcamDurationMs]);

  // Block-Positionen kumulativ aus Display-Dauern berechnen.
  const blocks = React.useMemo(() => {
    let offsetMs = 0;
    return displaySegments.map((seg, idx) => {
      const leftPx = offsetMs * pxPerMs;
      const widthPx = Math.max(2, seg.durationMs * pxPerMs);
      offsetMs += seg.durationMs;
      return { seg, idx, leftPx, widthPx };
    });
  }, [displaySegments, pxPerMs]);

  if (segments.length === 0) {
    return (
      <div
        ref={containerRef}
        className={cn(
          "relative h-32 rounded-squircle-md bg-surface-soft border border-line",
          "flex items-center justify-center",
          className,
        )}
      >
        <p className="text-sm text-ink-muted px-6 text-center">
          Keine Segmente. Füge oben Segmente hinzu, um sie hier zu sehen.
        </p>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className={cn(
        "relative h-32 rounded-squircle-md bg-surface-soft border border-line overflow-x-auto overflow-y-hidden",
        className,
      )}
    >
      <div className="relative" style={{ width: `${trackWidth}px` }}>
        <TimelineRuler
          totalDurationMs={scaleMs}
          widthPx={trackWidth}
          onSeekPointerDown={handleRulerPointerDown}
        />

        <div
          ref={trackAreaRef}
          onPointerDown={handleTrackPointerDown}
          className="relative h-[calc(8rem-1.75rem)] cursor-crosshair"
          style={{ width: `${trackWidth}px` }}
        >
          <div className="absolute inset-2">
            {blocks.map(({ seg, idx, leftPx, widthPx }) => (
              <TimelineSegmentBlock
                key={seg.id}
                segment={seg}
                leftPx={leftPx}
                widthPx={widthPx}
                selected={seg.id === selectedSegmentId}
                index={idx}
                total={displaySegments.length}
                onSelect={onSelectSegment}
                onTrimPreview={applyTrimPreview}
                onTrimCommit={commitTrim}
                onMoveLeft={(id) => moveSegment(id, -1)}
                onMoveRight={(id) => moveSegment(id, 1)}
                msPerPx={msPerPx}
                maxDurationMs={maxPerSegmentMs.get(seg.id)}
              />
            ))}
          </div>

          {/* Playhead */}
          <div
            role="slider"
            aria-label="Playhead"
            aria-valuemin={0}
            aria-valuemax={scaleMs}
            aria-valuenow={clampedTimeMs}
            tabIndex={0}
            onPointerDown={handlePlayheadPointerDown}
            className="absolute top-0 bottom-0 w-px bg-brand z-20 pointer-events-auto cursor-ew-resize"
            style={{ left: `${playheadLeft}px` }}
          >
            <span className="absolute -top-1 -translate-x-1/2 size-3 rounded-full bg-brand shadow-brand" />
          </div>
        </div>
      </div>
    </div>
  );
}
