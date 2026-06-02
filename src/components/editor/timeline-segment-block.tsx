"use client";

import * as React from "react";
import {
  Type,
  Image as ImageIcon,
  Video,
  Globe,
  FileText,
  Sparkles,
  ChevronLeft,
  ChevronRight,
  GripVertical,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { Segment, SegmentKind } from "@/lib/segments/types";

/**
 * Visuelle Konfiguration pro Segment-Typ.
 *
 * Hintergrund-, Rand- und Textfarben sind bewusst über den ganzen Block
 * konsistent, damit der DAW-Look einheitlich wirkt.
 */
const KIND_STYLES: Record<
  SegmentKind,
  { bg: string; border: string; text: string; label: string; icon: React.ComponentType<{ className?: string }> }
> = {
  text: {
    bg: "bg-emerald-200",
    border: "border-emerald-300",
    text: "text-emerald-900",
    label: "Text",
    icon: Type,
  },
  image: {
    bg: "bg-violet-200",
    border: "border-violet-300",
    text: "text-violet-900",
    label: "Bild",
    icon: ImageIcon,
  },
  video: {
    bg: "bg-amber-200",
    border: "border-amber-300",
    text: "text-amber-900",
    label: "Video",
    icon: Video,
  },
  website: {
    bg: "bg-indigo-200",
    border: "border-indigo-300",
    text: "text-indigo-900",
    label: "Website",
    icon: Globe,
  },
  gdocs: {
    bg: "bg-blue-200",
    border: "border-blue-300",
    text: "text-blue-900",
    label: "Google Docs",
    icon: FileText,
  },
  slide: {
    bg: "bg-fuchsia-200",
    border: "border-fuchsia-300",
    text: "text-fuchsia-900",
    label: "Freie Folie",
    icon: Sparkles,
  },
};

export interface TimelineSegmentBlockProps {
  segment: Segment;
  /** Linke Position des Blocks (px, relativ zum Track-Container). */
  leftPx: number;
  /** Breite des Blocks (px). */
  widthPx: number;
  selected: boolean;
  /** Position innerhalb der Segment-Liste (für Reorder). */
  index: number;
  /** Anzahl Segmente insgesamt (für Reorder-Buttons). */
  total: number;
  onSelect: (id: string) => void;
  /** Wird kontinuierlich während des Trim-Drags gerufen (live preview). */
  onTrimPreview: (id: string, newDurationMs: number) => void;
  /** Wird beim mouseup gerufen, persistiert die finale Dauer. */
  onTrimCommit: (id: string, newDurationMs: number) => void;
  onMoveLeft: (id: string) => void;
  onMoveRight: (id: string) => void;
  /** ms pro Pixel - benötigt für Drag-Berechnung. */
  msPerPx: number;
  /**
   * Maximale erlaubte Dauer für dieses Segment (in ms). Berechnet sich aus
   * `webcamDurationMs - sum(other.durationMs)`. Wenn undefined, kein Limit.
   */
  maxDurationMs?: number;
}

const MIN_DURATION_MS = 200;
const SNAP_MS = 100;
/** Snap-Distanz zum Maximum: ab dieser Entfernung rastet die Trim-Geste ans Limit. */
const SNAP_TO_MAX_MS = 50;

export function TimelineSegmentBlock({
  segment,
  leftPx,
  widthPx,
  selected,
  index,
  total,
  onSelect,
  onTrimPreview,
  onTrimCommit,
  onMoveLeft,
  onMoveRight,
  msPerPx,
  maxDurationMs,
}: TimelineSegmentBlockProps) {
  const style = KIND_STYLES[segment.kind];
  const Icon = style.icon;

  // Drag-State: speichert die Start-Mauspos und Start-Dauer beim PointerDown.
  const dragRef = React.useRef<{ startX: number; startDuration: number } | null>(null);

  // Visuelles Limit-Feedback: flasht kurz auf, wenn beim Trim das Maximum
  // erreicht wird.
  const [atLimit, setAtLimit] = React.useState(false);
  const limitTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(() => {
    return () => {
      if (limitTimerRef.current) clearTimeout(limitTimerRef.current);
    };
  }, []);

  const hasMax =
    typeof maxDurationMs === "number" && Number.isFinite(maxDurationMs);

  function clampWithSnap(raw: number): { value: number; capped: boolean } {
    const snappedRaw = Math.round(raw / SNAP_MS) * SNAP_MS;
    let value = Math.max(MIN_DURATION_MS, snappedRaw);
    let capped = false;
    if (hasMax) {
      const max = maxDurationMs as number;
      // Snap-to-limit: wenn nur knapp unter dem Limit, ans Limit rasten.
      if (raw > max - SNAP_TO_MAX_MS) {
        value = Math.max(MIN_DURATION_MS, max);
        capped = true;
      } else if (value > max) {
        value = Math.max(MIN_DURATION_MS, max);
        capped = true;
      }
    }
    return { value, capped };
  }

  function flashLimit() {
    setAtLimit(true);
    if (limitTimerRef.current) clearTimeout(limitTimerRef.current);
    limitTimerRef.current = setTimeout(() => setAtLimit(false), 700);
  }

  function handleTrimPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    event.stopPropagation();
    event.preventDefault();
    (event.currentTarget as HTMLDivElement).setPointerCapture(event.pointerId);
    dragRef.current = {
      startX: event.clientX,
      startDuration: segment.durationMs,
    };
  }

  function handleTrimPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag) return;
    const deltaPx = event.clientX - drag.startX;
    const deltaMs = deltaPx * msPerPx;
    const raw = drag.startDuration + deltaMs;
    const { value, capped } = clampWithSnap(raw);
    if (capped) flashLimit();
    if (value !== segment.durationMs) {
      onTrimPreview(segment.id, value);
    }
  }

  function handleTrimPointerUp(event: React.PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag) return;
    try {
      (event.currentTarget as HTMLDivElement).releasePointerCapture(event.pointerId);
    } catch {
      // Pointer wurde evtl. schon implizit freigegeben - ignorieren.
    }
    const deltaPx = event.clientX - drag.startX;
    const deltaMs = deltaPx * msPerPx;
    const raw = drag.startDuration + deltaMs;
    const { value, capped } = clampWithSnap(raw);
    if (capped) flashLimit();
    dragRef.current = null;
    onTrimCommit(segment.id, value);
  }

  function handleBlockClick(event: React.MouseEvent<HTMLDivElement>) {
    // Klicks auf die Handles oder Buttons sollen nicht zu Select führen.
    if (event.defaultPrevented) return;
    onSelect(segment.id);
  }

  const durationSec = (segment.durationMs / 1000).toFixed(1);
  const displayLabel = segment.label?.trim() || style.label;
  // Compact-Modus: Wenn der Block sehr schmal ist, blenden wir Text aus.
  const compact = widthPx < 80;
  const veryCompact = widthPx < 44;

  return (
    <div
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      aria-label={`${style.label}: ${displayLabel}, ${durationSec} Sekunden`}
      onClick={handleBlockClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect(segment.id);
        }
      }}
      className={cn(
        "absolute top-0 bottom-0 flex items-center gap-1.5 px-2 cursor-pointer select-none transition-shadow",
        "rounded-squircle-sm border-2",
        style.bg,
        selected
          ? "ring-2 ring-brand ring-offset-1 ring-offset-surface-soft border-brand/40 z-10"
          : `${style.border} hover:brightness-105`,
        atLimit && "ring-2 ring-warn/70 ring-offset-1 ring-offset-surface-soft animate-pulse",
      )}
      style={{ left: `${leftPx}px`, width: `${widthPx}px` }}
    >
      {/* Reorder Drag-Handle (visuell links) - dient nur als Indikator. */}
      {!veryCompact && (
        <span className={cn("flex items-center justify-center shrink-0 text-ink-muted/70", style.text)} aria-hidden>
          <GripVertical className="size-3" />
        </span>
      )}

      <Icon className={cn("size-3.5 shrink-0", style.text)} aria-hidden />

      {!compact && (
        <span className={cn("flex-1 min-w-0 truncate text-xs font-semibold leading-none", style.text)}>
          {displayLabel}
          <span className={cn("ml-1.5 font-mono font-normal opacity-70", style.text)}>
            {durationSec}s
          </span>
        </span>
      )}

      {compact && !veryCompact && (
        <span className={cn("flex-1 text-[10px] font-mono leading-none", style.text)}>
          {durationSec}s
        </span>
      )}

      {/* Reorder Pfeil-Buttons (Fallback ohne dnd-kit). */}
      {!compact && (
        <div className="flex items-center gap-0.5 shrink-0">
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onMoveLeft(segment.id);
            }}
            disabled={index === 0}
            aria-label="Nach links verschieben"
            className={cn(
              "inline-flex size-5 items-center justify-center rounded-full transition-colors",
              "hover:bg-black/10 disabled:opacity-30 disabled:cursor-not-allowed",
              style.text,
            )}
          >
            <ChevronLeft className="size-3" />
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onMoveRight(segment.id);
            }}
            disabled={index === total - 1}
            aria-label="Nach rechts verschieben"
            className={cn(
              "inline-flex size-5 items-center justify-center rounded-full transition-colors",
              "hover:bg-black/10 disabled:opacity-30 disabled:cursor-not-allowed",
              style.text,
            )}
          >
            <ChevronRight className="size-3" />
          </button>
        </div>
      )}

      {/* Trim-Handles - links rein optisch, rechts funktional (ändert Dauer). */}
      <div
        aria-hidden
        className="absolute inset-y-1 left-0 w-1.5 rounded-full cursor-ew-resize hover:bg-brand/40 active:bg-brand"
      />
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Dauer durch Ziehen anpassen"
        onPointerDown={handleTrimPointerDown}
        onPointerMove={handleTrimPointerMove}
        onPointerUp={handleTrimPointerUp}
        onPointerCancel={handleTrimPointerUp}
        className={cn(
          "absolute inset-y-1 right-0 w-1.5 rounded-full cursor-ew-resize touch-none",
          atLimit
            ? "bg-warn shadow-[0_0_0_2px_rgba(0,0,0,0.05)]"
            : "hover:bg-brand/40 active:bg-brand",
        )}
      />
    </div>
  );
}
