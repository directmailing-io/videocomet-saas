"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, Check } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { WizardStep1Webcam } from "./wizard-step1-webcam";
import { WizardStep2Modus } from "./wizard-step2-modus";
import { WizardStep3Editor } from "./wizard-step3-editor";
import { WizardStep4Landingpage } from "./wizard-step4-landingpage";
import { WizardStep5Pdf } from "./wizard-step5-pdf";
import { WizardStep6Summary } from "./wizard-step6-summary";

export interface WizardWebcam {
  id: string;
  name: string;
  publicUrl: string;
  durationSec: number | null;
}

export interface WizardTemplate {
  id: string;
  name: string;
  themeId: string;
}

export interface WizardCustomTemplate {
  id: string;
  name: string;
  description: string | null;
  versionCount: number;
  hasActiveVersion: boolean;
}

export interface WizardDomain {
  id: string;
  hostname: string;
  status: string;
  kind: string;
}

import type { Segment } from "@/lib/segments/types";

/** @deprecated kept for back-compat with older callsites — use Segment. */
export interface WizardSegment {
  id: string;
  type: "website" | "image" | "video" | "googledocs" | "textslide";
  label: string;
}

export interface WizardState {
  name: string;
  webcamMediaId: string | null;
  mode: "webcam-only" | "with-presentation";
  segments: Segment[];
  pipPosition: "bottom-left" | "bottom-right";
  pipShape: "square" | "rounded" | "circle";
  landingPageTemplateId: string | null;
  /**
   * Wenn gesetzt, hat es Vorrang vor `landingPageTemplateId` — die Kampagne
   * verwendet eine vom Kunden hochgeladene HTML-Vorlage. Beide Felder
   * werden gesendet; das Backend übernimmt das, das nicht NULL ist.
   */
  customLpTemplateId: string | null;
  /** NULL = default `app.videocomet.de/v/<slug>`. */
  domainId: string | null;
  /** NULL = default `{firstName}-{lastName}`. */
  slugTemplate: string | null;
  pdfEnabled: boolean;
  pdfGoogleDocsUrl: string;
  pdfQrEnabled: boolean;
  pdfThumbnailEnabled: boolean;
  pdfThumbnailFrameMs: number | null;
}

export interface MediathekItem {
  id: string;
  name: string;
  publicUrl: string;
  type: string;
}

export interface NewCampaignWizardProps {
  initialData: {
    webcams: WizardWebcam[];
    templates: WizardTemplate[];
    /** Custom-HTML-Vorlagen des Users (ZIP-Upload). */
    customTemplates?: WizardCustomTemplate[];
    /** Optional — image/video media items the editor can pick from. */
    media?: MediathekItem[];
    /** Optional — Custom-Domains des Users, für Step 4. */
    domains?: WizardDomain[];
  };
}

const STEPS = [
  "Webcam",
  "Modus",
  "Editor",
  "Landingpage",
  "PDF-Brief",
  "Zusammenfassung",
];

