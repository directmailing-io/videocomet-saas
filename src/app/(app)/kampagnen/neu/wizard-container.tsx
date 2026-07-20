"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { WizardStep1Webcam } from "./wizard-step1-webcam";
import { WizardStep2Modus } from "./wizard-step2-modus";
import { WizardStep3Editor } from "./wizard-step3-editor";
import { WizardStep4Landingpage } from "./wizard-step4-landingpage";
import { WizardStep5Pdf } from "./wizard-step5-pdf";
import { WizardStep6Summary } from "./wizard-step6-summary";
import { useWizardDraft } from "./use-wizard-draft";
import { DraftRestoreBanner, DraftStatusPill } from "./wizard-draft-ui";
import { WizardReloadButton } from "./wizard-reload-button";

export interface WizardWebcam {
  id: string;
  name: string;
  publicUrl: string;
  durationSec: number | null;
  /** Distinguishes classic webcam recordings ("webcam") from media library
   *  uploads ("video") so the picker can show a subtle badge. The downstream
   *  rendering pipeline treats them identically. */
  kind: "webcam" | "video";
  /** Native source pixel dimensions (server-probed at upload). Both NULL
   *  for legacy items prior to Migration 0011 — UI falls back to 16:9. */
  width: number | null;
  height: number | null;
}

export interface WizardTemplate {
  id: string;
  name: string;
  themeId: string;
  content: unknown;
}

export interface WizardCustomTemplate {
  id: string;
  name: string;
  description: string | null;
  versionCount: number;
  thumbnailUrl: string | null;
  hasActiveVersion: boolean;
}

export interface WizardDomain {
  id: string;
  hostname: string;
  status: string;
  kind: string;
}

import type { CampaignThumbnailImage, Segment } from "@/lib/segments/types";

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
  /** A/B-Test für Brief-Vorlagen — Brief A ist `pdfGoogleDocsUrl`. */
  abTestingEnabled: boolean;
  pdfGoogleDocsUrlB: string;
  /** Standard-Verteilung des A/B-Tests — pro Runde überschreibbar. */
  abSplitMode: "random" | "sequential";
  abSplitWeightA: number;
  pdfQrEnabled: boolean;
  pdfThumbnailEnabled: boolean;
  pdfThumbnailFrameMs: number | null;
  /**
   * Paket C — Thumbnail-Generator (Personalisiertes Vorschaubild).
   * Wird im PDF-Brief statt eines Video-Frames eingebettet. Beide Felder
   * werden bei Submit mitgeschickt; das Backend ignoriert sie, solange
   * Paket A (DB-Migration + API-Schema) noch nicht durchgeschaltet ist.
   */
  thumbnailImageEnabled: boolean;
  thumbnailImage: CampaignThumbnailImage | null;
  /**
   * Migration 0019 — Single-Source-of-Truth für die Thumbnail-Variante.
   *  • 'frame'                  → Standbild aus dem Video (`pdfThumbnailFrameMs`)
   *  • 'custom_image'           → personalisierte Folie (`thumbnailImage`)
   *  • 'landingpage_screenshot' → Auto-Screenshot der Lead-LP
   * `thumbnailImageEnabled` wird vom Wizard konsistent zum Modus gehalten:
   * `(thumbnailMode === 'custom_image')`.
   */
  thumbnailMode: "frame" | "custom_image" | "landingpage_screenshot";
  /**
   * Globales Play-Icon-Overlay (halbtransparenter Play-Button auf dem
   * Vorschaubild). Gilt für alle 3 Modi gleichermaßen. Composite-Logik
   * landet in Paket C.
   */
  thumbnailPlayIcon: boolean;
}

export interface MediathekItem {
  id: string;
  name: string;
  publicUrl: string;
  type: string;
}

