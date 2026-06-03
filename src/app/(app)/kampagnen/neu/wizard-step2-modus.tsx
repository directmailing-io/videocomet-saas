"use client";

import * as React from "react";
import { Video, LayoutTemplate, Check, Info } from "lucide-react";
import { cn } from "@/lib/utils";

export type CampaignMode = "webcam-only" | "with-presentation";

export interface WizardStep2Props {
  value: CampaignMode;
  onChange: (mode: CampaignMode) => void;
}

const OPTIONS: {
  value: CampaignMode;
  title: string;
  description: string;
  /** Mini-Hinweis, was als nächstes passiert — verhindert „Editor öffnet sich aus dem Nichts". */
  nextStepHint: string;
  icon: React.ComponentType<{ className?: string }>;
}[] = [
  {
    value: "webcam-only",
    title: "Nur Webcam",
    description:
      "Dein Webcam-Video wird unverändert als Outreach-Video an alle Empfänger gesendet.",
    nextStepHint: "Nächster Schritt: Landingpage.",
    icon: Video,
  },
  {
    value: "with-presentation",
    title: "Mit Videopräsentation",
    description:
      "Du kombinierst dein Webcam-Video mit Folien, Websites, Bildern und weiteren Segmenten.",
    nextStepHint: "Nächster Schritt: Editor (Segmente bauen).",
    icon: LayoutTemplate,
  },
];

export function WizardStep2Modus({ value, onChange }: WizardStep2Props) {
  return (
    <div>
      <h2 className="text-lg font-semibold text-ink mb-1">Modus wählen</h2>
      <p className="text-sm text-ink-muted mb-6">
        Bestimme, wie deine Kampagne aufgebaut ist.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
        {OPTIONS.map((opt) => {
          const Icon = opt.icon;
          const active = opt.value === value;
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => onChange(opt.value)}
              className={cn(
                "text-left rounded-squircle-lg border bg-surface p-6 transition-all relative",
                active
                  ? "border-brand ring-2 ring-brand/30 shadow-card-hover"
                  : "border-line hover:border-brand/50 hover:shadow-card-hover",
              )}
            >
              {active && (
                <span className="absolute top-4 right-4 inline-flex size-6 items-center justify-center rounded-full bg-brand text-white">
                  <Check className="size-3.5" />
                </span>
              )}
              <span className="inline-flex size-12 items-center justify-center rounded-squircle-md bg-brand-soft text-brand-deep mb-4">
                <Icon className="size-6" />
              </span>
              <h3 className="text-base font-semibold text-ink mb-1.5">
                {opt.title}
              </h3>
              <p className="text-sm text-ink-muted leading-relaxed">
                {opt.description}
              </p>
              <p
                className={cn(
                  "mt-3 inline-flex items-center gap-1.5 text-[11px] font-medium",
                  active ? "text-brand-deep" : "text-ink-muted",
                )}
              >
                <Info className="size-3" />
                {opt.nextStepHint}
              </p>
            </button>
          );
        })}
      </div>
    </div>
  );
}
