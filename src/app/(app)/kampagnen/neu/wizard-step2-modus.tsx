"use client";

import * as React from "react";
import { Check, Clock } from "lucide-react";
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
  timeHint: string;
  visual: React.ReactNode;
}

/** Mini-Mockup: ein Vollbild-Video (dunkle Bühne, Person mittig). */
function VisualFullscreen() {
  return (
    <div className="relative aspect-video w-full overflow-hidden rounded-squircle-sm bg-ink">
      <div className="absolute left-1/2 top-[30%] size-[22%] -translate-x-1/2 rounded-full bg-white/30" />
      <div className="absolute left-1/2 top-[58%] h-[55%] w-[42%] -translate-x-1/2 rounded-t-full bg-white/30" />
      <div className="absolute bottom-2 left-2 right-2 h-1 rounded-full bg-white/15">
        <div className="h-full w-1/3 rounded-full bg-white/50" />
      </div>
    </div>
  );
}

/** Mini-Mockup: Präsentation mit Webcam-Bubble unten links (Loom-Stil). */
function VisualPresentation() {
  return (
    <div className="relative aspect-video w-full overflow-hidden rounded-squircle-sm bg-canvas-deep">
      <div className="absolute left-[8%] top-[12%] h-[9%] w-[46%] rounded-full bg-ink/15" />
      <div className="absolute left-[8%] top-[30%] h-[6%] w-[70%] rounded-full bg-ink/10" />
      <div className="absolute left-[8%] top-[42%] h-[6%] w-[60%] rounded-full bg-ink/10" />
      <div className="absolute right-[8%] top-[14%] h-[38%] w-[24%] rounded-md bg-brand/25" />
      <div className="absolute bottom-[8%] left-[6%] size-[30%] overflow-hidden rounded-full bg-ink">
        <div className="absolute left-1/2 top-[26%] size-[26%] -translate-x-1/2 rounded-full bg-white/35" />
        <div className="absolute left-1/2 top-[56%] h-[50%] w-[52%] -translate-x-1/2 rounded-t-full bg-white/35" />
      </div>
    </div>
  );
}

const OPTIONS: ModeOption[] = [
  {
    value: "webcam-only",
    title: "Nur Webcam-Video",
    description:
      "Alle Leads sehen das gleiche Video — keine Personalisierung.",
    timeHint: "Ein Video für alle — Kampagne ist sofort startklar.",
    visual: <VisualFullscreen />,
  },
  {
    value: "with-presentation",
    title: "Webcam + Videopräsentation",
    description:
      "Personalisierte Video-Komposition pro Lead — deine Webcam + Folien + Greenscreen.",
    timeHint:
      "Pro Lead wird ein eigenes Video gerendert — je nach Videolänge ca. 1–3 Min. pro Video.",
    visual: <VisualPresentation />,
  },
];

export function WizardStep2Modus({ value, onChange }: WizardStep2Props) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
      {OPTIONS.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            aria-pressed={active}
            className={cn(
              "relative flex flex-col text-left rounded-squircle-lg bg-surface shadow-card p-6 transition-all duration-200 ease-spring",
              active
                ? "ring-2 ring-brand"
                : "hover:shadow-card-hover hover:-translate-y-0.5",
            )}
          >
            {active && (
              <span className="absolute top-4 right-4 z-10 inline-flex size-6 items-center justify-center rounded-full bg-brand text-white">
                <Check className="size-3.5" />
              </span>
            )}
            <div className="mb-5">{opt.visual}</div>
            <span className="text-base font-semibold text-ink mb-1.5">
              {opt.title}
            </span>
            <span className="text-sm text-ink-muted leading-relaxed">
              {opt.description}
            </span>
            <span className="mt-auto flex items-center gap-1.5 pt-4 text-xs text-ink-muted">
              <Clock className="size-3.5 shrink-0" />
              {opt.timeHint}
            </span>
          </button>
        );
      })}
    </div>
  );
}
