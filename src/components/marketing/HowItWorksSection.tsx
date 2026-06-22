"use client";

import * as React from "react";
import QRCodeLib from "qrcode";
import { AnimatePresence, motion } from "framer-motion";
import {
  CalendarCheck,
  CheckCircle2,
  ClipboardList,
  Eye,
  FileText,
  Image as ImageIcon,
  Linkedin,
  AtSign,
  Mail,
  MousePointerClick,
  PlayCircle,
  Presentation,
  Video as VideoIcon,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Kumulativer Layer-Walkthrough mit interaktiver Side-Panel-Auswahl.
 *
 * - Eine fixe 16:10-Stage links, Side-Panel rechts.
 * - Webcam-<video> bleibt durchgehend gemountet und animiert nur seine
 *   Position/Größe pro Step (CSS-Transitionen).
 * - Im Side-Panel sind Sub-Selektoren pro Step (z. B. 3 Takes, 4 Szenen,
 *   3 LP-Templates). Klick → Preview updated live.
 */

type StepId =
  | "webcam"
  | "scenes"
  | "landing"
  | "leads"
  | "letter"
  | "tracking";

const STEPS: ReadonlyArray<{
  id: StepId;
  title: string;
  eyebrow: string;
  headline: string;
  sub: string;
}> = [
  {
    id: "webcam",
    title: "Webcam",
    eyebrow: "Aufnehmen",
    headline: "Eine Aufnahme. Drei Takes.",
    sub: "Nimm dich einmal vor der Webcam auf. Wähle den Take, der am besten sitzt.",
  },
  {
    id: "scenes",
    title: "Szenen",
    eyebrow: "Szenen wählen",
    headline: "Setze deine Aufnahme in Szene.",
    sub: "Website, Folien, persönliches Dokument oder reines Webcam-Solo. Deine Aufnahme sitzt automatisch im Bild.",
  },
  {
    id: "landing",
    title: "Landingpage",
    eyebrow: "Landingpage gestalten",
    headline: "Drei Vorlagen. Dein Video sitzt im Hero.",
    sub: "Wähle ein Design. Headline, Platzhalter und CTA sind schon drin.",
  },
  {
    id: "leads",
    title: "Leadliste",
    eyebrow: "Leadliste hochladen",
    headline: "Aus eins wird tausend.",
    sub: "CSV rein, jede Zeile bekommt eine eigene Landingpage. Die fertige Liste wandert in dein Versand-Tool.",
  },
  {
    id: "letter",
    title: "Brief",
    eyebrow: "Brief erstellen",
    headline: "Druckfertiges PDF pro Empfänger.",
    sub: "Adresse, Anrede, Inhalt und persönliche URL sind schon drin. Drucke direkt oder gib das Bündel an deinen Druckdienst.",
  },
  {
    id: "tracking",
    title: "Tracking",
    eyebrow: "Live tracken",
    headline: "Du siehst alles, in Echtzeit.",
    sub: "Jede Öffnung, Watch-Time, jeder Klick. Optional synchron in HubSpot, Salessuite, Close, Zapier oder Make.",
  },
];

// ---------------------------------------------------------------------------
// Webcam-Takes / Szenen / Templates
// ---------------------------------------------------------------------------

const TAKES = [
  { id: 0, label: "Take A", subtitle: "0:48", initials: "CS", grad: "from-[#AA8CF5] to-[#7C5CE8]" },
  { id: 1, label: "Take B", subtitle: "1:24", initials: "CS", grad: "from-[#10B981] to-[#047857]" },
  { id: 2, label: "Take C", subtitle: "0:58", initials: "CS", grad: "from-[#FBBF24] to-[#D97706]" },
];

type SceneId = "website" | "slides" | "doc" | "solo";
const SCENES: Array<{
  id: SceneId;
  label: string;
  sub: string;
  icon: React.ReactNode;
}> = [
  { id: "website", label: "Website", sub: "Screenshot des Leads", icon: <ImageIcon className="size-4" /> },
  { id: "slides", label: "Folien", sub: "Pitch-Deck-Stil", icon: <Presentation className="size-4" /> },
  { id: "doc", label: "Doc", sub: "Persönliche Notiz", icon: <FileText className="size-4" /> },
  { id: "solo", label: "Solo", sub: "Nur dein Video", icon: <VideoIcon className="size-4" /> },
];

type TemplateId = "soft" | "bold" | "classic";
const TEMPLATES: Array<{
  id: TemplateId;
  label: string;
  sub: string;
  bg: string;
  headerBg: string;
  accent: string;
  text: string;
  textMuted: string;
  ctaBg: string;
  ctaText: string;
}> = [
  {
    id: "soft",
    label: "Soft",
    sub: "Hell, freundlich",
    bg: "#FAFAFE",
    headerBg: "#FFFFFF",
    accent: "#7C5CE8",
    text: "#0F172A",
    textMuted: "#64748B",
    ctaBg: "#7C5CE8",
    ctaText: "#FFFFFF",
  },
  {
    id: "bold",
    label: "Bold",
    sub: "Dark, hochkontrast",
    bg: "#0F172A",
    headerBg: "#1E293B",
    accent: "#FBBF24",
    text: "#FFFFFF",
    textMuted: "#94A3B8",
    ctaBg: "#FBBF24",
    ctaText: "#0F172A",
  },
  {
    id: "classic",
    label: "Klassisch",
    sub: "Warm, edel",
    bg: "#FAF5EB",
    headerBg: "#F5E6D3",
    accent: "#92400E",
    text: "#1C1917",
    textMuted: "#78716C",
    ctaBg: "#1C1917",
    ctaText: "#FAF5EB",
  },
];

const LEADS = [
  {
    name: "Max Mustermann",
    first: "Max",
    salutation: "Herrn",
    polite: "Sehr geehrter Herr Mustermann",
    company: "Mustermann Industrie GmbH",
    color: "#7C5CE8",
    screenshot: "/demo-assets/website-max.png",
    slug: "max-mustermann",
    street: "Industriestraße 42",
    city: "85737 Ismaning",
  },
  {
    name: "Lisa Lust",
    first: "Lisa",
    salutation: "Frau",
    polite: "Sehr geehrte Frau Lust",
    company: "Lust Cosmetics GmbH",
    color: "#EC4899",
    screenshot: "/demo-assets/website-lisa.png",
    slug: "lisa-lust",
    street: "Schanzenstraße 14",
    city: "20357 Hamburg",
  },
  {
    name: "Franz Friedrich",
    first: "Franz",
    salutation: "Herrn",
    polite: "Sehr geehrter Herr Friedrich",
    company: "Friedrich Manufaktur",
    color: "#92400E",
    screenshot: "/demo-assets/website-franz.png",
    slug: "franz-friedrich",
    street: "Helmholtzstraße 16",
    city: "50825 Köln",
  },
  {
    name: "Sofia Reuter",
    first: "Sofia",
    salutation: "Frau",
    polite: "Sehr geehrte Frau Reuter",
    company: "Reuter Coaching",
    color: "#10B981",
    // Kein Screenshot-Asset — wird via Fallback gerendert
    screenshot: null,
    slug: "sofia-reuter",
    street: "Marienplatz 8",
    city: "70173 Stuttgart",
  },
] as const;

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export function HowItWorksSection() {
  const [step, setStep] = React.useState(0);
  const [manual, setManual] = React.useState(false);
  const [take, setTake] = React.useState(0);
  const [sceneId, setSceneId] = React.useState<SceneId>("website");
  const [templateId, setTemplateId] = React.useState<TemplateId>("soft");
  // Multiplikations-Animation in Step 4: 4 → 16 → 36 (6x6 = landscape cells)
  const [leadCount, setLeadCount] = React.useState<4 | 16 | 36>(4);

  React.useEffect(() => {
    if (manual) return;
    // Step 4 (Leadliste) braucht 8 s damit alle drei Stufen sichtbar werden,
    // die anderen 6 s.
    const dwell = step === 3 ? 8000 : 6000;
    const id = window.setTimeout(() => {
      setStep((s) => (s + 1) % STEPS.length);
    }, dwell);
    return () => window.clearTimeout(id);
  }, [manual, step]);

  // Multiplikations-Choreografie pro Step-Eintritt
  React.useEffect(() => {
    if (step !== 3) {
      setLeadCount(4);
      return;
    }
    setLeadCount(4);
    const t1 = window.setTimeout(() => setLeadCount(16), 2200);
    const t2 = window.setTimeout(() => setLeadCount(36), 4400);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, [step]);

  const onStepClick = (i: number) => {
    setStep(i);
    setManual(true);
  };

  return (
    <section
      id="how-it-works"
      className="relative z-[2] w-full bg-white py-24 md:py-32 rounded-t-[32px] md:rounded-t-[48px] -mt-8 md:-mt-12 shadow-[0_-20px_60px_-20px_rgba(0,0,0,0.45)]"
    >
      <div className="max-w-6xl mx-auto px-6 md:px-10">
        <div className="max-w-2xl mx-auto text-center mb-12">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-brand-soft text-brand-deep text-xs font-semibold mb-5">
            <Zap className="size-3.5" />
            So funktioniert es
          </div>
          <h2 className="text-4xl md:text-5xl font-bold tracking-[-0.025em] text-ink leading-[1.05] mb-5 text-balance">
            Sechs Schritte zur fertigen Kampagne.
          </h2>
          <p className="text-ink-muted text-lg leading-relaxed text-balance">
            Einmal aufgenommen, einmal aufgesetzt. Danach läuft jede neue
            Kampagne in Minuten.
          </p>
        </div>

        {/* Step pills */}
        <div className="flex flex-wrap items-center justify-center gap-2 mb-10">
          {STEPS.map((s, i) => {
            const isActive = i === step;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => onStepClick(i)}
                className={cn(
                  "inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium transition-all",
                  "focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40",
                  isActive
                    ? "bg-ink text-white shadow-md"
                    : "bg-surface-soft text-ink hover:bg-brand-soft hover:text-brand-deep",
                )}
                aria-current={isActive ? "step" : undefined}
              >
                <span
                  className={cn(
                    "font-mono text-[11px] font-bold",
                    isActive ? "text-brand-light" : "text-ink-muted",
                  )}
                >
                  0{i + 1}
                </span>
                <span>{s.title}</span>
              </button>
            );
          })}
        </div>

        {/* Stage + Side panel */}
        <div className="grid grid-cols-12 gap-6 items-start">
          <div className="col-span-12 lg:col-span-8">
            <Stage
              step={step}
              sceneId={sceneId}
              template={TEMPLATES.find((t) => t.id === templateId)!}
              leadCount={leadCount}
            />
          </div>

          <div className="col-span-12 lg:col-span-4">
            <SidePanel
              step={step}
              take={take}
              setTake={(t) => {
                setTake(t);
                setManual(true);
              }}
              sceneId={sceneId}
              setSceneId={(s) => {
                setSceneId(s);
                setManual(true);
              }}
              templateId={templateId}
              setTemplateId={(t) => {
                setTemplateId(t);
                setManual(true);
              }}
              manual={manual}
            />
          </div>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Side Panel
// ---------------------------------------------------------------------------

function SidePanel({
  step,
  take,
  setTake,
  sceneId,
  setSceneId,
  templateId,
  setTemplateId,
  manual,
}: {
  step: number;
  take: number;
  setTake: (t: number) => void;
  sceneId: SceneId;
  setSceneId: (s: SceneId) => void;
  templateId: TemplateId;
  setTemplateId: (t: TemplateId) => void;
  manual: boolean;
}) {
  const s = STEPS[step];

  return (
    <div className="flex flex-col gap-5">
      <div key={s.id} className="vc-fade-up">
        <div className="text-xs font-bold tracking-[0.22em] uppercase text-brand-deep mb-3">
          {s.eyebrow}
        </div>
        <h3 className="text-2xl md:text-3xl font-bold tracking-[-0.02em] text-ink leading-tight mb-3 text-balance">
          {s.headline}
        </h3>
        <p className="text-ink-muted leading-relaxed">{s.sub}</p>
      </div>

      {/* Selection area changes per step */}
      <div key={`sel-${s.id}`} className="vc-fade-up">
        {step === 0 ? (
          <SelectorTakes value={take} onChange={setTake} />
        ) : null}
        {step === 1 ? (
          <SelectorScenes value={sceneId} onChange={setSceneId} />
        ) : null}
        {step === 2 ? (
          <SelectorTemplates value={templateId} onChange={setTemplateId} />
        ) : null}
        {step === 3 ? <SelectorLeadList /> : null}
        {step === 4 ? <SelectorLetterInfo /> : null}
        {step === 5 ? <SelectorTrackingInfo /> : null}
      </div>

      {!manual ? (
        <div className="flex items-center gap-2 text-xs text-ink-muted">
          <span className="size-1.5 rounded-full bg-brand animate-pulse" />
          Auto-Demo läuft. Klick auf einen Schritt, um zu steuern.
        </div>
      ) : null}

      <style>{`
        @keyframes vc-fade-up-anim {
          0%   { opacity: 0; transform: translateY(8px); }
          100% { opacity: 1; transform: translateY(0); }
        }
        .vc-fade-up { animation: vc-fade-up-anim 0.45s cubic-bezier(0.2,0.8,0.2,1) forwards; }
      `}</style>
    </div>
  );
}

function SelectorTakes({
  value,
  onChange,
}: {
  value: number;
  onChange: (n: number) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      {TAKES.map((t) => {
        const active = t.id === value;
        return (
          <button
            key={t.id}
            type="button"
            onClick={() => onChange(t.id)}
            className={cn(
              "flex items-center gap-3 p-3 rounded-xl border transition-all text-left",
              "focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40",
              active
                ? "border-brand bg-brand-soft/50"
                : "border-line bg-white hover:border-brand/40",
            )}
          >
            <div
              className={cn(
                "shrink-0 size-10 rounded-full bg-gradient-to-br flex items-center justify-center text-white font-bold",
                t.grad,
              )}
            >
              {t.initials}
            </div>
            <div className="flex-1">
              <div className="text-sm font-semibold text-ink">{t.label}</div>
              <div className="text-xs text-ink-muted">{t.subtitle} · 1080p</div>
            </div>
            {active ? <CheckCircle2 className="size-4 text-brand" /> : null}
          </button>
        );
      })}
    </div>
  );
}

function SelectorScenes({
  value,
  onChange,
}: {
  value: SceneId;
  onChange: (s: SceneId) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-2">
      {SCENES.map((s) => {
        const active = s.id === value;
        return (
          <button
            key={s.id}
            type="button"
            onClick={() => onChange(s.id)}
            className={cn(
              "flex flex-col items-start gap-1.5 p-3 rounded-xl border transition-all text-left",
              active
                ? "border-brand bg-brand-soft/50"
                : "border-line bg-white hover:border-brand/40",
            )}
          >
            <span
              className={cn(
                active ? "text-brand-deep" : "text-ink-muted",
              )}
            >
              {s.icon}
            </span>
            <div>
              <div className="text-sm font-semibold text-ink">{s.label}</div>
              <div className="text-[11px] text-ink-muted">{s.sub}</div>
            </div>
          </button>
        );
      })}
    </div>
  );
}

function SelectorTemplates({
  value,
  onChange,
}: {
  value: TemplateId;
  onChange: (t: TemplateId) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      {TEMPLATES.map((t) => {
        const active = t.id === value;
        return (
          <button
            key={t.id}
            type="button"
            onClick={() => onChange(t.id)}
            className={cn(
              "flex items-center gap-3 p-3 rounded-xl border transition-all text-left",
              active
                ? "border-brand bg-brand-soft/50"
                : "border-line bg-white hover:border-brand/40",
            )}
          >
            <div
              className="shrink-0 size-12 rounded-lg overflow-hidden border border-line"
              style={{ backgroundColor: t.bg }}
            >
              <div
                className="h-1/2"
                style={{ backgroundColor: t.headerBg }}
              />
              <div
                className="h-1/2 flex items-center justify-center"
                style={{ backgroundColor: t.bg }}
              >
                <div
                  className="w-3/4 h-1 rounded-full"
                  style={{ backgroundColor: t.accent }}
                />
              </div>
            </div>
            <div className="flex-1">
              <div className="text-sm font-semibold text-ink">{t.label}</div>
              <div className="text-xs text-ink-muted">{t.sub}</div>
            </div>
            {active ? <CheckCircle2 className="size-4 text-brand" /> : null}
          </button>
        );
      })}
    </div>
  );
}

function SelectorLeadList() {
  return (
    <div className="rounded-xl border border-line bg-white overflow-hidden">
      <div className="px-3 py-2 bg-surface-soft border-b border-line flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ClipboardList className="size-3.5 text-brand-deep" />
          <span className="text-xs font-semibold text-ink">leads.csv</span>
        </div>
        <span className="text-[10px] font-mono text-ink-muted">743 Zeilen</span>
      </div>
      <table className="w-full text-xs">
        <tbody>
          {LEADS.map((l, i) => (
            <tr
              key={i}
              className="border-b border-line/60 last:border-b-0"
            >
              <td className="py-1.5 px-3 text-ink font-medium w-1/3">
                {l.first}
              </td>
              <td className="py-1.5 px-3 text-ink-soft">{l.company}</td>
            </tr>
          ))}
          <tr>
            <td colSpan={2} className="py-2 px-3 text-center text-[10px] text-ink-muted/70 italic">
              +739 weitere
            </td>
          </tr>
        </tbody>
      </table>
      <div className="px-3 py-2 border-t border-line bg-brand/5 flex items-center gap-2">
        <CheckCircle2 className="size-3 text-ok" />
        <span className="text-[11px] text-ink">Spalten erkannt</span>
      </div>
    </div>
  );
}

function SelectorLetterInfo() {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3 p-3 rounded-xl border border-line bg-white">
        <FileText className="size-5 text-brand-deep shrink-0" />
        <div className="flex-1">
          <div className="text-sm font-semibold text-ink">PDF-Bundle</div>
          <div className="text-xs text-ink-muted">3.631 druckfertige Briefe</div>
        </div>
      </div>
      <div className="flex items-center gap-3 p-3 rounded-xl border border-line bg-white">
        <ImageIcon className="size-5 text-brand-deep shrink-0" />
        <div className="flex-1">
          <div className="text-sm font-semibold text-ink">QR-Code drin</div>
          <div className="text-xs text-ink-muted">Direkt zum persönlichen Video</div>
        </div>
      </div>
      <div className="flex items-center gap-3 p-3 rounded-xl border border-line bg-white">
        <Mail className="size-5 text-brand-deep shrink-0" />
        <div className="flex-1">
          <div className="text-sm font-semibold text-ink">Anschriften vorbefüllt</div>
          <div className="text-xs text-ink-muted">Aus deiner Leadliste</div>
        </div>
      </div>
    </div>
  );
}

function SelectorTrackingInfo() {
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-3 gap-2">
        {[
          { l: "Öffnung", icon: <AtSign className="size-3" /> },
          { l: "Watch-Time", icon: <VideoIcon className="size-3" /> },
          { l: "CTA-Klick", icon: <MousePointerClick className="size-3" /> },
        ].map((k, i) => (
          <div
            key={i}
            className="p-2 rounded-lg border border-line bg-white text-center"
          >
            <div className="flex justify-center text-brand-deep mb-1">
              {k.icon}
            </div>
            <div className="text-[10px] font-semibold text-ink">{k.l}</div>
          </div>
        ))}
      </div>
      <div className="rounded-xl border border-line bg-white p-3">
        <div className="text-[10px] font-bold tracking-wider uppercase text-ink-muted mb-2">
          CRM-Sync optional
        </div>
        <div className="flex flex-wrap gap-1.5">
          {["HubSpot", "Salessuite", "Close", "Zapier", "Make"].map((c) => (
            <span
              key={c}
              className="px-2 py-0.5 rounded-md bg-surface-soft text-[10px] text-ink-soft border border-line"
            >
              {c}
            </span>
          ))}
        </div>
        <div className="mt-2 flex items-center gap-1.5 text-[10px] text-ink-muted">
          <Linkedin className="size-3" />
          Webhook-Event pro Aktion
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Stage
// ---------------------------------------------------------------------------

type Template = (typeof TEMPLATES)[number];

function Stage({
  step,
  sceneId,
  template,
  leadCount,
}: {
  step: number;
  sceneId: SceneId;
  template: Template;
  leadCount: 4 | 16 | 36;
}) {
  const webcamPos = computeWebcamPos(step, sceneId);
  const isSolo = sceneId === "solo";
  // Webcam-Sichtbarkeit:
  // - Step 4 (Leadliste): hidden — jede Multi-Grid-Karte rendert das Video selbst
  // - Step 5 (Brief), Step 6 (Tracking): hidden — Letter/Dashboard sprechen fuer sich
  const hideWebcam = step === 3 || step === 4 || step === 5;

  return (
    <div className="relative w-full aspect-[16/10] rounded-3xl overflow-hidden bg-gradient-to-br from-[#0F172A] via-[#1a1d35] to-[#0F172A] border border-line shadow-[0_30px_80px_-30px_rgba(15,23,42,0.35)]">
      {/* Subtle stars */}
      <div className="absolute inset-0 opacity-[0.15]" style={STARS_STYLE} />

      {/* Scene background — step 1 (full stage) */}
      <SceneLayer active={step === 1 && !isSolo} sceneId={sceneId} />

      {/* Landingpage — step 2, scene rendered inside the video slot */}
      <LandingPageLayer
        active={step === 2}
        template={template}
        lead={LEADS[0]}
        sceneId={sceneId}
      />

      {/* Multi grid — step 3 */}
      <MultiGridLayer
        active={step === 3}
        template={template}
        sceneId={sceneId}
        leadCount={leadCount}
      />

      {/* Letter — step 4 */}
      <LetterLayer active={step === 4} />

      {/* Tracking dashboard + push notifs — step 5 */}
      <TrackingLayer active={step === 5} />

      {/* Step badge top-left */}
      <div className="absolute top-4 left-4 z-30 flex items-center gap-2 px-3 py-1.5 rounded-full bg-black/45 backdrop-blur-md text-white text-[11px] font-mono tracking-wider">
        <span className="text-brand-light font-bold">0{step + 1}</span>
        <span className="opacity-60">/</span>
        <span className="opacity-60">06</span>
      </div>

      {/* Webcam — always mounted, position computed from step + sceneId */}
      <div
        className="absolute z-20"
        style={{
          top: webcamPos.top,
          left: webcamPos.left,
          width: webcamPos.width,
          ...(webcamPos.height
            ? { height: webcamPos.height }
            : { aspectRatio: webcamPos.aspectRatio }),
          borderRadius: webcamPos.borderRadius,
          opacity: hideWebcam ? 0 : 1,
          pointerEvents: hideWebcam ? "none" : undefined,
          transition:
            "top 700ms cubic-bezier(0.65,0,0.35,1), left 700ms cubic-bezier(0.65,0,0.35,1), width 700ms cubic-bezier(0.65,0,0.35,1), height 700ms cubic-bezier(0.65,0,0.35,1), border-radius 700ms cubic-bezier(0.65,0,0.35,1), box-shadow 700ms, opacity 400ms",
          overflow: "hidden",
          boxShadow: webcamPos.boxShadow,
        }}
      >
        <video
          src="/demo-assets/webcam.mp4"
          muted
          autoPlay
          loop
          playsInline
          preload="auto"
          disableRemotePlayback
          disablePictureInPicture
          className="block w-full h-full object-cover"
        />
      </div>
    </div>
  );
}

type WebcamPos = {
  top: string;
  left: string;
  width: string;
  height?: string;
  aspectRatio?: string;
  borderRadius: string;
  boxShadow: string;
};

const PIP_SHADOW =
  "0 0 0 4px rgba(255,255,255,0.92), 0 18px 36px -12px rgba(15,23,42,0.55)";
const FLAT_SHADOW = "0 18px 36px -12px rgba(15,23,42,0.55)";

function computeWebcamPos(step: number, sceneId: SceneId): WebcamPos {
  const isSolo = sceneId === "solo";

  if (step === 0) {
    // Zentriert großer Kreis
    return {
      top: "16%",
      left: "33%",
      width: "34%",
      aspectRatio: "1/1",
      borderRadius: "9999px",
      boxShadow: PIP_SHADOW,
    };
  }

  if (step === 1) {
    // Solo = Vollbild über Stage, kein Border-Radius
    if (isSolo) {
      return {
        top: "0%",
        left: "0%",
        width: "100%",
        height: "100%",
        borderRadius: "0px",
        boxShadow: "none",
      };
    }
    // Mit Szene = PiP-Kreis unten links
    return {
      top: "62%",
      left: "5%",
      width: "16%",
      aspectRatio: "1/1",
      borderRadius: "9999px",
      boxShadow: PIP_SHADOW,
    };
  }

  if (step === 2) {
    // LP-Video-Slot Bounds (Stage-%):
    //   top 28%, left 57%, width 36%, height ~50% → aspectRatio 4/3 angenähert
    if (isSolo) {
      // Webcam füllt den ganzen Slot
      return {
        top: "28%",
        left: "57%",
        width: "36%",
        height: "55%",
        borderRadius: "20px",
        boxShadow: FLAT_SHADOW,
      };
    }
    // Sonst: PiP-Kreis bottom-left INNERHALB des Slots, Szene darunter sichtbar
    return {
      top: "62%",
      left: "60%",
      width: "12%",
      aspectRatio: "1/1",
      borderRadius: "9999px",
      boxShadow: PIP_SHADOW,
    };
  }

  if (step === 3) {
    // Erste Multi-Grid-Kachel oben links — Video-Slot innerhalb (Stage-%):
    //   top 18%, left 28%, width 19%, height 22%
    if (isSolo) {
      return {
        top: "18%",
        left: "28%",
        width: "19%",
        height: "22%",
        borderRadius: "8px",
        boxShadow: FLAT_SHADOW,
      };
    }
    return {
      top: "32%",
      left: "30%",
      width: "9%",
      aspectRatio: "1/1",
      borderRadius: "9999px",
      boxShadow: PIP_SHADOW,
    };
  }

  // 4 + 5: kleines PiP oben rechts
  return {
    top: "8%",
    left: "82%",
    width: "12%",
    aspectRatio: "1/1",
    borderRadius: "9999px",
    boxShadow: PIP_SHADOW,
  };
}

// ---------------------------------------------------------------------------
// Stage Layers
// ---------------------------------------------------------------------------

function SceneLayer({
  active,
  sceneId,
}: {
  active: boolean;
  sceneId: SceneId;
}) {
  return (
    <div
      className="absolute inset-0 transition-opacity duration-700"
      style={{ opacity: active ? 1 : 0 }}
    >
      {sceneId === "website" ? <SceneWebsite /> : null}
      {sceneId === "slides" ? <SceneSlides /> : null}
      {sceneId === "doc" ? <SceneDoc /> : null}
      {sceneId === "solo" ? <SceneSolo /> : null}
    </div>
  );
}

function SceneWebsite() {
  return (
    <>
      <img
        src="/demo-assets/website-max.png"
        alt=""
        aria-hidden
        className="w-full h-full object-cover object-top"
      />
      <div
        className="absolute inset-0"
        style={{
          background:
            "linear-gradient(180deg, rgba(0,0,0,0.2) 0%, transparent 35%, transparent 70%, rgba(0,0,0,0.45) 100%)",
        }}
      />
    </>
  );
}

function SceneSlides() {
  return (
    <div className="absolute inset-0 bg-gradient-to-br from-[#F3EEFF] via-[#FFFFFF] to-[#F8FAFC] flex items-center justify-center">
      <div className="text-center px-12">
        <div className="text-xs font-bold tracking-[0.3em] text-brand-deep mb-4 uppercase">
          Persönliches Pitch-Deck
        </div>
        <div className="text-5xl md:text-6xl font-extrabold text-ink leading-[1.05]">
          Video für
          <br />
          <span className="text-brand-deep">Max Mustermann</span>
        </div>
        <div className="text-sm text-ink-muted mt-4">
          Mustermann Industrie GmbH · München
        </div>
      </div>
    </div>
  );
}

function SceneDoc() {
  // Identisch zum SceneInline-Doc-Renderer, nur full-stage (compact=false).
  // Bringt die echte Google-Docs-UI (Top-Bar mit Datei-Icon + Title + Menue
  // + Teilen-Button + Avatar, Toolbar mit Format-Icons, Dokument-Area).
  return (
    <div className="absolute inset-0">
      <SceneDocGoogleDocs lead={LEADS[0]} compact={false} />
    </div>
  );
}

function SceneSolo() {
  return (
    <div className="absolute inset-0 bg-gradient-to-br from-[#0F172A] via-[#1a1d35] to-[#0F172A]" />
  );
}

// ---------------------------------------------------------------------------
// Landingpage Layer — clean, two-col hero, video right
// ---------------------------------------------------------------------------

function LandingPageLayer({
  active,
  template,
  lead,
  sceneId,
}: {
  active: boolean;
  template: Template;
  lead: (typeof LEADS)[number];
  sceneId: SceneId;
}) {
  return (
    <div
      className="absolute inset-0 transition-opacity duration-700 z-10"
      style={{ opacity: active ? 1 : 0, pointerEvents: "none" }}
    >
      <LandingPageInner
        template={template}
        lead={lead}
        videoSlot
        fullSize
        sceneId={sceneId}
      />
    </div>
  );
}

function LandingPageInner({
  template,
  lead,
  videoSlot,
  fullSize,
  sceneId,
}: {
  template: Template;
  lead: (typeof LEADS)[number];
  videoSlot: boolean;
  fullSize: boolean;
  sceneId: SceneId;
}) {
  return (
    <div
      className="absolute inset-0 flex flex-col"
      style={{ backgroundColor: template.bg }}
    >
      {/* Browser chrome */}
      <div className="shrink-0 h-7 bg-white/95 backdrop-blur flex items-center px-3 gap-2 border-b border-black/5">
        <div className="flex gap-1">
          <div className="size-1.5 rounded-full bg-red-400" />
          <div className="size-1.5 rounded-full bg-yellow-400" />
          <div className="size-1.5 rounded-full bg-green-400" />
        </div>
        <div className="flex-1 h-4 mx-2 rounded bg-surface-soft text-[8px] text-ink-muted flex items-center px-2 font-mono">
          videocomet.de/lp/{lead.first.toLowerCase()}-{lead.company.toLowerCase().split(" ")[0]}
        </div>
      </div>

      {/* Header */}
      <div
        className="shrink-0 flex items-center px-5 py-3 border-b"
        style={{
          backgroundColor: template.headerBg,
          borderColor:
            template.id === "bold" ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)",
        }}
      >
        <div className="flex items-center gap-2">
          <div
            className="size-5 rounded"
            style={{ backgroundColor: template.accent }}
          />
          <div
            className={cn(
              "text-[10px] font-extrabold tracking-wider uppercase",
            )}
            style={{ color: template.text }}
          >
            Dein Logo
          </div>
        </div>
        <div className="ml-auto flex items-center gap-4">
          {["Home", "Über", "Kontakt"].map((n) => (
            <span
              key={n}
              className="text-[10px] font-medium"
              style={{ color: template.textMuted }}
            >
              {n}
            </span>
          ))}
        </div>
      </div>

      {/* Hero — two columns */}
      <div className="flex-1 flex items-center px-6 py-4 gap-6">
        <div className="flex-1 max-w-[55%]">
          <div
            className={cn(
              "text-[9px] font-extrabold tracking-[0.22em] uppercase mb-2",
              fullSize ? "" : "mb-1",
            )}
            style={{ color: template.accent }}
          >
            Persönlich für dich
          </div>
          <div
            className={cn(
              fullSize ? "text-2xl md:text-3xl" : "text-xs",
              "font-extrabold leading-[1.05] mb-2",
            )}
            style={{ color: template.text }}
          >
            {lead.first},
            <br />
            schau dir das an.
          </div>
          <div
            className={cn(fullSize ? "text-xs" : "text-[8px]", "leading-relaxed")}
            style={{ color: template.textMuted }}
          >
            {fullSize ? (
              <>
                Ich hab mir kurz {lead.company} angesehen und drei Sachen
                aufgeschrieben, die dir gerade Anfragen kosten. Schau es dir an,
                wenn du Lust hast.
              </>
            ) : (
              <>Drei Punkte zu {lead.company}.</>
            )}
          </div>
          <div
            className={cn(
              "mt-3 inline-flex items-center font-bold rounded-full",
              fullSize ? "text-[11px] px-3 py-1.5" : "text-[7px] px-1.5 py-0.5",
            )}
            style={{ backgroundColor: template.ctaBg, color: template.ctaText }}
          >
            Termin sichern →
          </div>
        </div>

        {/* Video slot — Scene fillt das, Webcam liegt von außen als PiP drüber */}
        {videoSlot ? (
          <div className="flex-1 max-w-[40%]">
            <div
              className={cn(
                "relative w-full overflow-hidden",
                fullSize ? "rounded-2xl" : "rounded-md",
              )}
              style={{
                aspectRatio: "4/3",
                backgroundColor:
                  template.id === "bold"
                    ? "rgba(255,255,255,0.05)"
                    : "rgba(0,0,0,0.04)",
              }}
            >
              {sceneId !== "solo" ? (
                <SceneInline sceneId={sceneId} compact={!fullSize} lead={lead} />
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

type LeadLike = (typeof LEADS)[number];

/**
 * Scene gerendert in einem beliebigen Container (Video-Slot). Skaliert mit
 * und nimmt eine Lead-Identitaet an — Website-Screenshot wechselt pro
 * Lead (Mustermann / Lust / Friedrich / Reuter-Fallback), die Folien-
 * und Doc-Mocks zeigen den Vornamen/Firmennamen entsprechend.
 */
function SceneInline({
  sceneId,
  compact,
  lead,
}: {
  sceneId: SceneId;
  compact: boolean;
  lead: LeadLike;
}) {
  if (sceneId === "website") {
    if (lead.screenshot) {
      return (
        <img
          src={lead.screenshot}
          alt=""
          aria-hidden
          className="w-full h-full object-cover object-top"
        />
      );
    }
    // Sofia hat (noch) keinen Screenshot → stilisierter Reuter-Coaching-Mock
    return <FallbackWebsite lead={lead} />;
  }
  if (sceneId === "slides") {
    return (
      <div className="w-full h-full bg-gradient-to-br from-[#F3EEFF] to-white flex items-center justify-center px-2">
        <div className="text-center">
          <div
            className={cn(
              "font-bold tracking-[0.2em] uppercase mb-1",
              compact ? "text-[6px]" : "text-[9px]",
            )}
            style={{ color: lead.color }}
          >
            Persönlich
          </div>
          <div
            className={cn(
              "font-extrabold text-ink leading-[1.05]",
              compact ? "text-[10px]" : "text-base md:text-lg",
            )}
          >
            Video für
            <br />
            <span style={{ color: lead.color }}>{lead.name}</span>
          </div>
        </div>
      </div>
    );
  }
  if (sceneId === "doc") {
    return <SceneDocGoogleDocs lead={lead} compact={compact} />;
  }
  return null;
}

/**
 * Doc-Scene mit echter Google-Docs-UI: blaues Datei-Icon + Titel +
 * Datei/Bearbeiten/Ansicht-Menue + Teilen-Button + Toolbar mit Format-
 * Icons. Dokument selbst zentriert mit Lead-Personalisierung.
 */
function SceneDocGoogleDocs({
  lead,
  compact,
}: {
  lead: LeadLike;
  compact: boolean;
}) {
  const domain = `${lead.company
    .toLowerCase()
    .replace(/\s+gmbh/i, "")
    .replace(/\s+/g, "-")}.de`;
  return (
    <div
      className="w-full h-full flex flex-col"
      style={{ backgroundColor: "#F1F3F4" }}
    >
      {/* Top bar */}
      <div
        className="shrink-0 flex items-center bg-white border-b border-[#DADCE0]"
        style={{ height: compact ? 18 : 28, padding: "0 6px", gap: 6 }}
      >
        {/* Google Docs Datei-Icon */}
        <div
          className="rounded-[2px] flex items-center justify-center font-bold text-white"
          style={{
            width: compact ? 12 : 18,
            height: compact ? 12 : 18,
            backgroundColor: "#4285F4",
            fontSize: compact ? 8 : 12,
          }}
        >
          ≡
        </div>
        <div className="flex-1 min-w-0 leading-none">
          <div
            className="font-medium text-[#202124] truncate"
            style={{ fontSize: compact ? 7 : 10 }}
          >
            Notiz für {lead.first}
          </div>
          {!compact ? (
            <div className="flex gap-2 mt-0.5 text-[7px] text-[#5F6368]">
              <span>Datei</span>
              <span>Bearbeiten</span>
              <span>Ansicht</span>
              <span>Einfügen</span>
              <span>Hilfe</span>
            </div>
          ) : null}
        </div>
        {!compact ? (
          <>
            <div
              className="text-white font-medium rounded"
              style={{
                backgroundColor: "#1A73E8",
                fontSize: 7,
                padding: "2px 6px",
              }}
            >
              Teilen
            </div>
            <div
              className="rounded-full"
              style={{
                width: 14,
                height: 14,
                background: "linear-gradient(135deg,#AA8CF5,#7C5CE8)",
              }}
            />
          </>
        ) : null}
      </div>

      {/* Toolbar */}
      <div
        className="shrink-0 flex items-center bg-white border-b border-[#DADCE0]"
        style={{ height: compact ? 12 : 18, padding: "0 6px", gap: 5 }}
      >
        {["↶", "↷", "100%", "B", "I", "U", "🎨", "▦", "🔗"].map((k, i) => (
          <span
            key={i}
            className="text-[#5F6368]"
            style={{
              fontSize: compact ? 5 : 8,
              fontWeight: k === "B" ? 700 : 400,
              fontStyle: k === "I" ? "italic" : "normal",
              textDecoration: k === "U" ? "underline" : "none",
            }}
          >
            {k}
          </span>
        ))}
      </div>

      {/* Document area — voll gefuellt wie in der Live-Demo: Title +
          Subline + Trennlinie + Greeting + Body-Lines + 3 rote Findings +
          Closing + Signatur-Block */}
      <div
        className="flex-1 flex justify-center overflow-y-hidden"
        style={{ padding: compact ? "6px" : "16px", backgroundColor: "#F8F9FA" }}
      >
        <div
          className="bg-white shadow-sm flex flex-col gap-1.5"
          style={{
            width: "78%",
            padding: compact ? "8px 12px" : "20px 32px",
          }}
        >
          {/* Top accent */}
          <div
            className="rounded"
            style={{
              height: 2,
              width: compact ? 18 : 36,
              backgroundColor: lead.color,
            }}
          />

          {/* Title */}
          <div
            className="font-bold text-ink leading-tight"
            style={{ fontSize: compact ? 8 : 18 }}
          >
            Notiz für {lead.first}
          </div>

          {/* Subline */}
          <div
            className="text-ink-muted"
            style={{ fontSize: compact ? 5 : 9 }}
          >
            Schnell-Check für {domain}
          </div>

          {/* Trennlinie */}
          <div
            className="my-1"
            style={{ height: 1, backgroundColor: "#E2E8F0" }}
          />

          {/* Greeting */}
          <div
            className="font-medium text-ink"
            style={{ fontSize: compact ? 5 : 9, marginTop: compact ? 0 : 4 }}
          >
            Hey {lead.first},
          </div>

          {/* Body line cluster 1 — "Ich habe deine Seite angeschaut..." */}
          <div className="space-y-0.5">
            <div className="h-0.5 bg-ink/15 w-full rounded" />
            <div className="h-0.5 bg-ink/15 w-[95%] rounded" />
            <div className="h-0.5 bg-ink/15 w-[88%] rounded" />
          </div>

          {/* 3 rote Findings (kompakt) */}
          {[1, 2, 3].map((n) => (
            <div
              key={n}
              className="rounded border-l-2 border-red-400 bg-red-50 flex items-center gap-1"
              style={{
                padding: compact ? "1px 4px" : "4px 8px",
                marginTop: compact ? 1 : 2,
              }}
            >
              <span
                className="font-bold text-red-900 rounded-full bg-red-500 text-white flex items-center justify-center shrink-0"
                style={{
                  fontSize: compact ? 4 : 7,
                  width: compact ? 6 : 12,
                  height: compact ? 6 : 12,
                }}
              >
                {n}
              </span>
              <div
                className="font-bold text-red-900 truncate"
                style={{ fontSize: compact ? 5 : 8 }}
              >
                {n === 1
                  ? "Kein Datenblatt zum Download"
                  : n === 2
                    ? "Keine echten Fallstudien"
                    : "Stockfoto im Hero-Bild"}
              </div>
            </div>
          ))}

          {/* Body line cluster 2 — Schluss */}
          <div className="space-y-0.5" style={{ marginTop: compact ? 2 : 6 }}>
            <div className="h-0.5 bg-ink/15 w-full rounded" />
            <div className="h-0.5 bg-ink/15 w-[80%] rounded" />
          </div>

          {/* Closing */}
          {!compact ? (
            <div
              className="text-ink mt-2"
              style={{ fontSize: 9, fontStyle: "italic" }}
            >
              Lieben Gruß
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/**
 * Platzhalter-Webseite fuer Leads ohne eigenen Screenshot (z. B. Sofia).
 * Wird wie ein Mini-Hero gerendert.
 */
function FallbackWebsite({ lead }: { lead: LeadLike }) {
  const company = lead.company.replace(/\s+GmbH/i, "");
  return (
    <div
      className="w-full h-full flex flex-col"
      style={{
        background: `linear-gradient(135deg, ${lead.color}25 0%, ${lead.color}10 50%, #FFFFFF 100%)`,
      }}
    >
      <div
        className="h-5 bg-white/95 flex items-center px-2 gap-1 border-b border-black/5"
      >
        <div
          className="size-2 rounded-sm"
          style={{ backgroundColor: lead.color }}
        />
        <span
          className="text-[6px] font-extrabold tracking-wider uppercase truncate"
          style={{ color: lead.color }}
        >
          {company}
        </span>
      </div>
      <div className="flex-1 px-2 py-2 flex flex-col justify-center">
        <div
          className="text-[5px] font-bold tracking-[0.2em] uppercase mb-1"
          style={{ color: lead.color }}
        >
          Coaching & Training
        </div>
        <div className="text-[9px] font-extrabold text-ink leading-[1.05] mb-1">
          Mehr Fokus.
          <br />
          Mehr Klarheit.
        </div>
        <div className="text-[6px] text-ink-muted leading-tight mb-1">
          Persönliches 1:1 Coaching aus {lead.city.split(" ").slice(1).join(" ")}.
        </div>
        <div
          className="inline-block self-start text-[6px] font-bold text-white rounded px-1.5 py-0.5"
          style={{ backgroundColor: lead.color }}
        >
          Termin buchen →
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Multi-grid Layer — 2x2 of the same LP, different names
// ---------------------------------------------------------------------------

// Generische Lead-Pool fuer die Multiplikations-Animation. Die ersten 4
// sind die Haupt-Leads (mit echtem Screenshot etc.), die naechsten 28
// sind variantenreiche deutsche Namen + Firmennamen damit man visuell
// erkennt: jede Karte = ein anderer Lead.
const EXTRA_PEOPLE = [
  { first: "Daniel", company: "Kessler Agentur" },
  { first: "Fabian", company: "Wagner Solutions" },
  { first: "Stefan", company: "Reuter Beratung" },
  { first: "Franziska", company: "Klein Werkstatt" },
  { first: "Saskia", company: "Berger Studio" },
  { first: "Tobias", company: "Hoffmann Software" },
  { first: "Anna", company: "König Wellness" },
  { first: "Mira", company: "Schmidt Manufaktur" },
  { first: "Tim", company: "Berger Bau" },
  { first: "Julia", company: "Roth Design" },
  { first: "Hannah", company: "Vogel Praxis" },
  { first: "Leo", company: "Lang Maschinen" },
  { first: "Eva", company: "Maier Service" },
  { first: "Niko", company: "Brandt Labor" },
  { first: "Clara", company: "Schulze Holding" },
  { first: "Paul", company: "Krüger Tech" },
  { first: "Lena", company: "Becker Coaching" },
  { first: "Jan", company: "Meier Markt" },
  { first: "Tina", company: "Engel Studio" },
  { first: "Felix", company: "Walter Group" },
  { first: "Mona", company: "Adler Werke" },
  { first: "Rolf", company: "Voss Logistik" },
  { first: "Linda", company: "Frank Atelier" },
  { first: "Bernd", company: "Otto Sanierung" },
  { first: "Vera", company: "Sommer Stoffe" },
  { first: "Dirk", company: "Lehmann Holz" },
  { first: "Ines", company: "Brunner Beton" },
  { first: "Olaf", company: "Werner Steuern" },
  { first: "David", company: "Schäfer Beratung" },
  { first: "Nina", company: "Bauer Werbung" },
  { first: "Robert", company: "Schröder Anlagen" },
  { first: "Sarah", company: "Huber Naturkost" },
];

const EXTENDED_LEADS = (() => {
  const PALETTE = [
    "#7C5CE8", "#EC4899", "#92400E", "#10B981",
    "#FBBF24", "#3B82F6", "#EF4444", "#8B5CF6",
    "#06B6D4", "#F97316", "#84CC16", "#A855F7",
  ];
  return Array.from({ length: 36 }, (_, i) => {
    if (i < 4) return LEADS[i];
    const p = EXTRA_PEOPLE[(i - 4) % EXTRA_PEOPLE.length];
    const base = LEADS[i % 4];
    return {
      ...base,
      first: p.first,
      company: p.company,
      color: PALETTE[i % PALETTE.length],
    } as LeadLike;
  });
})();

function MultiGridLayer({
  active,
  template,
  sceneId,
  leadCount,
}: {
  active: boolean;
  template: Template;
  sceneId: SceneId;
  leadCount: 4 | 16 | 36;
}) {
  const isSolo = sceneId === "solo";
  const leads = EXTENDED_LEADS.slice(0, leadCount);
  // Grid-Layout pro Phase — alle Cells im Querformat (1.6:1, matched Stage)
  //   4  =  2x2 → Cell 8:5 / 4 = 1.6:1  ✓
  //  16  =  4x4 → Cell 4:2.5 = 1.6:1   ✓
  //  36  =  6x6 → Cell 2.67:1.67 = 1.6:1  ✓
  const gridClass =
    leadCount === 4
      ? "grid-cols-2 grid-rows-2 gap-2"
      : leadCount === 16
        ? "grid-cols-4 grid-rows-4 gap-1.5"
        : "grid-cols-6 grid-rows-6 gap-1";

  return (
    <div
      className="absolute inset-0 z-10 p-3 transition-opacity duration-700"
      style={{ opacity: active ? 1 : 0, pointerEvents: "none" }}
    >
      <div
        className={cn(
          "grid w-full h-full transition-all duration-500",
          gridClass,
        )}
      >
        {leads.map((l, i) => (
          <div
            key={`${l.name}-${i}`}
            className={cn(
              "relative overflow-hidden border border-line transition-all duration-500",
              leadCount === 4
                ? "rounded-xl"
                : leadCount === 16
                  ? "rounded-md"
                  : "rounded-sm",
            )}
            style={{
              backgroundColor: template.bg,
              transitionDelay: `${Math.min(i * 30, 800)}ms`,
              opacity: active ? 1 : 0,
              transform: active ? "scale(1)" : "scale(0.94)",
              containerType: "size",
            }}
          >
            {/* Intrinsisch immer 480x320 gerendert (volle LP wie in Step 3,
                fullSize=true). Per transform:scale() proportional auf die
                Card-Groesse runtergerechnet via Container-Queries. Damit
                schrumpfen Text, Padding, Slot UND Webcam-PiP exakt gleich.
                User-Anforderung: "exakt das Frame, wie bei 03, nur halt viel
                kleiner skalieren. Alles." */}
            <div
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: 480,
                height: 320,
                transformOrigin: "top left",
                transform:
                  "scale(max(calc(100cqw / 480px), calc(100cqh / 320px)))",
              }}
            >
              <LandingPageInner
                template={template}
                lead={l}
                videoSlot
                fullSize
                sceneId={sceneId}
              />
              {/* Webcam sitzt INNERHALB des skalierten Wrappers — bei Solo
                  fuellt sie den ganzen Video-Slot, sonst PiP-Kreis bottom-
                  left des Slots. Skaliert automatisch mit. */}
              <CellWebcam isSolo={isSolo} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Identisches Webcam-Element pro Karte. Position/Geometrie haengt vom
 * leadCount-Modus ab.
 */
function CellWebcam({ isSolo }: { isSolo: boolean }) {
  // Webcam-PiP sitzt bei JEDEM Layout an derselben relativen Position
  // im LP-Video-Slot. Bei Solo fuellt die Webcam den ganzen Slot.
  const style: React.CSSProperties = isSolo
    ? {
        top: "30%",
        left: "58%",
        width: "36%",
        height: "44%",
        borderRadius: "6px",
        boxShadow: "0 6px 14px -4px rgba(15,23,42,0.3)",
      }
    : {
        top: "60%",
        left: "60%",
        width: "10%",
        aspectRatio: "1/1",
        borderRadius: "9999px",
        boxShadow:
          "0 0 0 1.5px rgba(255,255,255,0.92), 0 3px 8px rgba(15,23,42,0.45)",
      };

  return (
    <div className="absolute overflow-hidden" style={style}>
      <video
        src="/demo-assets/webcam.mp4"
        muted
        autoPlay
        loop
        playsInline
        preload="auto"
        disableRemotePlayback
        disablePictureInPicture
        className="block w-full h-full object-cover"
      />
    </div>
  );
}

/**
 * Sehr kompakte Lead-Karte fuer 16er-/32er-Grid. Zeigt nur Color-Strip
 * mit Lead-Initial + ggf. winziger Scene-Preview. Performance-freundlich:
 * keine eigenen Videos, keine kleinteilige Typografie die sowieso unlesbar
 * waere.
 */
function ThumbnailCard({
  lead,
  minimal,
}: {
  lead: LeadLike;
  minimal: boolean;
}) {
  // Mini-Landingpage-Anmutung pro Lead: Top-Accent + Body-Hintergrund +
  // Bottom-Pseudo-CTA. Der Webcam-Video-Kreis liegt darueber per CellWebcam.
  return (
    <div
      className="w-full h-full relative flex flex-col"
      style={{
        background: `linear-gradient(180deg, ${lead.color}30 0%, ${lead.color}10 100%)`,
      }}
    >
      <div
        className={minimal ? "h-1" : "h-1.5"}
        style={{ backgroundColor: lead.color }}
      />
      <div className="flex-1" />
      <div
        className="h-0.5 mx-1 mb-0.5 rounded"
        style={{ backgroundColor: `${lead.color}80` }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Letter Layer — realistic A4 letter to Max Mustermann
// ---------------------------------------------------------------------------

function LetterLayer({ active }: { active: boolean }) {
  // Letter-Stack: Front-Brief = Max (scharf), die anderen 3 progressiv
  // versetzt + zunehmend geblurrt nach hinten. Zeigt: pro Lead ein Brief.
  const STACK = [
    {
      lead: LEADS[3],
      offsetX: "16%",
      offsetY: "6%",
      rotate: "10deg",
      blur: 10,
      opacity: 0.5,
      scale: 0.96,
    },
    {
      lead: LEADS[2],
      offsetX: "10%",
      offsetY: "3%",
      rotate: "6deg",
      blur: 6,
      opacity: 0.7,
      scale: 0.98,
    },
    {
      lead: LEADS[1],
      offsetX: "5%",
      offsetY: "1%",
      rotate: "3deg",
      blur: 3,
      opacity: 0.85,
      scale: 0.99,
    },
    {
      lead: LEADS[0],
      offsetX: "0%",
      offsetY: "0%",
      rotate: "0deg",
      blur: 0,
      opacity: 1,
      scale: 1,
    },
  ];

  return (
    <div
      className="absolute inset-0 z-10 flex items-center justify-center transition-opacity duration-700"
      style={{ opacity: active ? 1 : 0, pointerEvents: "none" }}
    >
      <div className="relative h-[88%] aspect-[210/297]">
        {STACK.map((s, i) => (
          <div
            key={i}
            className="absolute inset-0"
            style={{
              transform: `translate(${s.offsetX}, ${s.offsetY}) rotate(${s.rotate}) scale(${s.scale})`,
              filter: s.blur > 0 ? `blur(${s.blur}px)` : "none",
              opacity: s.opacity,
              transition: "transform 700ms, opacity 700ms",
              zIndex: i,
            }}
          >
            <RealisticLetter lead={s.lead} />
          </div>
        ))}
      </div>
    </div>
  );
}

function RealisticLetter({ lead }: { lead: LeadLike }) {
  // DIN-A4-Brief im Lückentext-Stil: Strukturelle Rahmen-Texte (Anrede,
  // Schluss, Signatur etc.) sind echt, Fließtext-Bereiche werden als
  // graue Platzhalter-Zeilen ("Lückentext") dargestellt. Variable
  // Platzhalter wie {Vorname}/{Firma} sind farblich hervorgehoben.
  // QR-Code sitzt unten in seiner eigenen rechten Spalte, ueberlappt
  // NICHTS — Text fliesst um ihn herum, weil Layout zweispaltig endet.
  return (
    <div
      className="relative w-full h-full bg-white shadow-[0_30px_60px_-20px_rgba(15,23,42,0.4)] flex flex-col"
      style={{
        fontFamily: "'Inter', -apple-system, sans-serif",
        color: "#0F172A",
        padding: "8% 9% 7% 9%",
      }}
    >
      {/* DIN 5008: Absender klein über Adresse */}
      <div
        className="text-[6px] leading-tight pb-1 mb-1 border-b"
        style={{ color: "#94A3B8", borderColor: "#E2E8F0" }}
      >
        <Placeholder>{`{Deine Firma GmbH · Strasse · PLZ Stadt}`}</Placeholder>
      </div>

      {/* Adressfeld + Datum */}
      <div className="flex justify-between mt-3 mb-5">
        <div className="text-[9px] leading-[1.35]">
          {lead.salutation}
          <br />
          <strong>
            <Placeholder>{`{${lead.name}}`}</Placeholder>
          </strong>
          <br />
          <Placeholder>{`{${lead.company}}`}</Placeholder>
          <br />
          <Placeholder>{`{${lead.street}}`}</Placeholder>
          <br />
          <Placeholder>{`{${lead.city}}`}</Placeholder>
        </div>
        <div className="text-[8px] text-right" style={{ color: "#475569" }}>
          {`{Stadt}, {Datum}`}
        </div>
      </div>

      {/* Betreff (echt) */}
      <div className="text-[10px] font-bold mb-3">
        <Placeholder>{`{Betreff-Zeile}`}</Placeholder>
      </div>

      {/* Anrede (mix aus echt + Platzhalter) */}
      <div className="text-[9px] mb-3">
        <Placeholder>{`{${lead.polite}}`}</Placeholder>,
      </div>

      {/* Fließtext als Lückentext — graue Linien stehen fuer
          frei formulierbaren Inhalt */}
      <div className="space-y-1.5 mb-3">
        <BodyLine width="100%" />
        <BodyLine width="96%" />
        <BodyLine width="88%" />
      </div>
      <div className="space-y-1.5 mb-3">
        <BodyLine width="100%" />
        <BodyLine width="92%" />
      </div>

      {/* URL-Block (echt, weil personalisiert wichtig) */}
      <div
        className="text-[9px] font-mono font-bold mb-3 px-2.5 py-1.5 rounded inline-flex items-center self-start"
        style={{ backgroundColor: "#F3EEFF", color: "#5232C7" }}
      >
        videocomet.de/lp/{lead.slug}
      </div>

      {/* Ein letzter Lückentext-Block fuer Restinhalt */}
      <div className="space-y-1.5 mb-4">
        <BodyLine width="84%" />
        <BodyLine width="60%" />
      </div>

      {/* Spacer schiebt Footer nach unten */}
      <div className="flex-1" />

      {/* Footer: links = Closing + Signatur, rechts = QR-Code.
          Beide in flex, kein absolute, also kein Overlap moeglich. */}
      <div className="flex items-end gap-4">
        <div className="flex-1 min-w-0">
          <div className="text-[9px] mb-3">Mit besten Grüßen</div>
          <div
            className="text-[14px] italic mb-0.5"
            style={{ fontFamily: "'Georgia', 'Times New Roman', serif" }}
          >
            <Placeholder>{`{Dein Name}`}</Placeholder>
          </div>
          <div className="text-[7px]" style={{ color: "#94A3B8" }}>
            <Placeholder>{`{Deine Firma GmbH}`}</Placeholder>
          </div>
        </div>
        <div className="shrink-0 flex flex-col items-center gap-1">
          <div
            style={{
              padding: 3,
              backgroundColor: "white",
              border: "1px solid #E2E8F0",
              borderRadius: 2,
            }}
          >
            <RealQrCode
              value={`https://app.videocomet.de/lp/${lead.slug}`}
              size={52}
            />
          </div>
          <div
            className="text-[6px] text-center"
            style={{ color: "#94A3B8" }}
          >
            Direkt zum Video
          </div>
        </div>
      </div>
    </div>
  );
}

/** Platzhalter-Token wie {Vorname} — wird visuell als gefuellter
 *  Mini-Chip gerendert damit sofort erkennbar ist: das ist variabel. */
function Placeholder({ children }: { children: React.ReactNode }) {
  return (
    <span
      style={{
        backgroundColor: "#F3EEFF",
        color: "#5232C7",
        padding: "0 4px",
        borderRadius: 3,
        fontFamily: "'JetBrains Mono', monospace",
        fontWeight: 600,
        fontSize: "0.92em",
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </span>
  );
}

/** Eine graue Linie steht fuer "hier kommt dein Text". */
function BodyLine({ width }: { width: string }) {
  return (
    <div
      style={{
        width,
        height: 4,
        borderRadius: 2,
        backgroundColor: "#E2E8F0",
      }}
    />
  );
}

/**
 * Echter QR-Code via `qrcode`-lib. Generiert beim Mount als data-URL.
 */
function RealQrCode({ value, size }: { value: string; size: number }) {
  const [src, setSrc] = React.useState<string | null>(null);
  React.useEffect(() => {
    let cancelled = false;
    QRCodeLib.toDataURL(value, {
      margin: 0,
      width: size * 4,
      errorCorrectionLevel: "M",
      color: { dark: "#0F172A", light: "#FFFFFF" },
    })
      .then((url) => {
        if (!cancelled) setSrc(url);
      })
      .catch(() => {
        if (!cancelled) setSrc(null);
      });
    return () => {
      cancelled = true;
    };
  }, [value, size]);

  if (!src) {
    return (
      <div
        style={{
          width: size,
          height: size,
          backgroundColor: "#F1F5F9",
        }}
      />
    );
  }
  return (
    <img
      src={src}
      alt={`QR-Code für ${value}`}
      width={size}
      height={size}
      style={{ display: "block", imageRendering: "pixelated" }}
    />
  );
}

// ---------------------------------------------------------------------------
// Tracking Layer — dashboard + push notifs
// ---------------------------------------------------------------------------

// 4 Event-Typen, die der User vorgegeben hat
const TRACK_EVENTS = [
  {
    action: "hat die Seite aufgerufen",
    icon: <Eye className="size-3" />,
    color: "#10B981",
  },
  {
    action: "hat das Video abgespielt",
    icon: <PlayCircle className="size-3" />,
    color: "#7C5CE8",
  },
  {
    action: "hat den CTA-Button geklickt",
    icon: <MousePointerClick className="size-3" />,
    color: "#FBBF24",
  },
  {
    action: "hat einen Termin gebucht",
    icon: <CalendarCheck className="size-3" />,
    color: "#F472B6",
  },
] as const;

// Lead-Pool für die Notifs (Vorname + Firma) — 20 deutsche Namen mit
// Firma, gefuellt aus den vorhandenen Lead-Pools.
const NOTIF_LEADS = (() => {
  const all = [
    { first: "Max", last: "Mustermann", company: "Mustermann Industrie" },
    { first: "Lisa", last: "Lust", company: "Lust Cosmetics" },
    { first: "Franz", last: "Friedrich", company: "Friedrich Manufaktur" },
    { first: "Sofia", last: "Reuter", company: "Reuter Coaching" },
    ...EXTRA_PEOPLE.slice(0, 16).map((p) => {
      const parts = p.company.split(" ");
      return { first: p.first, last: parts[0], company: p.company };
    }),
  ];
  return all;
})();

type TrackNotif = {
  id: number;
  who: string;
  company: string;
  actionIndex: number;
  ageLabel: string;
};

function pickRandom<T>(arr: ReadonlyArray<T>): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function ageLabelFor(secAgo: number): string {
  if (secAgo < 5) return "gerade eben";
  if (secAgo < 60) return `vor ${Math.round(secAgo)} s`;
  return `vor ${Math.round(secAgo / 60)} min`;
}

function TrackingLayer({ active }: { active: boolean }) {
  const [notifs, setNotifs] = React.useState<TrackNotif[]>([]);
  const idRef = React.useRef(0);
  const createdAtRef = React.useRef<Map<number, number>>(new Map());

  // Stream-Logik: bei Step-Aktivierung 3 Initial-Notifs setzen, dann
  // alle 4-10 s (zufaellig) eine neue oben einreihen, alte rutschen
  // nach unten, max. 6 sichtbar. Insgesamt 20 ueber ca. 2 Min.
  React.useEffect(() => {
    if (!active) {
      setNotifs([]);
      createdAtRef.current.clear();
      return;
    }
    // Setup initial
    const now = Date.now();
    createdAtRef.current.clear();
    const initial: TrackNotif[] = [0, 1, 2].map((i) => {
      const id = idRef.current++;
      const lead = pickRandom(NOTIF_LEADS);
      const actionIndex = Math.floor(Math.random() * TRACK_EVENTS.length);
      const secAgo = (i + 1) * 8;
      createdAtRef.current.set(id, now - secAgo * 1000);
      return {
        id,
        who: `${lead.first} ${lead.last}`,
        company: lead.company,
        actionIndex,
        ageLabel: ageLabelFor(secAgo),
      };
    });
    setNotifs(initial);

    let cancelled = false;
    function scheduleNext() {
      if (cancelled) return;
      // Unregelmaessig zwischen 4 und 10 s
      const delay = 4000 + Math.random() * 6000;
      window.setTimeout(() => {
        if (cancelled) return;
        const id = idRef.current++;
        const lead = pickRandom(NOTIF_LEADS);
        const actionIndex = Math.floor(Math.random() * TRACK_EVENTS.length);
        createdAtRef.current.set(id, Date.now());
        const newNotif: TrackNotif = {
          id,
          who: `${lead.first} ${lead.last}`,
          company: lead.company,
          actionIndex,
          ageLabel: "gerade eben",
        };
        setNotifs((prev) => {
          // newest first, max 6
          const next = [newNotif, ...prev].slice(0, 6);
          return next;
        });
        scheduleNext();
      }, delay);
    }
    scheduleNext();

    // Age-Update jede 5 s damit "vor X s" hochzaehlt
    const ageTick = window.setInterval(() => {
      const now2 = Date.now();
      setNotifs((prev) =>
        prev.map((n) => {
          const created = createdAtRef.current.get(n.id) ?? now2;
          const sec = (now2 - created) / 1000;
          return { ...n, ageLabel: ageLabelFor(sec) };
        }),
      );
    }, 5000);

    return () => {
      cancelled = true;
      window.clearInterval(ageTick);
    };
  }, [active]);

  return (
    <>
      <div
        className="absolute inset-3 rounded-2xl bg-white border border-line p-4 transition-all duration-700 z-10"
        style={{
          opacity: active ? 1 : 0,
          transform: active ? "scale(1)" : "scale(0.96)",
          pointerEvents: "none",
        }}
      >
        <div className="text-[10px] font-bold tracking-widest uppercase text-ink-muted mb-2">
          Live-Dashboard
        </div>
        <div className="grid grid-cols-4 gap-2 mb-3">
          {[
            { l: "Versendet", v: "743" },
            { l: "Geöffnet", v: "21,4 %", c: "text-ok" },
            { l: "Watch-Time ø", v: "83 %", c: "text-brand-deep" },
            { l: "Anfragen", v: "39", c: "text-brand-deep" },
          ].map((k, i) => (
            <div
              key={i}
              className="rounded-lg bg-surface-soft border border-line p-2"
            >
              <div className="text-[8px] font-bold text-ink-muted uppercase">
                {k.l}
              </div>
              <div
                className={cn(
                  "text-base font-extrabold mt-0.5",
                  k.c ?? "text-ink",
                )}
              >
                {k.v}
              </div>
            </div>
          ))}
        </div>
        <div className="rounded-lg bg-surface-soft border border-line p-3">
          <div className="text-[8px] font-bold uppercase text-ink-muted mb-1">
            Watch-Time-Verlauf
          </div>
          <svg viewBox="0 0 200 40" className="w-full h-16">
            <defs>
              <linearGradient id="vc-howit-track" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#AA8CF5" stopOpacity="0.55" />
                <stop offset="100%" stopColor="#AA8CF5" stopOpacity="0" />
              </linearGradient>
            </defs>
            <path
              d="M0,35 L20,30 L40,25 L60,28 L80,18 L100,14 L120,16 L140,10 L160,8 L200,3 L200,40 L0,40 Z"
              fill="url(#vc-howit-track)"
            />
            <path
              d="M0,35 L20,30 L40,25 L60,28 L80,18 L100,14 L120,16 L140,10 L160,8 L200,3"
              fill="none"
              stroke="#7C5CE8"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
      </div>

      {/* Push notifs — gestreamed, neueste oben, alte rutschen runter,
          ueberzaehlige (>6) fallen unten raus. AnimatePresence mit layout
          fuer smooth Enter/Exit + Reflow */}
      <div className="absolute top-12 right-3 w-[224px] flex flex-col gap-2 z-30">
        <AnimatePresence initial={false}>
          {notifs.map((n) => {
            const ev = TRACK_EVENTS[n.actionIndex];
            return (
              <motion.div
                key={n.id}
                layout
                initial={{ opacity: 0, x: 60, scale: 0.9 }}
                animate={{ opacity: 1, x: 0, scale: 1 }}
                exit={{
                  opacity: 0,
                  x: 60,
                  scale: 0.92,
                  transition: { duration: 0.25 },
                }}
                transition={{
                  type: "spring",
                  stiffness: 320,
                  damping: 28,
                  mass: 0.7,
                }}
                className="rounded-xl p-2.5 backdrop-blur-md border border-white/15"
                style={{
                  backgroundColor: "rgba(15,23,42,0.88)",
                  boxShadow: "0 14px 28px -14px rgba(15,23,42,0.55)",
                }}
              >
                <div className="flex gap-2 items-start">
                  <div
                    className="shrink-0 size-7 rounded-md flex items-center justify-center text-white"
                    style={{ backgroundColor: ev.color }}
                  >
                    {ev.icon}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[10px] leading-tight">
                      <span className="text-white font-bold">{n.who}</span>{" "}
                      <span className="text-white/55">von</span>{" "}
                      <span className="text-white/80">{n.company}</span>{" "}
                      <span className="text-white/70">{ev.action}</span>
                    </div>
                    <div className="text-[8px] text-white/45 mt-0.5">
                      {n.ageLabel}
                    </div>
                  </div>
                </div>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Stars
// ---------------------------------------------------------------------------

const STARS_STYLE: React.CSSProperties = {
  backgroundImage:
    "radial-gradient(circle at 20% 30%, white 1px, transparent 1.5px), radial-gradient(circle at 70% 60%, white 1px, transparent 1.5px), radial-gradient(circle at 40% 80%, white 0.8px, transparent 1.2px), radial-gradient(circle at 85% 20%, white 1px, transparent 1.5px)",
  backgroundSize: "320px 320px, 240px 240px, 180px 180px, 280px 280px",
};
