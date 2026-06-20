"use client";

import * as React from "react";
import {
  FileText,
  Image as ImageIcon,
  Presentation,
  Video as VideoIcon,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { DemoMode } from "./DemoPlayer";

type DemoToggleOption = {
  value: DemoMode;
  label: string;
  subtitle: string;
  icon: LucideIcon;
};

const OPTIONS: ReadonlyArray<DemoToggleOption> = [
  {
    value: "screenshot",
    label: "Website-Screenshot",
    subtitle: "Webseite des Kunden im Hintergrund",
    icon: ImageIcon,
  },
  {
    value: "slides",
    label: "Folienpräsentation",
    subtitle: "Slide-Deck mit Animationen",
    icon: Presentation,
  },
  {
    value: "gdocs",
    label: "Google Docs",
    subtitle: "Persönliche Notiz im Doc",
    icon: FileText,
  },
  {
    value: "solo",
    label: "Webcam-Solo",
    subtitle: "Nur dein Webcam-Video, fullscreen",
    icon: VideoIcon,
  },
];

export type DemoToggleGroupProps = {
  value: DemoMode;
  onChange: (mode: DemoMode) => void;
};

export function DemoToggleGroup({ value, onChange }: DemoToggleGroupProps) {
  return (
    <div
      role="radiogroup"
      aria-label="Demo-Modus auswählen"
      className="grid grid-cols-2 md:grid-cols-4 gap-3"
    >
      {OPTIONS.map((option) => {
        const Icon = option.icon;
        const active = value === option.value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(option.value)}
            className={cn(
              "relative flex flex-col items-start gap-2 rounded-squircle-md border p-4 text-left transition-all",
              "focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40",
              active
                ? "border-brand bg-brand-soft text-brand-deep ring-2 ring-brand/30"
                : "border-line bg-surface hover:bg-surface-muted hover:border-brand/40",
            )}
          >
            {active ? (
              <span className="absolute top-3 right-3 size-2 rounded-full bg-brand" />
            ) : null}
            <Icon
              className={cn(
                "size-5",
                active ? "text-brand-deep" : "text-ink-soft",
              )}
              aria-hidden="true"
            />
            <div className="flex flex-col gap-0.5">
              <span
                className={cn(
                  "text-sm font-semibold",
                  active ? "text-brand-deep" : "text-ink",
                )}
              >
                {option.label}
              </span>
              <span
                className={cn(
                  "text-xs",
                  active ? "text-brand-deep/70" : "text-ink-muted",
                )}
              >
                {option.subtitle}
              </span>
            </div>
          </button>
        );
      })}
    </div>
  );
}
