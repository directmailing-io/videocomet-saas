"use client";

import * as React from "react";
import { ChevronDown, SlidersHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";

interface AdvancedSettingsProps {
  /** Kurzer Hinweis, was sich hinter „Erweitert" verbirgt (z. B. „Trimmen, Seitenverhältnis"). */
  hint?: string;
  children: React.ReactNode;
  className?: string;
}

/**
 * Einklappbarer Bereich für selten benötigte Einstellungen. Der Inhalt bleibt
 * IMMER gemountet (nur via `hidden` versteckt), damit lokale Draft-States
 * (z. B. Video-Trim-Eingaben) beim Auf-/Zuklappen nicht verloren gehen.
 */
export function AdvancedSettings({
  hint,
  children,
  className,
}: AdvancedSettingsProps) {
  const [open, setOpen] = React.useState(false);

  return (
    <div
      className={cn(
        "rounded-squircle-md border border-line bg-surface",
        className,
      )}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-soft rounded-squircle-md"
      >
        <span className="flex size-8 shrink-0 items-center justify-center rounded-squircle-sm bg-surface-soft text-ink-muted">
          <SlidersHorizontal className="size-4" />
        </span>
        <span className="flex-1">
          <span className="block text-sm font-semibold text-ink">
            Erweiterte Einstellungen
          </span>
          {hint && !open && (
            <span className="block text-xs text-ink-muted">{hint}</span>
          )}
        </span>
        <ChevronDown
          className={cn(
            "size-4 shrink-0 text-ink-muted transition-transform",
            open && "rotate-180",
          )}
        />
      </button>
      <div hidden={!open} className="border-t border-line px-4 py-4">
        {children}
      </div>
    </div>
  );
}
