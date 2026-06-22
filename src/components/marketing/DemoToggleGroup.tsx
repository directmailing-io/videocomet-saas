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
    subtitle: "Soll die Kunden-Webseite angezeigt werden?",
    icon: ImageIcon,
  },
  {
    value: "slides",
    label: "Folienpräsentation",
    subtitle: "Soll eine frei gestaltete Folie angezeigt werden?",
    icon: Presentation,
  },
  {
    value: "gdocs",
    label: "Google Docs",
    subtitle: "Soll ein Google-Docs-Dokument angezeigt werden?",
    icon: FileText,
  },
  {
    value: "solo",
    label: "Webcam-Solo",
    subtitle: "Soll nur dein Webcam-Video angezeigt werden?",
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
              "relative flex flex-col items-start gap-2 rounded-squircle-md border p-4 text-left transition-all backdrop-blur-md",
              "focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40",
              active
                ? "border-brand/60 bg-brand/[0.15] text-white ring-2 ring-brand/30"
                : "border-white/10 bg-white/[0.04] text-white hover:bg-white/[0.08] hover:border-white/20",
            )}
          >
            {active ? (
              <span className="absolute top-3 right-3 size-2 rounded-full bg-brand-light" />
            ) : null}
            <Icon
              className={cn(
                "size-5",
                active ? "text-brand-light" : "text-white/55",
              )}
              aria-hidden="true"
            />
            <div className="flex flex-col gap-0.5">
              <span
                className={cn(
                  "text-sm font-semibold",
                  active ? "text-white" : "text-white/90",
                )}
              >
                {option.label}
              </span>
              <span
                className={cn(
                  "text-xs",
                  active ? "text-white/70" : "text-white/50",
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
