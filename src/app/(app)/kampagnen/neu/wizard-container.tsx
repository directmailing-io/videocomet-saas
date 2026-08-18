"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { buildGreetingTemplate } from "@/lib/intro";
import { cn } from "@/lib/utils";

import {
  StudioFlow,
  type StudioFlowResult,
} from "@/components/studio/studio-flow";
import { WizardStep1Webcam } from "./wizard-step1-webcam";
import { WizardStep2Modus } from "./wizard-step2-modus";
import { WizardStep3Editor } from "./wizard-step3-editor";
import { WizardStep4Landingpage } from "./wizard-step4-landingpage";
import { WizardStep5Pdf } from "./wizard-step5-pdf";
import { WizardStepIntro } from "./wizard-step-intro";
import { WizardStep6Summary } from "./wizard-step6-summary";
import { parseDraftEnvelope, useWizardDraft } from "./use-wizard-draft";
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
  /**
   * Personalisierte KI-Begrüßung (2 Credits pro Video statt 1). Voice-Klon
   * + Kalibrierung sind KEINE Voraussetzung für die Auswahl — ohne fertige
   * Stimme rendert die Pipeline ohne Begrüßung und berechnet 1 Credit.
   */
  introEnabled: boolean;
  /**
   * Prefix + Namens-Muster für die KI-Begrüßung. Werden zum Save-Zeitpunkt
   * zu einem `ttsTemplate`-String zusammengebaut und beim Kalibrierungs-
   * Insert der Kampagne mitgesendet.
   */
  introGreetingPrefix: import("@/lib/intro").GreetingPrefix;
  introNamePattern: import("@/lib/intro").NamePatternKey;
  /**
   * Wie das Webcam-Video entstanden ist:
   *  • "classic" → heutiger Flow (Schritt für Schritt), Default.
   *  • "studio"  → Studio-Aufnahme (Live-Regie): Segmente + PiP kommen fertig
   *    aus dem StudioFlow, Modus ist implizit "with-presentation" und
   *    Schritt 2 (Modus-Wahl) wird übersprungen.
   * Optional, damit alte Drafts ohne das Feld sauber laden (→ "classic").
   */
  recordingKind?: "classic" | "studio";
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
  /**
   * Server-Draft (Migration 0052), wenn der Wizard über `?draft=<id>`
   * geöffnet wurde: `envelope` ist der rohe `wizard_state`-Snapshot aus
   * der DB. Validierung/Migration übernimmt `parseDraftEnvelope` —
   * bei Schema-Drift startet der Wizard frisch, behält aber die ID
   * (der nächste Auto-Save überschreibt den kaputten Snapshot).
   */
  initialDraft?: { id: string; envelope: unknown } | null;
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
    title: "Wie möchtest du dein Video erstellen?",
    desc: "Nimm es neu auf oder verwende ein fertiges Video.",
  },
  {
    label: "KI-Begrüßung",
    title: "Persönliche KI-Begrüßung",
    desc: "Optional: jeder Lead wird mit Vornamen begrüßt, in deiner Stimme.",
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
 * Editor-Step (Index 3) wird nur gezeigt, wenn der Modus „with-presentation"
 * gewählt ist. Wir behalten ihn als sichtbaren-aber-disabled Schritt in der
 * Progress-Anzeige, damit es für den Nutzer keine plötzlichen „der Wizard ist
 * jetzt anders lang"-Sprünge gibt.
 */
const EDITOR_STEP_INDEX = 3;

/**
 * Modus-Step (Index 2) wird bei Studio-Aufnahmen übersprungen — der Modus
 * ist dann implizit "with-presentation" (Segmente kommen fertig aus dem
 * Studio). Analog zum Editor-Skip bleibt der Schritt in der Progress-
 * Anzeige sichtbar, damit die Wizard-Länge stabil bleibt.
 */
const MODE_STEP_INDEX = 2;

function createInitialWizardState(): WizardState {
  return {
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
    introEnabled: false,
    introGreetingPrefix: "Hi",
    introNamePattern: "firstName",
    recordingKind: "classic",
  };
}

export function NewCampaignWizard({
  userId,
  initialDraft,
  initialData,
}: NewCampaignWizardProps) {
  const router = useRouter();
  // Server-Draft-Resume: Snapshot einmalig beim Mount parsen (Lazy-Init,
  // damit der teure JSON-Walk nicht bei jedem Render läuft). Referenzen
  // auf inzwischen gelöschte Ressourcen (Webcam, Vorlagen, Domain) werden
  // genullt — sonst scheitert die Aktivierung später an FK-Constraints.
  const [resumed] = React.useState(() => {
    const parsed = initialDraft
      ? parseDraftEnvelope(initialDraft.envelope)
      : null;
    if (!parsed) return null;
    const s = parsed.state;
    const webcamOk =
      s.webcamMediaId === null ||
      initialData.webcams.some((w) => w.id === s.webcamMediaId);
    const tplOk =
      s.landingPageTemplateId === null ||
      initialData.templates.some((t) => t.id === s.landingPageTemplateId);
    const customOk =
      s.customLpTemplateId === null ||
      (initialData.customTemplates ?? []).some(
        (t) => t.id === s.customLpTemplateId,
      );
    const domainOk =
      s.domainId === null ||
      (initialData.domains ?? []).some((d) => d.id === s.domainId);
    if (webcamOk && tplOk && customOk && domainOk) return parsed;
    return {
      // Fehlt die Webcam, zurück zu Schritt 1 — sie ist die Grundlage.
      step: webcamOk ? parsed.step : 0,
      state: {
        ...s,
        webcamMediaId: webcamOk ? s.webcamMediaId : null,
        landingPageTemplateId: tplOk ? s.landingPageTemplateId : null,
        customLpTemplateId: customOk ? s.customLpTemplateId : null,
        domainId: domainOk ? s.domainId : null,
      },
    };
  });
  const [step, setStep] = React.useState(resumed?.step ?? 0);
  const [submitting, setSubmitting] = React.useState(false);
  // Webcam list lives in wizard state so newly recorded webcams that step 1
  // adds are still visible in the step 6 summary.
  const [webcams, setWebcams] = React.useState<WizardWebcam[]>(
    initialData.webcams,
  );
  const [state, setState] = React.useState<WizardState>(
    () => resumed?.state ?? createInitialWizardState(),
  );

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

  // ── Draft-Persistenz (Auto-Save als Server-Draft) ───────────────────────
  //
  // Legt beim ersten echten Fortschritt eine Kampagnen-Row mit
  // status='draft' an (→ „Entwurf"-Card in der Übersicht) und hält sie
  // danach debounced aktuell. Siehe `./use-wizard-draft.ts` für Details.
  const draftIO = React.useMemo(
    () => ({ setState, setStep }),
    [],
  );
  const draft = useWizardDraft(
    { userId, initialDraftId: initialDraft?.id ?? null, state, step },
    draftIO,
  );

  // ── Studio-Aufnahme (Live-Regie) ────────────────────────────────────────
  //
  // Vollbild-Overlay über dem Wizard; bei „Übernehmen" landen Webcam,
  // Segmente + PiP in EINEM update() im Wizard-State und es geht direkt
  // weiter zu Schritt 1 (KI-Begrüßung). Abbruch lässt Schritt 0 unberührt.
  const [studioOpen, setStudioOpen] = React.useState(false);

  const handleStudioComplete = React.useCallback(
    (result: StudioFlowResult) => {
      update({
        webcamMediaId: result.webcamMediaId,
        mode: "with-presentation",
        segments: result.segments,
        pipPosition: result.pipPosition,
        pipShape: result.pipShape,
        recordingKind: "studio",
      });
      setStudioOpen(false);
      setStep(1);
      // Die Studio-Webcam wurde frisch über /api/media hochgeladen und ist
      // in der server-gerenderten Liste noch nicht enthalten — nachladen,
      // damit Editor-Preview (URL/Dauer) und Zusammenfassung sie kennen.
      void (async () => {
        try {
          const res = await fetch("/api/media?type=webcam,video", {
            credentials: "same-origin",
          });
          if (!res.ok) return;
          const data = (await res.json()) as {
            items?: Array<{
              id: string;
              name: string;
              publicUrl: string;
              durationSec: number | null;
              type: string;
              width: number | null;
              height: number | null;
            }>;
          };
          setWebcams(
            (data.items ?? []).map((it) => ({
              id: it.id,
              name: it.name,
              publicUrl: it.publicUrl,
              durationSec: it.durationSec ?? null,
              kind: it.type === "video" ? "video" : "webcam",
              width: it.width ?? null,
              height: it.height ?? null,
            })),
          );
        } catch {
          // Best-effort: ohne Refresh fehlt nur die Vorschau, der State
          // (webcamMediaId) ist trotzdem korrekt gesetzt.
        }
      })();
    },
    [update],
  );

  // Skip editor step if mode is webcam-only
  const totalSteps = STEP_META.length;
  // Studio-Aufnahme: Modus steht implizit fest → Schritt 2 überspringen.
  // Segmente + PiP kommen fertig aus dem StudioFlow → auch der Editor
  // (Schritt 3) entfällt.
  const isStudioRecording = (state.recordingKind ?? "classic") === "studio";
  const skipEditor = state.mode === "webcam-only" || isStudioRecording;
  const skipModeStep = isStudioRecording;

  const isSkippedStep = React.useCallback(
    (idx: number) => {
      if (idx === EDITOR_STEP_INDEX && skipEditor) return true;
      if (idx === MODE_STEP_INDEX && skipModeStep) return true;
      return false;
    },
    [skipEditor, skipModeStep],
  );

  function next() {
    let nextStep = step + 1;
    while (nextStep < totalSteps - 1 && isSkippedStep(nextStep)) nextStep += 1;
    setStep(Math.min(nextStep, totalSteps - 1));
  }

  function back() {
    let prevStep = step - 1;
    while (prevStep > 0 && isSkippedStep(prevStep)) prevStep -= 1;
    setStep(Math.max(prevStep, 0));
  }

  async function handleSave() {
    setSubmitting(true);
    try {
      // Existiert bereits eine Draft-Row (Auto-Save), aktivieren wir sie
      // per PATCH — sonst klassischer POST. So gibt es nie Duplikate.
      const activateId = draft.draftId;
      const res = await fetch(
        activateId ? `/api/campaigns/${activateId}` : "/api/campaigns",
        {
        method: activateId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(activateId ? { status: "active" } : {}),
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
          introEnabled: state.introEnabled,
          // Nur mitsenden wenn KI-Begrüßung aktiv — sonst würde die
          // API einen unbenutzten Wert an eine evtl. bestehende
          // Kalibrierung schreiben wollen.
          ...(state.introEnabled
            ? {
                introTtsTemplate: buildGreetingTemplate(
                  state.introGreetingPrefix,
                  state.introNamePattern,
                ),
              }
            : {}),
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
  // Reihenfolge: 0 Webcam, 1 KI-Begrüßung, 2 Modus, 3 Editor,
  // 4 Landingpage, 5 PDF-Brief, 6 Fertigstellen.
  const canProceed = (() => {
    if (step === 0) return Boolean(state.webcamMediaId);
    if (step === 1) return true; // KI-Begrüßung ist immer optional
    if (step === 2) return Boolean(state.mode);
    if (step === 3) return true; // Editor: keine Pflichtvalidierung
    if (step === 4)
      return Boolean(state.landingPageTemplateId || state.customLpTemplateId);
    if (step === 5) {
      if (!state.pdfEnabled) return true;
      if (state.pdfGoogleDocsUrl.trim().length === 0) return false;
      // A/B eingeschaltet → Brief B ist Pflicht, sonst wäre der Test
      // still-inaktiv und der User wundert sich später.
      if (state.abTestingEnabled) {
        return (state.pdfGoogleDocsUrlB ?? "").trim().length > 0;
      }
      return true;
    }
    if (step === 6) return state.name.trim().length > 0;
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
            // Auswahl über den klassischen Bereich = klassischer Flow. Das
            // setzt auch einen evtl. vorherigen Studio-Durchlauf zurück,
            // denn dessen Segment-Dauern passen nur zur Studio-Webcam —
            // Schritt 2 (Modus) ist damit wieder Teil des Wizards.
            onChange={(id) =>
              update({ webcamMediaId: id, recordingKind: "classic" })
            }
            onWebcamsChange={setWebcams}
            // Immer anzeigen: Die KI-Entscheidung fällt erst im nächsten
            // Schritt, aufgenommen wird aber hier — der Tipp muss vorher da sein.
            showKiHint
            onStartStudio={() => setStudioOpen(true)}
          />
        )}
        {step === 1 && (
          <WizardStepIntro
            enabled={state.introEnabled}
            onChange={(introEnabled) => update({ introEnabled })}
            webcamMediaId={state.webcamMediaId}
            greetingPrefix={state.introGreetingPrefix}
            namePattern={state.introNamePattern}
            onGreetingChange={(prefix, pattern) =>
              update({ introGreetingPrefix: prefix, introNamePattern: pattern })
            }
          />
        )}
        {step === 2 && !skipModeStep && (
          <WizardStep2Modus
            value={state.mode}
            onChange={(mode) => update({ mode })}
          />
        )}
        {step === 3 && !skipEditor && (() => {
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
        {step === 4 && (
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
        {step === 5 && (() => {
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
              webcamUrl={wc?.publicUrl ?? null}
              mode={state.mode}
              segments={state.segments as import("@/lib/segments/types").Segment[]}
              pipPosition={state.pipPosition}
              pipShape={state.pipShape}
              thumbnailImageEnabled={state.thumbnailImageEnabled}
              thumbnailImage={state.thumbnailImage}
              thumbnailMode={state.thumbnailMode}
              thumbnailPlayIcon={state.thumbnailPlayIcon}
              mediaItems={initialData.media ?? []}
              onChange={(patch) => update(patch)}
            />
          );
        })()}
        {step === 6 && (
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
            const isSkipped = isSkippedStep(idx);
            // Studio-Aufnahme: Modus- und Editor-Schritt sind nicht
            // ausgelassen, sondern bereits erledigt — Modus ist implizit
            // „Webcam + Videopräsentation", die Segmente kommen fertig
            // geschnitten aus dem Studio. Der Stepper zeigt beide deshalb
            // als abgehakt statt als übersprungen.
            const isStudioDone =
              (idx === MODE_STEP_INDEX || idx === EDITOR_STEP_INDEX) &&
              isStudioRecording;
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
                    isSkipped && !isStudioDone && "opacity-40"
                  )}
                >
                  <span
                    className={cn(
                      "inline-flex size-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold",
                      isActive
                        ? "bg-ink text-white"
                        : (isDone && !isSkipped) || isStudioDone
                          ? "bg-brand-soft text-brand-deep"
                          : "bg-canvas-deep text-ink-muted"
                    )}
                  >
                    {(isDone && !isSkipped) || isStudioDone ? (
                      <Check className="size-3.5" />
                    ) : (
                      idx + 1
                    )}
                  </span>
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate">{s.label}</span>
                    {isStudioDone ? (
                      <span className="text-[11px] font-normal text-ink-muted">
                        {idx === EDITOR_STEP_INDEX
                          ? "Im Studio fertig geschnitten"
                          : "Durch Studio-Aufnahme festgelegt"}
                      </span>
                    ) : isSkipped ? (
                      <span className="text-[11px] font-normal text-ink-muted">
                        Wird übersprungen
                      </span>
                    ) : null}
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

      {/* Studio-Aufnahme — Vollbild-Overlay über dem gesamten Wizard. */}
      {studioOpen && (
        <div className="fixed inset-0 z-50 bg-canvas">
          <StudioFlow
            onComplete={handleStudioComplete}
            onCancel={() => setStudioOpen(false)}
          />
        </div>
      )}
    </div>
  );
}
