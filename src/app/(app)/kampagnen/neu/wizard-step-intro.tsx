"use client";

import * as React from "react";
import Link from "next/link";
import { Check, Info, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

export interface WizardStepIntroProps {
  enabled: boolean;
  onChange: (enabled: boolean) => void;
}

interface VoiceProfileDto {
  status: "pending_sample" | "processing" | "ready" | "failed";
}

/** Mini-Mockup: Vollbild-Video ohne Personalisierung. */
function VisualPlain() {
  return (
    <div className="relative aspect-video w-full overflow-hidden rounded-squircle-sm bg-ink">
      <div className="absolute left-1/2 top-[30%] size-[22%] -translate-x-1/2 rounded-full bg-white/30" />
      <div className="absolute left-1/2 top-[58%] h-[55%] w-[42%] -translate-x-1/2 rounded-t-full bg-white/30" />
    </div>
  );
}

/** Mini-Mockup: gleiche Bühne, aber mit „Hi Jürgen!"-Sprechblase. */
function VisualPersonalized() {
  return (
    <div className="relative aspect-video w-full overflow-hidden rounded-squircle-sm bg-ink">
      <div className="absolute left-1/2 top-[30%] size-[22%] -translate-x-1/2 rounded-full bg-white/30" />
      <div className="absolute left-1/2 top-[58%] h-[55%] w-[42%] -translate-x-1/2 rounded-t-full bg-white/30" />
      <div className="absolute right-[8%] top-[14%] rounded-full bg-brand px-3 py-1.5 text-[11px] font-semibold text-white shadow-card">
        „Hi Jürgen!"
      </div>
    </div>
  );
}

/**
 * Wizard-Schritt "KI-Begrüßung" — Opt-in für die personalisierte
 * Video-Begrüßung direkt bei der Kampagnen-Erstellung.
 *
 * Der Schritt trifft nur die Kampagnen-Entscheidung (intro_enabled).
 * Stimm-Klon (einmalig, unter Setup → KI-Begrüßung) und die Video-
 * Kalibrierung laufen danach; die Kalibrierung wird beim Speichern der
 * Kampagne automatisch angestoßen. Ohne fertige Stimme rendern Videos
 * ganz normal ohne Begrüßung (1 Credit).
 */
export function WizardStepIntro({ enabled, onChange }: WizardStepIntroProps) {
  const [voiceStatus, setVoiceStatus] = React.useState<
    "loading" | "none" | "processing" | "ready"
  >("loading");

  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/voice-profile", { cache: "no-store" });
        if (!res.ok) throw new Error();
        const data = (await res.json()) as { profile: VoiceProfileDto | null };
        if (cancelled) return;
        if (data.profile?.status === "ready") setVoiceStatus("ready");
        else if (data.profile?.status === "processing")
          setVoiceStatus("processing");
        else setVoiceStatus("none");
      } catch {
        if (!cancelled) setVoiceStatus("none");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const options = [
    {
      value: false,
      title: "Ohne KI-Begrüßung",
      description: "Alle Leads sehen dein Video so, wie du es aufgenommen hast.",
      costHint: "1 Credit pro Video",
      visual: <VisualPlain />,
    },
    {
      value: true,
      title: "Mit persönlicher KI-Begrüßung",
      description:
        "Der erste Satz wird pro Lead mit Vornamen gesprochen, in deiner Stimme und mit passenden Lippenbewegungen.",
      costHint: "2 Credits pro Video",
      visual: <VisualPersonalized />,
    },
  ] as const;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
        {options.map((opt) => {
          const active = opt.value === enabled;
          return (
            <button
              key={String(opt.value)}
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
              <span className="flex items-center gap-2 text-base font-semibold text-ink mb-1.5">
                {opt.value && <Sparkles className="size-4 text-brand" />}
                {opt.title}
              </span>
              <span className="text-sm text-ink-muted leading-relaxed">
                {opt.description}
              </span>
              <span className="mt-auto pt-4 text-xs font-medium text-ink-soft">
                {opt.costHint}
              </span>
            </button>
          );
        })}
      </div>

      {enabled && (
        <div className="rounded-squircle-lg bg-surface shadow-card p-5 space-y-3">
          <p className="flex items-start gap-2.5 text-sm text-ink-muted leading-relaxed">
            <Info className="size-4 shrink-0 mt-0.5 text-ink-soft" />
            <span>
              Die KI-Begrüßung kostet <strong className="text-ink">2 Credits pro Video</strong>{" "}
              statt 1. Das Ergebnis ist KI-generiert und kann in Einzelfällen
              vom Original abweichen, eine perfekte Begrüßung ist nicht
              garantiert. Bei nicht nutzbarem Vornamen wird automatisch dein
              Original-Video verwendet und nur 1 Credit berechnet.
            </span>
          </p>
          <p className="flex items-start gap-2.5 text-sm text-ink-muted leading-relaxed">
            <Check className="size-4 shrink-0 mt-0.5 text-ok" />
            <span>
              Vor jeder Vollproduktion bekommst du eine{" "}
              <strong className="text-ink">Testrunde mit 3 Beispielvideos</strong>{" "}
              zur Freigabe. Erst wenn du die Qualität bestätigst, werden alle
              Videos erzeugt.
            </span>
          </p>
          {voiceStatus === "none" && (
            <p className="flex items-start gap-2.5 rounded-squircle-sm bg-surface-soft px-4 py-3 text-sm text-ink-muted leading-relaxed">
              <Sparkles className="size-4 shrink-0 mt-0.5 text-brand" />
              <span>
                Du hast noch keine KI-Stimme. Richte sie nach dem Erstellen
                einmalig unter{" "}
                <Link
                  href="/ki-begruessung"
                  target="_blank"
                  className="font-medium text-ink underline underline-offset-2"
                >
                  Setup → KI-Begrüßung
                </Link>{" "}
                ein. Bis dahin werden Videos ohne Begrüßung erzeugt (1 Credit).
              </span>
            </p>
          )}
          {voiceStatus === "processing" && (
            <p className="flex items-start gap-2.5 rounded-squircle-sm bg-brand-soft px-4 py-3 text-sm text-brand-deep leading-relaxed">
              <Sparkles className="size-4 shrink-0 mt-0.5" />
              <span>
                Deine KI-Stimme wird gerade trainiert — das dauert nur wenige
                Minuten und läuft im Hintergrund weiter.
              </span>
            </p>
          )}
        </div>
      )}
    </div>
  );
}
