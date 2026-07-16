"use client";

import * as React from "react";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

export type AbSplitMode = "random" | "sequential";

const AB_PRESETS = [50, 60, 70, 80, 40, 30, 20];

export interface AbSplitPickerProps {
  mode: AbSplitMode;
  weightA: number;
  onModeChange: (mode: AbSplitMode) => void;
  onWeightChange: (weightA: number) => void;
  /**
   * Optionale Vorschau-Zeile unter den Presets (z. B. konkrete Lead-Zahlen
   * im Runden-Wizard). Ohne Angabe wird eine generische Prozent-Zeile
   * angezeigt.
   */
  previewLine?: React.ReactNode;
  disabled?: boolean;
}

/**
 * Verteilungs-Regel des Brief-A/B-Tests: Modus (zufällig / der Reihe nach)
 * plus Gewichtung. Wird identisch im Kampagnen-Wizard, in den
 * Kampagnen-Einstellungen und im Runden-Wizard verwendet, damit der User
 * überall dasselbe Bild sieht.
 */
export function AbSplitPicker({
  mode,
  weightA,
  onModeChange,
  onWeightChange,
  previewLine,
  disabled,
}: AbSplitPickerProps) {
  return (
    <div className={cn("space-y-5", disabled && "opacity-60")}>
      <div>
        <Label>Verteilungs-Modus</Label>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <button
            type="button"
            disabled={disabled}
            onClick={() => onModeChange("random")}
            className={cn(
              "flex flex-col items-start gap-1 rounded-squircle-md border p-4 text-left transition-colors",
              mode === "random"
                ? "border-brand bg-brand-soft"
                : "border-line hover:border-line",
            )}
          >
            <span className="text-sm font-semibold text-ink">Zufällig</span>
            <span className="text-xs text-ink-muted">
              Leads werden zufällig gemischt und nach Gewichtung aufgeteilt —
              fairster Vergleich.
            </span>
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={() => onModeChange("sequential")}
            className={cn(
              "flex flex-col items-start gap-1 rounded-squircle-md border p-4 text-left transition-colors",
              mode === "sequential"
                ? "border-brand bg-brand-soft"
                : "border-line hover:border-line",
            )}
          >
            <span className="text-sm font-semibold text-ink">
              Der Reihe nach
            </span>
            <span className="text-xs text-ink-muted">
              Die ersten {weightA} % der Liste bekommen Brief A, der Rest
              Brief B.
            </span>
          </button>
        </div>
      </div>
      <div>
        <Label>Gewichtung (Brief A / Brief B)</Label>
        <div className="flex flex-wrap gap-2">
          {AB_PRESETS.map((w) => (
            <button
              key={w}
              type="button"
              disabled={disabled}
              onClick={() => onWeightChange(w)}
              className={cn(
                "rounded-full border px-3.5 py-1.5 text-sm font-semibold transition-colors tabular-nums",
                weightA === w
                  ? "border-brand bg-brand text-white"
                  : "border-line text-ink hover:border-brand hover:text-brand-deep",
              )}
            >
              {w}/{100 - w}
            </button>
          ))}
        </div>
      </div>
      <p className="rounded-squircle-sm bg-brand-soft/40 border border-brand-soft px-3 py-2 text-sm text-ink">
        {previewLine ?? (
          <>
            <strong>{weightA} %</strong> der Leads → Brief A ·{" "}
            <strong>{100 - weightA} %</strong> → Brief B
          </>
        )}
      </p>
    </div>
  );
}