export function NewCampaignWizard({ initialData }: NewCampaignWizardProps) {
  const router = useRouter();
  const [step, setStep] = React.useState(0);
  const [submitting, setSubmitting] = React.useState(false);
  // Webcam list lives in wizard state so newly recorded webcams that step 1
  // adds are still visible in the step 6 summary.
  const [webcams, setWebcams] = React.useState<WizardWebcam[]>(
    initialData.webcams,
  );
  const [state, setState] = React.useState<WizardState>({
    name: "",
    webcamMediaId: null,
    mode: "webcam-only",
    segments: [],
    pipPosition: "bottom-left",
    pipShape: "rounded",
    landingPageTemplateId: null,
    customLpTemplateId: null,
    domainId: null,
    slugTemplate: null,
    pdfEnabled: false,
    pdfGoogleDocsUrl: "",
    pdfQrEnabled: false,
    pdfThumbnailEnabled: false,
    pdfThumbnailFrameMs: null,
  });

  const update = React.useCallback((patch: Partial<WizardState>) => {
    setState((s) => ({ ...s, ...patch }));
  }, []);

  // Skip editor step if mode is webcam-only
  const totalSteps = STEPS.length;
  const skipEditor = state.mode === "webcam-only";

  function next() {
    let nextStep = step + 1;
    if (nextStep === 2 && skipEditor) nextStep = 3;
    setStep(Math.min(nextStep, totalSteps - 1));
  }

  function back() {
    let prevStep = step - 1;
    if (prevStep === 2 && skipEditor) prevStep = 1;
    setStep(Math.max(prevStep, 0));
  }

  async function handleSave() {
    setSubmitting(true);
    try {
      const res = await fetch("/api/campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: state.name || "Neue Kampagne",
          webcamMediaId: state.webcamMediaId,
          mode: state.mode,
          segments: state.segments,
          pipPosition: state.pipPosition,
          pipShape: state.pipShape,
          // Wir senden beide Felder; das Backend übernimmt jenes, das
          // !== null ist. customLpTemplateId hat Vorrang.
          landingPageTemplateId: state.customLpTemplateId
            ? null
            : state.landingPageTemplateId,
          customLpTemplateId: state.customLpTemplateId,
          domainId: state.domainId,
          slugTemplate: state.slugTemplate,
          pdfEnabled: state.pdfEnabled,
          pdfGoogleDocsUrl: state.pdfGoogleDocsUrl || null,
          pdfQrEnabled: state.pdfQrEnabled,
          pdfThumbnailEnabled: state.pdfThumbnailEnabled,
          pdfThumbnailFrameMs: state.pdfThumbnailFrameMs,
        }),
      });
      if (!res.ok) {
        const body = await res.text();
        console.error(`[campaign-wizard] save failed: ${res.status} ${body}`);
        router.push("/kampagnen");
        return;
      }
      const data = (await res.json()) as { campaign?: { id: string } };
      if (data.campaign?.id) {
        // Jump straight to the campaign so the user can create a first run.
        router.push(`/kampagnen/${data.campaign.id}`);
      } else {
        router.push("/kampagnen");
      }
    } catch (err) {
      console.error("[campaign-wizard] save error:", err);
      router.push("/kampagnen");
    } finally {
      setSubmitting(false);
    }
  }

  // Validation per step (basic)
  const canProceed = (() => {
    if (step === 0) return Boolean(state.webcamMediaId);
    if (step === 1) return Boolean(state.mode);
    if (step === 2) return true;
    if (step === 3)
      return Boolean(state.landingPageTemplateId || state.customLpTemplateId);
    if (step === 4) {
      if (!state.pdfEnabled) return true;
      return state.pdfGoogleDocsUrl.trim().length > 0;
    }
    if (step === 5) return state.name.trim().length > 0;
    return true;
  })();

  return (
    <>
      <PageHeader
        title="Neue Kampagne"
        subtitle={`Schritt ${step + 1} von ${totalSteps}: ${STEPS[step]}`}
      />

      <ol className="flex items-center gap-2 mb-8 overflow-x-auto pb-2">
        {STEPS.map((label, idx) => {
          const isActive = idx === step;
          const isDone = idx < step;
          return (
            <li key={label} className="flex items-center gap-2 shrink-0">
              <span
                className={cn(
                  "flex size-7 items-center justify-center rounded-full text-xs font-semibold border transition-colors",
                  isActive && "bg-brand text-white border-brand",
                  isDone && "bg-brand-soft text-brand-deep border-brand-soft",
                  !isActive && !isDone && "bg-surface text-ink-muted border-line",
                )}
              >
                {isDone ? <Check className="size-3.5" /> : idx + 1}
              </span>
              <span
                className={cn(
                  "text-xs font-medium",
                  isActive ? "text-ink" : "text-ink-muted",
                )}
              >
                {label}
              </span>
              {idx < STEPS.length - 1 && (
                <span className="w-6 h-px bg-line ml-1" />
              )}
            </li>
          );
        })}
      </ol>

      <div className="min-h-[320px]">
        {step === 0 && (
          <WizardStep1Webcam
            webcams={webcams}
            value={state.webcamMediaId}
            onChange={(id) => update({ webcamMediaId: id })}
            onWebcamsChange={setWebcams}
          />
        )}
        {step === 1 && (
          <WizardStep2Modus
            value={state.mode}
            onChange={(mode) => update({ mode })}
          />
        )}
        {step === 2 && !skipEditor && (() => {
          const wc = webcams.find((w) => w.id === state.webcamMediaId);
          return (
            <WizardStep3Editor
              segments={state.segments}
              pipPosition={state.pipPosition}
              pipShape={state.pipShape}
              webcamUrl={wc?.publicUrl ?? null}
              webcamDurationSec={wc?.durationSec ?? null}
              mediaItems={initialData.media ?? []}
              onSegmentsChange={(segments) => update({ segments })}
              onPipPositionChange={(pipPosition) => update({ pipPosition })}
              onPipShapeChange={(pipShape) => update({ pipShape })}
            />
          );
        })()}
        {step === 3 && (
          <WizardStep4Landingpage
            templates={initialData.templates}
            value={state.landingPageTemplateId}
            onChange={(id) =>
              update({ landingPageTemplateId: id, customLpTemplateId: null })
            }
            customTemplates={initialData.customTemplates ?? []}
            customValue={state.customLpTemplateId}
            onCustomChange={(id) =>
              update({
                customLpTemplateId: id,
                landingPageTemplateId: id ? null : state.landingPageTemplateId,
              })
            }
            availableDomains={initialData.domains ?? []}
            domainId={state.domainId}
            onDomainChange={(id) => update({ domainId: id })}
            slugTemplate={state.slugTemplate}
            onSlugTemplateChange={(t) => update({ slugTemplate: t })}
          />
        )}
        {step === 4 && (() => {
          const wc = webcams.find((w) => w.id === state.webcamMediaId);
          return (
            <WizardStep5Pdf
              enabled={state.pdfEnabled}
              googleDocsUrl={state.pdfGoogleDocsUrl}
              qrEnabled={state.pdfQrEnabled}
              thumbnailEnabled={state.pdfThumbnailEnabled}
              frameMs={state.pdfThumbnailFrameMs}
              webcamMediaId={state.webcamMediaId}
              webcamDurationSec={wc?.durationSec ?? null}
              onChange={(patch) => update(patch)}
            />
          );
        })()}
        {step === 5 && (
          <WizardStep6Summary
            state={state}
            webcams={webcams}
            templates={initialData.templates}
            onNameChange={(name) => update({ name })}
          />
        )}
      </div>

      <div className="flex items-center justify-between mt-8 pt-6 border-t border-line">
        <Button
          variant="ghost"
          onClick={back}
          disabled={step === 0}
          iconLeft={<ArrowLeft className="size-4" />}
        >
          Zurück
        </Button>
        {step < totalSteps - 1 ? (
          <Button
            onClick={next}
            disabled={!canProceed}
            iconRight={<ArrowRight className="size-4" />}
          >
            Weiter
          </Button>
        ) : (
          <Button
            onClick={handleSave}
            disabled={!canProceed || submitting}
            loading={submitting}
            iconRight={<Check className="size-4" />}
          >
            Kampagne speichern
          </Button>
        )}
      </div>
    </>
  );
}
