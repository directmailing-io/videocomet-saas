"use client";

import * as React from "react";
import { Video, Layers, Check } from "lucide-react";
import { cn } from "@/lib/utils";

export type CampaignMode = "webcam-only" | "with-presentation";

export interface WizardStep2Props {
  value: CampaignMode;
  onChange: (mode: CampaignMode) => void;
}

/**
 * Step 2 — Modus-Auswahl.
 *
 * Fokus-Flow: Der Container rendert die Seiten-Headline, hier stehen nur
 * die zwei gleichwertigen Auswahl-Karten. Default ist „webcam-only", weil
 * das der billigere + schnellere Pfad ist — wer den teureren Pfad will,
 * soll bewusst hinklicken.
 */

interface ModeOption {
  value: CampaignMode;
  title: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
}

const OPTIONS: ModeOption[] = [
  {
    value: "webcam-only",
    title: "Nur Webcam-Video",
    description:
      "Alle Leads sehen das gleiche Video — keine Personalisierung.",
    icon: Video,
  },
  {
    value: "with-presentation",
    title: "Webcam + Videopräsentation",
    description:
      "Personalisierte Video-Komposition pro Lead — deine Webcam + Folien + Greenscreen.",
    icon: Layers,
  },
];

export function WizardStep2Modus({ value, onChange }: WizardStep2Props) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
      {OPTIONS.map((opt) => {
        const Icon = opt.icon;
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            aria-pressed={active}
            className={cn(
              "relative flex flex-col text-left rounded-squircle-lg bg-surface shadow-card p-7 transition-all duration-200 ease-spring",
              active
                ? "ring-2 ring-brand"
                : "hover:shadow-card-hover hover:-translate-y-0.5",
            )}
          >
            {active && (
              <span className="absolute top-5 right-5 inline-flex size-6 items-center justify-center rounded-full bg-brand text-white">
                <Check className="size-3.5" />
              </span>
            )}
            <span className="inline-flex size-11 items-center justify-center rounded-squircle-sm bg-brand-soft text-brand-deep mb-5">
              <Icon className="size-5" />
            </span>
            <span className="text-base font-semibold text-ink mb-1.5">
              {opt.title}
            </span>
            <span className="text-sm text-ink-muted leading-relaxed">
              {opt.description}
            </span>
          </button>
        );
      })}
    </div>
  );
}
