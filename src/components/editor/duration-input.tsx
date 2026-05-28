"use client";

import * as React from "react";
import { Minus, Plus } from "lucide-react";
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
  className?: string;
}

const MIN_MS = 200;

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
  className,
}: DurationInputProps) {
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState<string>(formatMs(valueMs));
  const inputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (!editing) {
      setDraft(formatMs(valueMs));
    }
  }, [valueMs, editing]);

  const clamp = React.useCallback(
    (raw: number): number => {
      let next = Math.max(MIN_MS, raw);
      if (maxMs !== undefined && maxMs !== null) {
        next = Math.min(maxMs, next);
      }
      return next;
    },
    [maxMs],
  );

  const bump = (delta: number) => {
    onChange(clamp(valueMs + delta));
  };

  const commitDraft = () => {
    const parsed = parseInput(draft);
    if (parsed === null) {
      setDraft(formatMs(valueMs));
      setEditing(false);
      return;
    }
    onChange(clamp(parsed));
    setEditing(false);
  };

  return (
    <div className={cn("flex items-center gap-2", className)}>
      <div className="flex items-center gap-1">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => bump(-1000)}
          aria-label="Minus 1 Sekunde"
          className="px-2.5"
        >
          <Minus className="size-3.5" />
          <span className="text-[11px] font-semibold">1s</span>
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => bump(-stepMs)}
          aria-label={`Minus ${stepMs} Millisekunden`}
          className="px-2.5"
        >
          <Minus className="size-3.5" />
          <span className="text-[11px] font-semibold">{stepMs}ms</span>
        </Button>
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
          className="rounded-squircle-sm border border-line bg-surface px-4 py-2 font-mono text-base font-semibold text-ink min-w-[7.5rem] text-center hover:border-brand transition-colors"
          aria-label="Dauer direkt eingeben"
        >
          {formatMs(valueMs)}
        </button>
      )}

      <div className="flex items-center gap-1">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => bump(stepMs)}
          aria-label={`Plus ${stepMs} Millisekunden`}
          className="px-2.5"
        >
          <Plus className="size-3.5" />
          <span className="text-[11px] font-semibold">{stepMs}ms</span>
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => bump(1000)}
          aria-label="Plus 1 Sekunde"
          className="px-2.5"
        >
          <Plus className="size-3.5" />
          <span className="text-[11px] font-semibold">1s</span>
        </Button>
      </div>
    </div>
  );
}
