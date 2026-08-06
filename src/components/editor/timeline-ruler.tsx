"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

export interface TimelineRulerProps {
  /** Gesamtdauer der Timeline in ms. */
  totalDurationMs: number;
  /** Anzeigebreite in Pixeln (entspricht totalDurationMs). */
  widthPx: number;
  /** Optionaler Klick-Handler zum Seeken. ms-Wert wird übergeben. */
  onSeek?: (timeMs: number) => void;
  /** Optionaler PointerDown-Handler zum Starten eines Drag-Seeks. */
  onSeekPointerDown?: (event: React.PointerEvent<HTMLDivElement>) => void;
  className?: string;
}

/**
 * Zeit-Achse mit Tick-Marks im DAW-Stil.
 *
 * - Sekunden-Ticks (mit Label)
 * - 100ms-Ticks (kleinere, unbeschriftete Striche)
 *
 * Bei sehr langen Timelines werden die 100ms-Ticks ausgedünnt, damit das
 * Layout nicht überladen wirkt.
 */
export function TimelineRuler({
  totalDurationMs,
  widthPx,
  onSeek,
  onSeekPointerDown,
  className,
}: TimelineRulerProps) {
  const safeTotalMs = Math.max(1, totalDurationMs);
  const safeWidth = Math.max(1, widthPx);
  const pxPerMs = safeWidth / safeTotalMs;

  const pxPerSec = pxPerMs * 1000;

  // Label-Abstand adaptiv wählen, damit sich Beschriftungen auch in der
  // rausgezoomten Fit-Ansicht (wenige px pro Sekunde) nie überlappen.
  const LABEL_STEPS_SEC = [1, 2, 5, 10, 15, 30, 60, 120, 300];
  const labelStepSec = LABEL_STEPS_SEC.find((s) => s * pxPerSec >= 48) ?? 600;
  const totalSeconds = Math.ceil(safeTotalMs / 1000);
  const majorTicks: { sec: number; left: number }[] = [];
  for (let s = 0; s <= totalSeconds; s += labelStepSec) {
    majorTicks.push({ sec: s, left: s * 1000 * pxPerMs });
  }

  // Minor-Ticks zwischen den Labels; ausgedünnt, sobald es unter 8px eng wird.
  const MINOR_STEPS_SEC = [0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60];
  const minorStepSec = MINOR_STEPS_SEC.find(
    (s) => s >= labelStepSec / 10 && s * pxPerSec >= 8,
  );
  const minorTicks: number[] = [];
  if (minorStepSec && minorStepSec < labelStepSec) {
    const stepMs = Math.round(minorStepSec * 1000);
    const labelMs = labelStepSec * 1000;
    for (let ms = 0; ms <= safeTotalMs; ms += stepMs) {
      // Label-Marken auslassen (die zeichnen wir größer).
      if (ms % labelMs === 0) continue;
      minorTicks.push(ms * pxPerMs);
    }
  }

  function handleClick(event: React.MouseEvent<HTMLDivElement>) {
    if (!onSeek) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const ratio = Math.min(1, Math.max(0, x / rect.width));
    onSeek(Math.round(ratio * safeTotalMs));
  }

  return (
    <div
      className={cn(
        "relative h-7 border-b border-line bg-surface-soft select-none",
        onSeek || onSeekPointerDown ? "cursor-pointer" : undefined,
        className,
      )}
      style={{ width: `${safeWidth}px` }}
      onClick={handleClick}
      onPointerDown={onSeekPointerDown}
      role={onSeek ? "slider" : undefined}
      aria-label={onSeek ? "Zeitleiste, klicken zum Springen" : undefined}
    >
      {minorTicks.map((left, idx) => (
        <span
          key={`minor-${idx}`}
          className="absolute bottom-0 w-px h-1.5 bg-line"
          style={{ left: `${left}px` }}
        />
      ))}
      {majorTicks.map((t) => (
        <React.Fragment key={`major-${t.sec}`}>
          <span
            className="absolute bottom-0 w-px h-3 bg-ink-muted/60"
            style={{ left: `${t.left}px` }}
          />
          <span
            className="absolute top-1 text-[10px] font-mono text-ink-muted leading-none"
            style={{
              left: `${t.left}px`,
              transform: t.sec === 0 ? "translateX(2px)" : "translateX(-50%)",
            }}
          >
            {formatSec(t.sec)}
          </span>
        </React.Fragment>
      ))}
    </div>
  );
}

function formatSec(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}
