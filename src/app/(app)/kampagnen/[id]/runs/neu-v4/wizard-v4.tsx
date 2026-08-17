"use client";

/**
 * VIDEOCOMET Runden-Wizard v4.
 *
 * Fünf klare Schritte, jeder Screen beantwortet eine Frage:
 *   1. Woher kommen die Kontakte?
 *   2. Kontakte rein (Import + Spalten-Mapping + Duplikat-Check)
 *   3. Optionen (Umschlag / E-Mail / Preflight)
 *   4. Platzhalter → Kontakt-Eigenschaft
 *   5. Zusammenfassung + Start
 *
 * State-Management: einzelner Reducer in wizard-v4.tsx. Kein Feld-Chaos,
 * keine drei Mapping-Welten parallel.
 */

import * as React from "react";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/ui/page-header";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { STEP_LABELS, STEP_ORDER, makeInitialState, type Step, type WizardState } from "./types";
import { Step1Source } from "./step-1-source";
import { Step2Import } from "./step-2-import";
import { Step3Options } from "./step-3-options";
import { Step4Mapping } from "./step-4-mapping";
import { Step5Start } from "./step-5-start";

interface WizardV4Props {
  campaignId: string;
  campaignName: string;
  campaignMode: "webcam-only" | "with-presentation";
  pdfEnabled: boolean;
}

export function WizardV4({
  campaignId,
  campaignName,
  campaignMode,
  pdfEnabled,
}: WizardV4Props) {
  const router = useRouter();
  const [state, setState] = React.useState<WizardState>(makeInitialState);

  function go(step: Step) {
    setState((s) => ({ ...s, step }));
  }
  function patch(update: Partial<WizardState>) {
    setState((s) => ({ ...s, ...update }));
  }

  const currentIdx = STEP_ORDER.indexOf(state.step);

  return (
    <>
      <PageHeader
        title="Neue Runde"
        subtitle={`Kampagne ${campaignName} · Schritt ${currentIdx + 1} von ${STEP_ORDER.length}: ${STEP_LABELS[state.step]}`}
      />

      <StepsNav current={state.step} onJump={go} />

      <div className="mt-4">
        {state.step === "source" && (
          <Step1Source
            state={state}
            patch={patch}
            campaignId={campaignId}
            onNext={() => go(state.source === "existing-list" ? "options" : "import")}
          />
        )}
        {state.step === "import" && (
          <Step2Import
            state={state}
            patch={patch}
            onBack={() => go("source")}
            onNext={() => go("options")}
          />
        )}
        {state.step === "options" && (
          <Step3Options
            state={state}
            patch={patch}
            campaignMode={campaignMode}
            pdfEnabled={pdfEnabled}
            onBack={() => go(state.source === "existing-list" ? "source" : "import")}
            onNext={() => go("mapping")}
          />
        )}
        {state.step === "mapping" && (
          <Step4Mapping
            state={state}
            patch={patch}
            campaignId={campaignId}
            onBack={() => go("options")}
            onNext={() => go("start")}
          />
        )}
        {state.step === "start" && (
          <Step5Start
            state={state}
            patch={patch}
            campaignId={campaignId}
            campaignMode={campaignMode}
            onBack={() => go("mapping")}
            onStarted={(runId) => router.push(`/kampagnen/${campaignId}/runs/${runId}`)}
          />
        )}
      </div>
    </>
  );
}

function StepsNav({ current, onJump }: { current: Step; onJump: (s: Step) => void }) {
  const currentIdx = STEP_ORDER.indexOf(current);
  return (
    <ol className="flex items-center gap-2 overflow-x-auto pb-1">
      {STEP_ORDER.map((s, idx) => {
        const isActive = s === current;
        const isDone = idx < currentIdx;
        return (
          <React.Fragment key={s}>
            <li>
              <button
                type="button"
                onClick={() => (isDone || isActive ? onJump(s) : undefined)}
                disabled={!isDone && !isActive}
                className={cn(
                  "inline-flex items-center gap-2 rounded-full px-3.5 py-2 text-xs font-medium transition-all",
                  isActive && "bg-ink text-white shadow-card",
                  isDone && !isActive && "bg-brand-soft text-brand-deep",
                  !isActive && !isDone && "text-ink-muted opacity-50",
                )}
              >
                <span
                  className={cn(
                    "inline-flex size-5 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold",
                    isActive
                      ? "bg-white text-ink"
                      : isDone
                        ? "bg-brand text-white"
                        : "bg-canvas-deep text-ink-muted",
                  )}
                >
                  {isDone ? <Check className="size-3" /> : idx + 1}
                </span>
                {STEP_LABELS[s]}
              </button>
            </li>
            {idx < STEP_ORDER.length - 1 && (
              <li className="h-px w-4 bg-line" aria-hidden />
            )}
          </React.Fragment>
        );
      })}
    </ol>
  );
}