export interface NewCampaignWizardProps {
  /**
   * Account-ID des eingeloggten Nutzers. Wird als Scope für den
   * localStorage-Draft-Key (`vc:wizard:draft:<userId>`) verwendet, damit
   * auf geteilten Browsern Drafts nicht zwischen Accounts durchsickern.
   */
  userId: string;
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

interface StepMeta {
  label: string;
  title: string;
  desc: string;
}

const STEP_META: StepMeta[] = [
  {
    label: "Webcam",
    title: "Wähle dein Webcam-Video",
    desc: "Nutze eine vorhandene Aufnahme oder nimm direkt eine neue auf.",
  },
  {
    label: "Modus",
    title: "Modus wählen",
    desc: "Bestimme, wie deine Kampagne aufgebaut ist.",
  },
  {
    label: "Editor",
    title: "Video gestalten",
    desc: "Wähle links etwas aus — bearbeitet wird rechts.",
  },
  {
    label: "Landingpage",
    title: "Wähle deine Landingpage",
    desc: "Vorlage und Web-Adresse für deine personalisierten Seiten.",
  },
  {
    label: "PDF-Brief",
    title: "PDF-Brief",
    desc: "Optional: personalisierter Brief mit QR-Code und Vorschaubild.",
  },
  {
    label: "Fertigstellen",
    title: "Zusammenfassung",
    desc: "Prüfe alles und gib deiner Kampagne einen Namen.",
  },
];

/**
 * Editor-Step (Index 2) wird nur gezeigt, wenn der Modus „with-presentation"
 * gewählt ist. Wir behalten ihn als sichtbaren-aber-disabled Schritt in der
 * Progress-Anzeige, damit es für den Nutzer keine plötzlichen „der Wizard ist
 * jetzt anders lang"-Sprünge gibt.
 */
const EDITOR_STEP_INDEX = 2;

export function NewCampaignWizard({ userId, initialData }: NewCampaignWizardProps) {
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
    abTestingEnabled: false,
    pdfGoogleDocsUrlB: "",
    abSplitMode: "random",
    abSplitWeightA: 50,
    pdfQrEnabled: false,
    pdfThumbnailEnabled: false,
    pdfThumbnailFrameMs: null,
    thumbnailImageEnabled: false,
    thumbnailImage: null,
    thumbnailMode: "frame",
    thumbnailPlayIcon: false,
  });

  const update = React.useCallback((patch: Partial<WizardState>) => {
    setState((s) => ({ ...s, ...patch }));
  }, []);

  // ── Daten-Reload ohne State-Verlust ─────────────────────────────────────
  //
  // router.refresh() lässt die Server-Component (page.tsx) neu laufen und
  // aktualisiert `initialData` (Vorlagen, Custom-LPs, Domains, Mediathek).
  // Client-State (Wizard-Eingaben, aktueller Schritt) bleibt dabei erhalten —
  // so kann der User z. B. eine Landingpage-Vorlage im neuen Tab anlegen und
  // sie hier per Klick nachladen.
  const [reloading, startReload] = React.useTransition();
  const reloadData = React.useCallback(() => {
    startReload(() => router.refresh());
  }, [router]);

  // ── Draft-Persistenz (Auto-Save) ────────────────────────────────────────
  //
  // Hält den Wizard-Fortschritt in localStorage am Leben, damit ein Wechsel
  // nach `/landingpages/neu` oder ein versehentlicher Tab-Close den User
  // nicht ALLES verlieren lässt. Siehe `./use-wizard-draft.ts` für Details
  // (Debounce, Schema-Drift-Handling, Quota-Fallback in sessionStorage).
  const draftIO = React.useMemo(
    () => ({ setState, setStep }),
    [],
  );
  const draft = useWizardDraft(
    { userId, state, step },
    draftIO,
  );

  // Skip editor step if mode is webcam-only
  const totalSteps = STEP_META.length;
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
          // A/B nur aktiv persistieren, wenn die Voraussetzungen wirklich
          // erfüllt sind (PDF an + beide URLs) — sonst sauber aus/leer.
          abTestingEnabled:
            state.pdfEnabled &&
            state.abTestingEnabled &&
            Boolean(state.pdfGoogleDocsUrl.trim()) &&
            Boolean((state.pdfGoogleDocsUrlB ?? "").trim()),
          pdfGoogleDocsUrlB:
            state.pdfEnabled && state.abTestingEnabled
              ? (state.pdfGoogleDocsUrlB ?? "").trim() || null
              : null,
          abSplitMode: state.abSplitMode,
          abSplitWeightA: state.abSplitWeightA,
          pdfQrEnabled: state.pdfQrEnabled,
          pdfThumbnailEnabled: state.pdfThumbnailEnabled,
          pdfThumbnailFrameMs: state.pdfThumbnailFrameMs,
          // Paket C: Frontend sendet immer mit; Backend-Validation kommt
          // mit Paket A/E nach. Solange das Schema das Feld nicht kennt,
          // wird es vom API-Handler einfach verworfen.
          thumbnailImageEnabled: state.thumbnailImageEnabled,
          thumbnailImage: state.thumbnailImage,
          // Migration 0019 — Single-Source-of-Truth + globales Play-Icon.
          thumbnailMode: state.thumbnailMode,
          thumbnailPlayIcon: state.thumbnailPlayIcon,
        }),
      });
      if (!res.ok) {
        const body = await res.text();
        console.error(`[campaign-wizard] save failed: ${res.status} ${body}`);
        router.push("/kampagnen");
        return;
      }
      const data = (await res.json()) as { campaign?: { id: string } };
      // Finaler Save war erfolgreich → Draft entsorgen, damit der nächste
      // Wizard-Besuch frisch beginnt.
      draft.clearDraft();
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
      if (state.pdfGoogleDocsUrl.trim().length === 0) return false;
      // A/B eingeschaltet → Brief B ist Pflicht, sonst wäre der Test
      // still-inaktiv und der User wundert sich später.
      if (state.abTestingEnabled) {
        return (state.pdfGoogleDocsUrlB ?? "").trim().length > 0;
      }
      return true;
    }
    if (step === 5) return state.name.trim().length > 0;
    return true;
  })();

  const meta = STEP_META[step];
  // Editor-Step braucht die volle Breite (Studio-Layout), alle anderen
  // Steps lesen sich in einer fokussierten, schmalen Spalte besser.
  const contentMax = step === EDITOR_STEP_INDEX ? "max-w-[1400px]" : "max-w-3xl";

  function exitWizard() {
    router.push("/kampagnen");
  }

  const stepContent = (
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
            // Block-Auswahl: setzt Block-ID UND nullt Custom-ID atomar
            // in einem einzigen State-Update (sonst gibt es Stale-Closure-Bugs
            // mit doppeltem `update()` aus der Step-Komponente heraus).
            onChange={(id) =>
              update({ landingPageTemplateId: id, customLpTemplateId: null })
            }
            customTemplates={initialData.customTemplates ?? []}
            customValue={state.customLpTemplateId}
            // Custom-Auswahl: id !== null heisst „User wählt Custom-LP" →
            // Block-ID muss raus. id === null heisst „User deselektiert Custom"
            // → Block-ID bleibt unverändert (deshalb functional setter, damit
            // wir den aktuellen Wert lesen statt einen stale-captured).
            onCustomChange={(id) => {
              if (id === null) {
                setState((s) => ({ ...s, customLpTemplateId: null }));
              } else {
                setState((s) => ({
                  ...s,
                  customLpTemplateId: id,
                  landingPageTemplateId: null,
                }));
              }
            }}
            availableDomains={initialData.domains ?? []}
            domainId={state.domainId}
            onDomainChange={(id) => update({ domainId: id })}
            slugTemplate={state.slugTemplate}
            onSlugTemplateChange={(t) => update({ slugTemplate: t })}
            onReload={reloadData}
            reloading={reloading}
          />
        )}
        {step === 4 && (() => {
          const wc = webcams.find((w) => w.id === state.webcamMediaId);
          return (
            <WizardStep5Pdf
              enabled={state.pdfEnabled}
              googleDocsUrl={state.pdfGoogleDocsUrl}
              abTestingEnabled={state.abTestingEnabled}
              googleDocsUrlB={state.pdfGoogleDocsUrlB ?? ""}
              abSplitMode={state.abSplitMode}
              abSplitWeightA={state.abSplitWeightA}
              qrEnabled={state.pdfQrEnabled}
              thumbnailEnabled={state.pdfThumbnailEnabled}
              frameMs={state.pdfThumbnailFrameMs}
              webcamMediaId={state.webcamMediaId}
              webcamDurationSec={wc?.durationSec ?? null}
              thumbnailImageEnabled={state.thumbnailImageEnabled}
              thumbnailImage={state.thumbnailImage}
              thumbnailMode={state.thumbnailMode}
              thumbnailPlayIcon={state.thumbnailPlayIcon}
              mediaItems={initialData.media ?? []}
              onChange={(patch) => update(patch)}
            />
          );
        })()}
        {step === 5 && (
          <WizardStep6Summary
            state={state}
            webcams={webcams}
            templates={initialData.templates}
            customTemplates={initialData.customTemplates}
            onNameChange={(name) => update({ name })}
          />
        )}
      </div>
  );

  return (
    <div className="fixed inset-0 z-40 flex bg-canvas">
      {/* Step-Rail (Desktop) */}
      <aside className="hidden lg:flex w-[280px] shrink-0 flex-col p-6">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={exitWizard}
            className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-surface text-ink-muted shadow-card transition-colors hover:text-ink"
            aria-label="Wizard verlassen"
          >
            <X className="size-4" />
          </button>
          <span className="text-sm font-semibold text-ink">Neue Kampagne</span>
        </div>

        <ol className="mt-10 flex flex-col gap-1.5">
          {STEP_META.map((s, idx) => {
            const isActive = idx === step;
            const isDone = idx < step;
            const isSkipped = idx === EDITOR_STEP_INDEX && skipEditor;
            return (
              <li key={s.label}>
                <button
                  type="button"
                  onClick={() => {
                    if (isDone && !isSkipped) setStep(idx);
                  }}
                  disabled={!isDone || isSkipped}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-full px-3 py-2.5 text-left text-sm font-medium transition-all",
                    isActive && "bg-surface text-ink shadow-card",
                    isDone && !isActive && "text-ink-soft hover:bg-surface/60 hover:text-ink",
                    !isActive && !isDone && "text-ink-muted opacity-60",
                    isSkipped && "opacity-40"
                  )}
                >
                  <span
                    className={cn(
                      "inline-flex size-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold",
                      isActive
                        ? "bg-ink text-white"
                        : isDone && !isSkipped
                          ? "bg-brand-soft text-brand-deep"
                          : "bg-canvas-deep text-ink-muted"
                    )}
                  >
                    {isDone && !isSkipped ? <Check className="size-3.5" /> : idx + 1}
                  </span>
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate">{s.label}</span>
                    {isSkipped && (
                      <span className="text-[11px] font-normal text-ink-muted">
                        Wird übersprungen
                      </span>
                    )}
                  </span>
                </button>
              </li>
            );
          })}
        </ol>

        <div className="mt-auto flex flex-col items-start gap-2">
          <DraftStatusPill status={draft.status} lastSavedAt={draft.lastSavedAt} />
          <WizardReloadButton
            onReload={reloadData}
            reloading={reloading}
            variant="subtle"
          />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Mobile-Topbar mit Progress */}
        <div className="flex items-center gap-3 px-4 pt-4 lg:hidden">
          <button
            type="button"
            onClick={exitWizard}
            className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-surface text-ink-muted shadow-card transition-colors hover:text-ink"
            aria-label="Wizard verlassen"
          >
            <X className="size-4" />
          </button>
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <span className="truncate text-xs font-medium text-ink-muted">
              Schritt {step + 1} von {totalSteps} · {meta.label}
            </span>
            <div className="h-1 w-full overflow-hidden rounded-full bg-canvas-deep">
              <div
                className="h-full rounded-full bg-ink transition-all"
                style={{ width: `${((step + 1) / totalSteps) * 100}%` }}
              />
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          <div className={cn("mx-auto w-full px-6 py-10 sm:px-10", contentMax)}>
            {draft.existingDraft && (
              <DraftRestoreBanner
                draft={draft.existingDraft}
                onRestore={draft.restoreDraft}
                onDiscard={draft.discardDraft}
              />
            )}
            <div className="mb-8">
              <h1 className="text-2xl font-bold tracking-tight text-ink sm:text-3xl">
                {meta.title}
              </h1>
              <p className="mt-1.5 text-sm text-ink-muted">{meta.desc}</p>
            </div>
            {stepContent}
          </div>
        </div>

        {/* Sticky-Footer */}
        <div className="bg-canvas/80 px-6 py-4 backdrop-blur sm:px-10">
          <div
            className={cn(
              "mx-auto flex w-full items-center justify-between gap-3",
              contentMax
            )}
          >
            <Button
              variant="ghost"
              onClick={back}
              disabled={step === 0}
              iconLeft={<ArrowLeft className="size-4" />}
            >
              Zurück
            </Button>
            <div className="flex items-center gap-3">
              <DraftStatusPill
                status={draft.status}
                lastSavedAt={draft.lastSavedAt}
                className="hidden sm:inline-flex lg:hidden"
              />
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
          </div>
        </div>
      </div>
    </div>
  );
}
