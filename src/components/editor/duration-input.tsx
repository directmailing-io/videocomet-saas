"use client";

import * as React from "react";
import { Minus, Plus, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export interface DurationInputProps {
  valueMs: number;
  onChange: (ms: number) => void;
  /** Optionales Maximum, z.B. wenn die Webcam-Dauer bekannt ist. */
  maxMs?: number;
  /** Snap-Wert. Default 100ms. */
  stepMs?: number;
  /**
   * Kompakte Variante fürs schmale Inspector-Panel: nur ±1s-Buttons,
   * kleineres Wertfeld. Feinjustierung weiter per Direkteingabe möglich.
   */
  compact?: boolean;
  className?: string;
}

const MIN_MS = 200;
const WARN_FLASH_MS = 2200;

function formatMs(ms: number): string {
  const safe = Math.max(0, Math.floor(ms));
  const totalSeconds = Math.floor(safe / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const millis = safe % 1000;
  return `${minutes}:${seconds.toString().padStart(2, "0")}.${millis
    .toString()
    .padStart(3, "0")}`;
}

function parseInput(input: string): number | null {
  // Accept formats:  "mm:ss.mmm" | "ss.mmm" | "1234" (ms) | "1.234" seconds
  const trimmed = input.trim();
  if (!trimmed) return null;

  const colonMatch = trimmed.match(/^(\d+):(\d{1,2})(?:\.(\d{1,3}))?$/);
  if (colonMatch) {
    const mm = parseInt(colonMatch[1], 10);
    const ss = parseInt(colonMatch[2], 10);
    const msStr = colonMatch[3] ?? "0";
    const ms = parseInt(msStr.padEnd(3, "0"), 10);
    return mm * 60_000 + ss * 1000 + ms;
  }
  const dotMatch = trimmed.match(/^(\d+)(?:\.(\d{1,3}))?$/);
  if (dotMatch) {
    const whole = parseInt(dotMatch[1], 10);
    const fracStr = dotMatch[2];
    if (fracStr !== undefined) {
      // Treat as seconds.fraction
      const frac = parseInt(fracStr.padEnd(3, "0"), 10);
      return whole * 1000 + frac;
    }
    // No decimal: treat plain integer as raw ms.
    return whole;
  }
  return null;
}

export function DurationInput({
  valueMs,
  onChange,
  maxMs,
  stepMs = 100,
  compact = false,
  className,
}: DurationInputProps) {
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState<string>(formatMs(valueMs));
  const [warning, setWarning] = React.useState<string | null>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const warnTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(() => {
    if (!editing) {
      setDraft(formatMs(valueMs));
    }
  }, [valueMs, editing]);

  React.useEffect(() => {
    return () => {
      if (warnTimerRef.current) clearTimeout(warnTimerRef.current);
    };
  }, []);

  const hasMax = typeof maxMs === "number" && Number.isFinite(maxMs);
  const atMax = hasMax ? valueMs >= (maxMs as number) : false;
  const atMin = valueMs <= MIN_MS;

  const flashWarning = React.useCallback((msg: string) => {
    setWarning(msg);
    if (warnTimerRef.current) clearTimeout(warnTimerRef.current);
    warnTimerRef.current = setTimeout(() => setWarning(null), WARN_FLASH_MS);
  }, []);

  const clamp = React.useCallback(
    (raw: number): { value: number; capped: boolean; floor: boolean } => {
      let next = raw;
      let capped = false;
      let floor = false;
      if (hasMax && next > (maxMs as number)) {
        next = maxMs as number;
        capped = true;
      }
      if (next < MIN_MS) {
        next = MIN_MS;
        floor = true;
      }
      return { value: next, capped, floor };
    },
    [maxMs, hasMax],
  );

  const bump = (delta: number) => {
    const target = valueMs + delta;
    const { value, capped, floor } = clamp(target);
    if (capped && delta > 0) {
      flashWarning("Limit erreicht — Webcam-Dauer ist voll ausgenutzt.");
    } else if (floor && delta < 0) {
      flashWarning("Mindestens 0:00.200 pro Segment.");
    } else {
      setWarning(null);
    }
    if (value !== valueMs) onChange(value);
  };

  const commitDraft = () => {
    const parsed = parseInput(draft);
    if (parsed === null) {
      setDraft(formatMs(valueMs));
      setEditing(false);
      return;
    }
    const { value, capped, floor } = clamp(parsed);
    if (capped) {
      flashWarning(
        `Auf maximale Dauer ${formatMs(maxMs as number)} begrenzt.`,
      );
    } else if (floor) {
      flashWarning("Mindestens 0:00.200 pro Segment.");
    } else {
      setWarning(null);
    }
    onChange(value);
    setEditing(false);
  };

  // Buttons disablen, wenn der Sprung das Limit überschreitet.
  const plusStepDisabled = hasMax && valueMs + stepMs > (maxMs as number);
  const plusSecDisabled = hasMax && valueMs + 1000 > (maxMs as number);
  const plusStepReallyDisabled = atMax || plusStepDisabled;
  const plusSecReallyDisabled = atMax || plusSecDisabled;
  const minusStepDisabled = atMin;
  const minusSecDisabled = atMin;

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => bump(-1000)}
            aria-label="Minus 1 Sekunde"
            className="px-2.5"
            disabled={minusSecDisabled}
          >
            <Minus className="size-3.5" />
            <span className="text-[11px] font-semibold">1s</span>
          </Button>
          {!compact && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => bump(-stepMs)}
              aria-label={`Minus ${stepMs} Millisekunden`}
              className="px-2.5"
              disabled={minusStepDisabled}
            >
              <Minus className="size-3.5" />
              <span className="text-[11px] font-semibold">{stepMs}ms</span>
            </Button>
          )}
        </div>

        {editing ? (
          <Input
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitDraft}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commitDraft();
              } else if (e.key === "Escape") {
                setDraft(formatMs(valueMs));
                setEditing(false);
              }
            }}
            autoFocus
            className="w-32 text-center font-mono text-base font-semibold h-10"
          />
        ) : (
          <button
            type="button"
            onClick={() => {
              setDraft(formatMs(valueMs));
              setEditing(true);
              // Defer focus to after render
              setTimeout(() => inputRef.current?.select(), 0);
            }}
            className={cn(
              "rounded-squircle-sm border bg-surface text-center font-mono font-semibold text-ink transition-colors hover:border-brand",
              compact
                ? "min-w-[6rem] px-3 py-1.5 text-sm"
                : "min-w-[7.5rem] px-4 py-2 text-base",
              atMax ? "border-warn/60" : "border-line",
            )}
            aria-label="Dauer direkt eingeben"
            title={atMax ? "Maximale Dauer erreicht" : undefined}
          >
            {formatMs(valueMs)}
          </button>
        )}

        <div className="flex items-center gap-1">
          {!compact && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => bump(stepMs)}
              aria-label={`Plus ${stepMs} Millisekunden`}
              className="px-2.5"
              disabled={plusStepReallyDisabled}
              title={
                plusStepReallyDisabled
                  ? "Webcam-Dauer voll ausgenutzt"
                  : undefined
              }
            >
              <Plus className="size-3.5" />
              <span className="text-[11px] font-semibold">{stepMs}ms</span>
            </Button>
          )}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => bump(1000)}
            aria-label="Plus 1 Sekunde"
            className="px-2.5"
            disabled={plusSecReallyDisabled}
            title={
              plusSecReallyDisabled
                ? "Webcam-Dauer voll ausgenutzt"
                : undefined
            }
          >
            <Plus className="size-3.5" />
            <span className="text-[11px] font-semibold">1s</span>
          </Button>
        </div>
      </div>

      {warning && (
        <div className="flex items-center gap-1.5 text-[11px] text-warn font-medium">
          <AlertTriangle className="size-3" />
          <span>{warning}</span>
        </div>
      )}
    </div>
  );
}
