"use client";

import * as React from "react";
import {
  Video,
  Layers,
  Check,
  AlertTriangle,
  Zap,
  DollarSign,
  Sparkles,
  Upload,
  Clock,
  ArrowRight,
} from "lucide-react";
import { cn } from "@/lib/utils";

export type CampaignMode = "webcam-only" | "with-presentation";

export interface WizardStep2Props {
  value: CampaignMode;
  onChange: (mode: CampaignMode) => void;
}

/**
 * Step 2 — Modus-Auswahl.
 *
 * Wir trennen die zwei Pfade über eine Karten-UI mit klaren Cost/Speed-Hints.
 * Default ist „webcam-only", weil das der billigere + schnellere Pfad ist
 * — wer den teureren Pfad will, soll bewusst hinklicken.
 *
 * Hints sind farbcodiert:
 *   - Brand-Deep = positiv (Pro)
 *   - Warn (amber) = Achtung, lies das (Cost/Speed-Tradeoff)
 *
 * Status-Hint unter den Cards spiegelt den aktiven Modus zurück, damit der
 * Nutzer ohne Scrollen sieht, was gerade aktiv ist.
 */

interface ModeHint {
  type: "pro" | "warn";
  icon: React.ComponentType<{ className?: string }>;
  text: string;
}

interface ModeOption {
  value: CampaignMode;
  title: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  hints: ModeHint[];
  /** Mini-Hinweis, was als nächstes passiert. */
  nextStepHint: string;
  /** Kompakte Zusammenfassung für den Status-Hint unter den Cards. */
  statusSummary: string;
}

const OPTIONS: ModeOption[] = [
  {
    value: "webcam-only",
    title: "Nur Webcam-Video",
    description:
      "Alle Leads sehen das gleiche Video — keine Personalisierung.",
    icon: Video,
    hints: [
      { type: "pro", icon: Upload, text: "1× Bunny-Upload pro Runde" },
      { type: "pro", icon: Zap, text: "Schnelle Generierung (Sekunden)" },
      { type: "pro", icon: DollarSign, text: "Günstig (keine Per-Lead-Kosten)" },
    ],
    nextStepHint: "Editor-Step wird übersprungen.",
    statusSummary: "Nur Webcam · 1× Upload pro Runde",
  },
  {
    value: "with-presentation",
    title: "Webcam + Videopräsentation",
    description:
      "Personalisierte Video-Komposition pro Lead — deine Webcam + Folien + Greenscreen.",
    icon: Layers,
    hints: [
      { type: "warn", icon: Upload, text: "1× Bunny-Upload pro Lead" },
      { type: "warn", icon: Clock, text: "Längere Render-Zeit (Minuten)" },
      { type: "pro", icon: Sparkles, text: "Maximale Personalisierung" },
    ],
    nextStepHint: "Editor-Step folgt.",
    statusSummary: "Webcam + Präsentation · 1× Upload pro Lead",
  },
];

export function WizardStep2Modus({ value, onChange }: WizardStep2Props) {
  const activeOption = OPTIONS.find((o) => o.value === value) ?? OPTIONS[0];

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
              aria-pressed={active}
              className={cn(
                "text-left rounded-squircle-lg border bg-surface p-6 transition-all relative flex flex-col",
                active
                  ? "border-brand ring-2 ring-brand/30 shadow-brand"
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
              <p className="text-sm text-ink-muted leading-relaxed mb-4">
                {opt.description}
              </p>

              <ul className="space-y-1.5 mb-4">
                {opt.hints.map((h, i) => {
                  const HintIcon = h.icon;
                  const isPro = h.type === "pro";
                  return (
                    <li
                      key={i}
                      className={cn(
                        "flex items-start gap-2 text-[12.5px] leading-relaxed",
                        isPro ? "text-ink" : "text-ink",
                      )}
                    >
                      <span
                        className={cn(
                          "inline-flex size-4 shrink-0 items-center justify-center rounded-full mt-0.5",
                          isPro
                            ? "bg-brand-soft text-brand-deep"
                            : "bg-warn-soft text-warn",
                        )}
                        aria-hidden
                      >
                        {isPro ? (
                          <Check className="size-2.5" />
                        ) : (
                          <AlertTriangle className="size-2.5" />
                        )}
                      </span>
                      <span className="flex items-center gap-1.5">
                        <HintIcon
                          className={cn(
                            "size-3 shrink-0",
                            isPro ? "text-brand-deep" : "text-warn",
                          )}
                        />
                        {h.text}
                      </span>
                    </li>
                  );
                })}
              </ul>

              <p
                className={cn(
                  "mt-auto inline-flex items-center gap-1.5 text-[11px] font-medium",
                  active ? "text-brand-deep" : "text-ink-muted",
                )}
              >
                <ArrowRight className="size-3" />
                {opt.nextStepHint}
              </p>
            </button>
          );
        })}
      </div>

      <p className="mt-4 text-xs text-ink-muted">
        Aktueller Modus:{" "}
        <span className="font-semibold text-ink">
          {activeOption.statusSummary}
        </span>
      </p>
    </div>
  );
}
