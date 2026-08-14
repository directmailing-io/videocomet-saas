"use client";

import * as React from "react";
import { Minus, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Segment } from "@/lib/segments/types";
import { totalDurationMs as sumDuration } from "@/lib/segments/duration";
import { computeReorderTargetIndex, type BlockPos } from "@/lib/segments/reorder";
import { TimelineRuler } from "./timeline-ruler";
import { kindLabel, TimelineSegmentBlock } from "./timeline-segment-block";

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
 * Zoom-Modell: `"fit"` = die ganze Timeline füllt exakt den Container
 * (kein horizontales Scrollen, Default), Zahl = px pro Sekunde für
 * Detail-Arbeit (Overflow → horizontaler Scroll). Stufenlos über Slider,
 * +/−-Buttons und Ctrl/Cmd+Mausrad; Rauszoomen unter die Fit-Stufe
 * rastet automatisch auf "fit".
 */
const MIN_ZOOM = 10;
const MAX_ZOOM = 1000;
const ZOOM_STEP = 1.5;
const MIN_SEGMENT_MS = 200;

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

  const [zoom, setZoom] = React.useState<"fit" | number>("fit");
  const fitZoom = containerWidth > 0 ? containerWidth / (scaleMs / 1000) : MIN_ZOOM;
  const effZoom = zoom === "fit" ? fitZoom : zoom;
  const canZoomOut = zoom !== "fit";
  const canZoomIn = effZoom < MAX_ZOOM;

  function setZoomClamped(next: number) {
    // Unter der Fit-Stufe gibt es nichts mehr zu sehen → auf Fit rasten.
    if (next <= fitZoom) {
      setZoom("fit");
      return;
    }
    setZoom(Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, next)));
  }

  // Logarithmische Slider-Skala: gleiche Slider-Wege fühlen sich über den
  // gesamten Bereich (10–1000 px/s) gleich stark an.
  const sliderPos = Math.round(
    Math.min(
      100,
      Math.max(
        0,
        (100 * Math.log(Math.max(MIN_ZOOM, effZoom) / MIN_ZOOM)) /
          Math.log(MAX_ZOOM / MIN_ZOOM),
      ),
    ),
  );

  const zoomedWidth = (scaleMs / 1000) * effZoom;
  const trackWidth =
    zoom === "fit"
      ? Math.max(1, containerWidth)
      : Math.max(zoomedWidth, containerWidth || zoomedWidth);
  const msPerPx = scaleMs / Math.max(1, trackWidth);
  const pxPerMs = 1 / msPerPx;

  // Ctrl/Cmd+Mausrad-Zoom, am Cursor verankert: der Zeitpunkt unter dem
  // Mauszeiger bleibt beim Zoomen an derselben Bildschirmposition.
  // Nativer Listener mit passive:false, weil React-onWheel das
  // preventDefault (Browser-Page-Zoom) nicht zuverlässig unterdrücken kann.
  const zoomStateRef = React.useRef({ effZoom, fitZoom });
  zoomStateRef.current = { effZoom, fitZoom };
  const wheelAnchorRef = React.useRef<{ timeMs: number; cursorX: number } | null>(null);

  React.useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const { effZoom: cur, fitZoom: fit } = zoomStateRef.current;
      const factor = e.deltaY < 0 ? 1.2 : 1 / 1.2;
      const next = cur * factor;
      const rect = el.getBoundingClientRect();
      const cursorX = e.clientX - rect.left;
      wheelAnchorRef.current = {
        timeMs: ((el.scrollLeft + cursorX) / Math.max(0.001, cur)) * 1000,
        cursorX,
      };
      if (next <= fit) setZoom("fit");
      else setZoom(Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, next)));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  React.useLayoutEffect(() => {
    const anchor = wheelAnchorRef.current;
    const el = containerRef.current;
    if (!anchor || !el) return;
    wheelAnchorRef.current = null;
    el.scrollLeft = Math.max(0, (anchor.timeMs / 1000) * effZoom - anchor.cursorX);
  }, [effZoom]);

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

  // ── Roll-Edit: Grenze zwischen zwei Segmenten verschieben ────────────
  // Linker Handle von Segment i (i > 0): deltaMs > 0 macht das vorige
  // Segment länger und dieses kürzer — die Gesamtdauer bleibt konstant,
  // deshalb kann das Webcam-Limit hier nie überschritten werden.
  function rollAdjusted(id: string, deltaMs: number): Segment[] | null {
    const idx = segments.findIndex((s) => s.id === id);
    if (idx <= 0) return null;
    const prev = segments[idx - 1];
    const cur = segments[idx];
    const snapped = Math.round(deltaMs / 100) * 100;
    const maxGrow = Math.max(0, cur.durationMs - MIN_SEGMENT_MS);
    const maxShrink = Math.max(0, prev.durationMs - MIN_SEGMENT_MS);
    const d = Math.max(-maxShrink, Math.min(maxGrow, snapped));
    if (d === 0) return null;
    return segments.map((s, i) =>
      i === idx - 1
        ? { ...s, durationMs: s.durationMs + d }
        : i === idx
          ? { ...s, durationMs: s.durationMs - d }
          : s,
    );
  }

  function applyRollPreview(id: string, deltaMs: number) {
    setPreviewSegments(rollAdjusted(id, deltaMs) ?? segments);
  }

  function commitRoll(id: string, deltaMs: number) {
    setPreviewSegments(null);
    const next = rollAdjusted(id, deltaMs);
    if (next) onSegmentsChange(next);
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

  // ── Segment duplizieren ──────────────────────────────────────────────
  // Restbudget gegen das Webcam-Limit: nur wenn mindestens die Mindest-
  // Segmentdauer frei ist, darf dupliziert werden. Die Kopie wird ggf.
  // aufs Restbudget gekappt.
  const remainingBudgetMs =
    webcamDurationMs != null
      ? Math.max(0, webcamDurationMs - segmentsTotalMs)
      : Number.POSITIVE_INFINITY;
  const canDuplicate = remainingBudgetMs >= MIN_SEGMENT_MS;

  function duplicateSegment(id: string) {
    if (!canDuplicate) return;
    const idx = segments.findIndex((s) => s.id === id);
    if (idx < 0) return;
    const original = segments[idx];
    const copy: Segment = {
      ...structuredClone(original),
      id: crypto.randomUUID(),
      label: `${original.label?.trim() || kindLabel(original.kind)} (Kopie)`,
      durationMs: Math.min(original.durationMs, remainingBudgetMs),
    };
    const next = [...segments];
    next.splice(idx + 1, 0, copy);
    onSegmentsChange(next);
    onSelectSegment(copy.id);
  }

  function moveSegmentToIndex(id: string, targetIdx: number) {
    const from = segments.findIndex((s) => s.id === id);
    if (from < 0 || from === targetIdx) return;
    const next = [...segments];
    const [removed] = next.splice(from, 1);
    next.splice(targetIdx, 0, removed);
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
  const blocksWrapRef = React.useRef<HTMLDivElement>(null);

  function handleTrackPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    // Nur auf den Track-Hintergrund reagieren, nicht auf Segment-Blöcke.
    // Der Block-Wrapper (inset-2) liegt über dem Track und ist ebenfalls
    // "Hintergrund" — Klicks darauf zählen als Deselect.
    if (
      event.target !== event.currentTarget &&
      event.target !== blocksWrapRef.current
    )
      return;
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

  // ── Drag-Reorder ─────────────────────────────────────────────────────
  // Pointer-basiert (konsistent mit Trim). Beim Drag-Start speichern wir
  // den Segment-ID; onMove berechnet den aktuellen Ziel-Insert-Index über
  // die reine `computeReorderTargetIndex`; onEnd committet.
  const [reorderState, setReorderState] = React.useState<{
    id: string;
    targetIdx: number;
  } | null>(null);
  const reorderRef = React.useRef<{
    id: string;
    posSnapshot: BlockPos[];
  } | null>(null);

  function handleReorderStart(id: string, event: React.PointerEvent) {
    event.stopPropagation();
    event.preventDefault();
    // Snapshot der Block-Positionen (im aktuellen Zoom) einfrieren, damit
    // die Ziel-Berechnung nicht mit der Live-Verschiebung driftet.
    const snapshot: BlockPos[] = blocks.map((b) => ({
      id: b.seg.id,
      leftPx: b.leftPx,
      widthPx: b.widthPx,
    }));
    reorderRef.current = { id, posSnapshot: snapshot };
    const from = snapshot.findIndex((b) => b.id === id);
    setReorderState({ id, targetIdx: from });
    const trackEl = blocksWrapRef.current;
    const rect = trackEl?.getBoundingClientRect();
    const onMove = (e: PointerEvent) => {
      const ref = reorderRef.current;
      if (!ref || !rect) return;
      const x = e.clientX - rect.left;
      const target = computeReorderTargetIndex(ref.posSnapshot, ref.id, x);
      setReorderState((prev) =>
        prev && prev.targetIdx === target ? prev : { id: ref.id, targetIdx: target },
      );
    };
    const onUp = () => {
      const ref = reorderRef.current;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      setReorderState((prev) => {
        if (ref && prev) moveSegmentToIndex(ref.id, prev.targetIdx);
        return null;
      });
      reorderRef.current = null;
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  }

  // Position des Insertion-Indikators (senkrechte Linie zwischen den Blocks).
  const insertionLineLeftPx = React.useMemo(() => {
    if (!reorderState) return null;
    const targetIdx = reorderState.targetIdx;
    // Vor Block targetIdx einfügen — Linie links davon; wenn hinter dem
    // letzten, Linie rechts vom letzten Block.
    if (targetIdx < 0 || blocks.length === 0) return null;
    const from = blocks.findIndex((b) => b.seg.id === reorderState.id);
    if (from < 0) return null;
    // Wenn Target == aktuelle Position, keine Linie zeichnen (no-op).
    if (targetIdx === from) return null;
    // Für die visuelle Linie ist der Split-Punkt zwischen den Blocks nach
    // dem Entfernen des gezogenen Segments. Wir approximieren mit dem
    // linken Rand von blocks[targetIdx] (bzw. rechts vom letzten).
    if (targetIdx >= blocks.length - 1 && from < blocks.length - 1) {
      const last = blocks[blocks.length - 1];
      return last.leftPx + last.widthPx;
    }
    // Wenn from < targetIdx, dann liegt targetIdx-Block eine Position
    // weiter links im Snapshot — Linie an dessen rechter Kante.
    if (from < targetIdx) {
      const b = blocks[targetIdx];
      return b.leftPx + b.widthPx;
    }
    return blocks[targetIdx].leftPx;
  }, [reorderState, blocks]);

  if (segments.length === 0) {
    return (
      <div className={cn("space-y-2", className)}>
        <div
          ref={containerRef}
          className={cn(
            "relative h-32 rounded-squircle-md bg-surface-soft border border-line",
            "flex items-center justify-center",
          )}
        >
          <p className="text-sm text-ink-muted px-6 text-center">
            Noch keine Segmente. Klicke auf „Segment hinzufügen", um zu starten.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className={cn("space-y-2", className)}>
      {/* Zoom-Toolbar — bei langen Videos entscheidend, um einzelne
          Segmente feinjustieren zu können. */}
      <div className="flex items-center justify-end gap-2 text-xs text-ink-muted">
        <button
          type="button"
          onClick={() => setZoom("fit")}
          aria-pressed={zoom === "fit"}
          className={cn(
            "rounded-full border px-2.5 py-1 leading-none transition-colors",
            zoom === "fit"
              ? "border-ink bg-ink text-surface"
              : "border-line bg-surface text-ink hover:bg-surface-soft",
          )}
        >
          Alles anzeigen
        </button>
        <button
          type="button"
          onClick={() => canZoomOut && setZoomClamped(effZoom / ZOOM_STEP)}
          disabled={!canZoomOut}
          aria-label="Weniger Zoom"
          className="inline-flex size-6 items-center justify-center rounded-full border border-line bg-surface hover:bg-surface-soft disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Minus className="size-3" />
        </button>
        <input
          type="range"
          min={0}
          max={100}
          value={sliderPos}
          onChange={(e) =>
            setZoomClamped(
              MIN_ZOOM * Math.pow(MAX_ZOOM / MIN_ZOOM, Number(e.target.value) / 100),
            )
          }
          aria-label="Zoom-Stufe"
          title="Zoom (auch: Strg/Cmd + Mausrad über der Timeline)"
          className="w-28 accent-ink"
        />
        <button
          type="button"
          onClick={() => canZoomIn && setZoomClamped(effZoom * ZOOM_STEP)}
          disabled={!canZoomIn}
          aria-label="Mehr Zoom"
          className="inline-flex size-6 items-center justify-center rounded-full border border-line bg-surface hover:bg-surface-soft disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Plus className="size-3" />
        </button>
      </div>

      <div
        ref={containerRef}
        className={cn(
          "relative h-32 rounded-squircle-md bg-surface-soft border border-line overflow-x-auto overflow-y-hidden",
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
            <div ref={blocksWrapRef} className="absolute inset-2">
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
                  onRollPreview={applyRollPreview}
                  onRollCommit={commitRoll}
                  onMoveLeft={(id) => moveSegment(id, -1)}
                  onMoveRight={(id) => moveSegment(id, 1)}
                  onDuplicate={duplicateSegment}
                  duplicateDisabled={!canDuplicate}
                  onReorderStart={handleReorderStart}
                  reordering={reorderState?.id === seg.id}
                  msPerPx={msPerPx}
                  maxDurationMs={maxPerSegmentMs.get(seg.id)}
                />
              ))}
              {/* Insertion-Indikator während Drag-Reorder. */}
              {insertionLineLeftPx !== null && (
                <div
                  aria-hidden
                  className="absolute top-0 bottom-0 w-0.5 bg-brand shadow-brand z-30 pointer-events-none"
                  style={{ left: `${insertionLineLeftPx}px` }}
                />
              )}
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
    </div>
  );
}
