"use client";

import * as React from "react";
import {
  AtSign,
  Building2,
  CheckCircle2,
  ClipboardList,
  Linkedin,
  Mail,
  MousePointerClick,
  PenLine,
  PlayCircle,
  Sparkles,
  Video,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";

type Step = {
  id: string;
  number: string;
  title: string;
  description: string;
  icon: React.ReactNode;
  visual: React.ReactNode;
};

export function HowItWorksSection() {
  const [active, setActive] = React.useState(0);

  // Auto-advance every 6 s; pausiert sobald User selbst klickt.
  const [manual, setManual] = React.useState(false);
  React.useEffect(() => {
    if (manual) return;
    const id = window.setInterval(
      () => setActive((i) => (i + 1) % STEPS.length),
      6000,
    );
    return () => window.clearInterval(id);
  }, [manual]);

  const STEPS: ReadonlyArray<Step> = React.useMemo(
    () => [
      {
        id: "record",
        number: "01",
        title: "Aufnehmen",
        description:
          "Eine ruhige Minute Webcam, einmal pro Kampagne. Sprich, als säße dein Lead direkt vor dir.",
        icon: <Video className="size-4" />,
        visual: <VisualRecord />,
      },
      {
        id: "scenes",
        number: "02",
        title: "Szenen wählen",
        description:
          "Bestimme, was um deine Webcam herum sichtbar ist. Website, Folien, persönliches Doc oder Solo.",
        icon: <PlayCircle className="size-4" />,
        visual: <VisualScenes />,
      },
      {
        id: "template",
        number: "03",
        title: "Vorlage bauen",
        description:
          "Lege Lead-Landingpage und Brief an. Mit KI-Assistent oder Block-Editor. Platzhalter werden automatisch ersetzt.",
        icon: <PenLine className="size-4" />,
        visual: <VisualTemplate />,
      },
      {
        id: "leads",
        number: "04",
        title: "Leadliste hochladen",
        description:
          "CSV oder Excel rein. VIDEOCOMET erkennt deine Spalten automatisch, du musst nichts mappen.",
        icon: <ClipboardList className="size-4" />,
        visual: <VisualLeads />,
      },
      {
        id: "cometos",
        number: "05",
        title: "CometOS generiert",
        description:
          "Im Hintergrund rendern Worker jedes Video, jede Landingpage und jeden Brief individuell. In Minuten fertig.",
        icon: <Sparkles className="size-4" />,
        visual: <VisualCometOS />,
      },
      {
        id: "send",
        number: "06",
        title: "Versenden",
        description:
          "Lade die fertige Liste mit persönlichen URLs zurück oder versende direkt aus VIDEOCOMET. Drei Kanäle, dein Workflow.",
        icon: <Mail className="size-4" />,
        visual: <VisualSend />,
      },
      {
        id: "track",
        number: "07",
        title: "Tracken & syncen",
        description:
          "Sieh live, wer öffnet, schaut und klickt. Optional fließt jedes Event direkt ins HubSpot, Salessuite, Close, Zapier oder Make.",
        icon: <MousePointerClick className="size-4" />,
        visual: <VisualTrack />,
      },
    ],
    [],
  );

  const activeStep = STEPS[active];

  return (
    <section
      id="how-it-works"
      className="relative z-[1] w-full bg-surface py-24 md:py-32 border-b border-line"
    >
      <div className="max-w-6xl mx-auto px-6 md:px-10">
        <div className="max-w-2xl mx-auto text-center mb-14 md:mb-20">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-brand-soft text-brand-deep text-xs font-semibold mb-5">
            <Zap className="size-3.5" />
            Wie es funktioniert
          </div>
          <h2 className="text-4xl md:text-5xl font-bold tracking-[-0.025em] text-ink leading-[1.05] mb-5 text-balance">
            Vom Take bis zum Termin.
          </h2>
          <p className="text-ink-muted text-lg leading-relaxed text-balance">
            Sieben Schritte vom Webcam-Take bis zur ersten Antwort deines
            Wunschkunden. Einmal aufgesetzt, beliebig oft wiederholt.
          </p>
        </div>

        <div className="grid grid-cols-12 gap-6 lg:gap-10 items-start">
          {/* Step list */}
          <div className="col-span-12 lg:col-span-5 flex flex-col gap-2">
            {STEPS.map((step, i) => {
              const isActive = i === active;
              return (
                <button
                  key={step.id}
                  type="button"
                  onClick={() => {
                    setActive(i);
                    setManual(true);
                  }}
                  className={cn(
                    "group relative w-full text-left rounded-2xl border p-5 transition-all",
                    "focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40",
                    isActive
                      ? "border-brand bg-brand-soft/40 shadow-[0_4px_20px_-8px_rgba(124,92,232,0.35)]"
                      : "border-line bg-white hover:border-brand/40 hover:bg-surface-soft",
                  )}
                >
                  <div className="flex items-start gap-4">
                    <div
                      className={cn(
                        "shrink-0 inline-flex items-center justify-center size-10 rounded-xl font-mono text-sm font-bold transition-colors",
                        isActive
                          ? "bg-brand text-white"
                          : "bg-surface-soft text-ink-muted",
                      )}
                    >
                      {step.number}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1.5">
                        <span
                          className={cn(
                            "inline-flex",
                            isActive ? "text-brand-deep" : "text-ink-soft",
                          )}
                        >
                          {step.icon}
                        </span>
                        <h3
                          className={cn(
                            "text-base font-semibold",
                            isActive ? "text-ink" : "text-ink",
                          )}
                        >
                          {step.title}
                        </h3>
                      </div>
                      <p className="text-sm text-ink-muted leading-relaxed">
                        {step.description}
                      </p>
                    </div>
                  </div>
                  {/* Auto-progress bar — fills 0->100 over 6s on active step */}
                  {isActive && !manual ? (
                    <div className="absolute bottom-0 left-5 right-5 h-px overflow-hidden rounded-full">
                      <div className="h-full bg-brand origin-left animate-vc-step-progress" />
                    </div>
                  ) : null}
                </button>
              );
            })}
          </div>

          {/* Visual preview */}
          <div className="col-span-12 lg:col-span-7 lg:sticky lg:top-24">
            <div className="relative aspect-[4/3] w-full rounded-3xl overflow-hidden bg-gradient-to-br from-[#0F172A] via-[#181b2e] to-[#0F172A] shadow-[0_20px_60px_-20px_rgba(15,23,42,0.55)]">
              {/* Stars/noise overlay for depth */}
              <div className="absolute inset-0 opacity-[0.18]" style={STARS_STYLE} />
              {/* Visual content, switches with fade */}
              <div key={activeStep.id} className="absolute inset-0 vc-fade-in">
                {activeStep.visual}
              </div>
            </div>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes vc-step-progress {
          0%   { transform: scaleX(0); }
          100% { transform: scaleX(1); }
        }
        .animate-vc-step-progress {
          width: 100%;
          animation: vc-step-progress 6s linear forwards;
        }
        @keyframes vc-fade-in {
          0%   { opacity: 0; transform: translateY(8px) scale(0.995); }
          100% { opacity: 1; transform: translateY(0) scale(1); }
        }
        .vc-fade-in { animation: vc-fade-in 0.55s cubic-bezier(0.2,0.8,0.2,1) forwards; }

        @keyframes vc-orbit {
          0%   { transform: rotate(0deg) translateX(140px) rotate(0deg); }
          100% { transform: rotate(360deg) translateX(140px) rotate(-360deg); }
        }
        .vc-orbit-1 { animation: vc-orbit 18s linear infinite; }
        .vc-orbit-2 { animation: vc-orbit 26s linear infinite reverse; }

        @keyframes vc-pulse {
          0%, 100% { transform: scale(1); opacity: 1; }
          50% { transform: scale(1.04); opacity: 0.85; }
        }
        .vc-pulse-slow { animation: vc-pulse 2.6s ease-in-out infinite; }

        @keyframes vc-bar-grow {
          0%   { width: 0%; }
          100% { width: var(--w, 70%); }
        }
        .vc-bar-grow { animation: vc-bar-grow 1.8s cubic-bezier(0.2,0.8,0.2,1) forwards; }

        @keyframes vc-shimmer {
          0%   { background-position: -200% 0; }
          100% { background-position: 200% 0; }
        }
        .vc-shimmer {
          background: linear-gradient(90deg, rgba(170,140,245,0.15) 0%, rgba(170,140,245,0.45) 50%, rgba(170,140,245,0.15) 100%);
          background-size: 200% 100%;
          animation: vc-shimmer 2.4s linear infinite;
        }
      `}</style>
    </section>
  );
}

const STARS_STYLE: React.CSSProperties = {
  backgroundImage:
    "radial-gradient(circle at 20% 30%, white 1px, transparent 1.5px), radial-gradient(circle at 70% 60%, white 1px, transparent 1.5px), radial-gradient(circle at 40% 80%, white 0.8px, transparent 1.2px), radial-gradient(circle at 85% 20%, white 1px, transparent 1.5px)",
  backgroundSize: "320px 320px, 240px 240px, 180px 180px, 280px 280px",
};

// ---------------------------------------------------------------------------
// Visual: 01 — Aufnehmen
// ---------------------------------------------------------------------------
function VisualRecord() {
  return (
    <div className="absolute inset-0 flex items-center justify-center p-10">
      <div className="relative w-[80%] max-w-[480px] aspect-[16/10] rounded-2xl bg-[#1a1c2e] border border-white/10 shadow-2xl overflow-hidden">
        {/* Window chrome */}
        <div className="absolute top-0 left-0 right-0 h-7 bg-black/40 backdrop-blur-md flex items-center px-3 gap-1.5">
          <div className="size-2 rounded-full bg-red-400/80" />
          <div className="size-2 rounded-full bg-yellow-400/80" />
          <div className="size-2 rounded-full bg-green-400/80" />
          <div className="flex-1 text-center text-[10px] text-white/40 tracking-wide">
            Webcam-Aufnahme
          </div>
        </div>
        {/* Webcam circle (placeholder portrait gradient) */}
        <div className="absolute inset-0 top-7 flex items-center justify-center">
          <div className="relative">
            <div className="size-44 rounded-full bg-gradient-to-br from-[#3a3158] via-[#574077] to-[#1e1733] flex items-center justify-center text-white text-3xl font-bold border border-white/10">
              <span className="opacity-70">CS</span>
            </div>
            <div className="absolute -inset-2 rounded-full border border-brand/40 vc-pulse-slow" />
            <div className="absolute -inset-5 rounded-full border border-brand/20 vc-pulse-slow" style={{ animationDelay: "0.4s" }} />
          </div>
        </div>
        {/* Bottom controls */}
        <div className="absolute bottom-0 left-0 right-0 h-12 bg-black/50 backdrop-blur-md flex items-center justify-between px-4">
          <div className="flex items-center gap-2 text-white/85 text-xs font-medium">
            <span className="size-2 rounded-full bg-red-400 animate-pulse" />
            REC · 00:47
          </div>
          {/* Mock waveform */}
          <div className="flex items-end gap-[3px] h-5">
            {[6, 12, 8, 16, 10, 18, 14, 8, 12, 6, 14, 10, 8].map((h, i) => (
              <div
                key={i}
                className="w-[3px] bg-white/70 rounded-full"
                style={{ height: `${h}px` }}
              />
            ))}
          </div>
          <div className="text-white/60 text-xs">1080p · 30fps</div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Visual: 02 — Szenen wählen
// ---------------------------------------------------------------------------
function VisualScenes() {
  const SCENES = [
    { label: "Website", active: true, palette: "#7C5CE8" },
    { label: "Folien", active: false, palette: "#FBBF24" },
    { label: "Doc", active: false, palette: "#10B981" },
    { label: "Solo", active: false, palette: "#EC4899" },
  ];
  return (
    <div className="absolute inset-0 flex items-center justify-center p-8">
      <div className="grid grid-cols-2 gap-4 w-[88%] max-w-[480px]">
        {SCENES.map((s) => (
          <div
            key={s.label}
            className={cn(
              "relative aspect-[4/3] rounded-2xl border overflow-hidden p-3 flex flex-col justify-between",
              s.active
                ? "border-brand bg-white shadow-2xl"
                : "border-white/15 bg-white/5",
            )}
          >
            <div className="relative h-full w-full rounded-lg overflow-hidden flex items-center justify-center">
              <div
                className="absolute inset-0"
                style={{
                  background: s.active
                    ? `linear-gradient(135deg, ${s.palette}40, ${s.palette}80)`
                    : `linear-gradient(135deg, ${s.palette}20, ${s.palette}40)`,
                }}
              />
              <div className="absolute bottom-2 left-2 right-2 h-2 rounded-full bg-white/30" />
              <div className="absolute bottom-2 left-2 size-6 rounded-full bg-white/90 border-2 border-white" />
            </div>
            <div className="flex items-center justify-between pt-2">
              <span
                className={cn(
                  "text-xs font-semibold",
                  s.active ? "text-ink" : "text-white/85",
                )}
              >
                {s.label}
              </span>
              {s.active ? (
                <CheckCircle2 className="size-4 text-brand" />
              ) : (
                <div className="size-4 rounded-full border border-white/30" />
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Visual: 03 — Vorlage bauen
// ---------------------------------------------------------------------------
function VisualTemplate() {
  const BLOCKS = [
    { label: "Header", color: "#7C5CE8" },
    { label: "Hero · Video", color: "#AA8CF5" },
    { label: "{Vorname}, dein Angebot", color: "#10B981" },
    { label: "CTA Termin", color: "#FBBF24" },
  ];
  return (
    <div className="absolute inset-0 flex items-center justify-center p-10">
      <div className="relative w-[80%] max-w-[440px] rounded-2xl bg-white border border-line p-4 shadow-2xl">
        {/* AI bar */}
        <div className="flex items-center gap-2 px-3 py-2 mb-3 rounded-xl bg-gradient-to-r from-brand-soft to-white border border-brand/30">
          <Sparkles className="size-3.5 text-brand-deep" />
          <span className="text-xs font-semibold text-brand-deep">
            KI baut deine Vorlage
          </span>
          <div className="flex-1 h-1 rounded-full bg-white overflow-hidden">
            <div className="h-full vc-shimmer" />
          </div>
        </div>
        {/* Blocks */}
        <div className="flex flex-col gap-2">
          {BLOCKS.map((b) => (
            <div
              key={b.label}
              className="flex items-center gap-3 p-3 rounded-lg border border-line bg-surface-soft"
            >
              <div
                className="size-2 rounded-full"
                style={{ backgroundColor: b.color }}
              />
              <span className="text-xs font-medium text-ink flex-1">
                {b.label}
              </span>
              <div className="flex flex-col gap-0.5">
                <div className="w-3 h-px bg-ink-muted/40" />
                <div className="w-3 h-px bg-ink-muted/40" />
                <div className="w-3 h-px bg-ink-muted/40" />
              </div>
            </div>
          ))}
        </div>
        {/* Placeholder chips */}
        <div className="mt-3 flex flex-wrap gap-1.5">
          {["{Vorname}", "{Firma}", "{Stadt}", "{Branche}"].map((p) => (
            <span
              key={p}
              className="text-[10px] font-mono px-2 py-0.5 rounded-md bg-brand/10 text-brand-deep border border-brand/20"
            >
              {p}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Visual: 04 — Leadliste hochladen
// ---------------------------------------------------------------------------
function VisualLeads() {
  const LEADS = [
    { v: "Max", n: "Mustermann", f: "Mustermann Industrie", e: "max@mustermann.de" },
    { v: "Lisa", n: "Lust", f: "Lust Cosmetics", e: "lisa@lust-cosmetics.de" },
    { v: "Franz", n: "Friedrich", f: "Friedrich Manufaktur", e: "franz@friedrich.de" },
    { v: "Stefan", n: "Kessler", f: "Kessler Agentur", e: "s.kessler@kessler-ag.de" },
    { v: "Sofia", n: "Reuter", f: "Reuter Coaching", e: "sofia@reuter-coach.de" },
  ];
  return (
    <div className="absolute inset-0 flex items-center justify-center p-8">
      <div className="w-[88%] max-w-[500px] rounded-2xl bg-white border border-line overflow-hidden shadow-2xl">
        <div className="px-4 py-3 bg-surface-soft border-b border-line flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ClipboardList className="size-4 text-brand-deep" />
            <span className="text-xs font-semibold text-ink">
              leads-q3-2026.csv
            </span>
          </div>
          <span className="text-[10px] font-mono text-ink-muted">
            12.043 Leads
          </span>
        </div>
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-surface-soft border-b border-line text-[10px] uppercase tracking-wider text-ink-muted">
              <th className="text-left py-2 px-3 font-semibold">Vorname</th>
              <th className="text-left py-2 px-3 font-semibold">Nachname</th>
              <th className="text-left py-2 px-3 font-semibold">Firma</th>
              <th className="text-left py-2 px-3 font-semibold">E-Mail</th>
            </tr>
          </thead>
          <tbody>
            {LEADS.map((l, i) => (
              <tr
                key={i}
                className={cn(
                  "border-b border-line/60",
                  i === 1 && "bg-brand-soft/40",
                )}
              >
                <td className="py-2 px-3 text-ink font-medium">{l.v}</td>
                <td className="py-2 px-3 text-ink-soft">{l.n}</td>
                <td className="py-2 px-3 text-ink-soft">{l.f}</td>
                <td className="py-2 px-3 text-ink-muted truncate max-w-[120px]">
                  {l.e}
                </td>
              </tr>
            ))}
            <tr>
              <td colSpan={4} className="py-3 px-3 text-center text-[10px] text-ink-muted/70 italic">
                +12.038 weitere Zeilen
              </td>
            </tr>
          </tbody>
        </table>
        <div className="px-4 py-3 border-t border-line bg-brand/5 flex items-center gap-2">
          <CheckCircle2 className="size-3.5 text-ok" />
          <span className="text-xs text-ink">
            Spalten automatisch erkannt
          </span>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Visual: 05 — CometOS generiert
// ---------------------------------------------------------------------------
function VisualCometOS() {
  return (
    <div className="absolute inset-0 flex items-center justify-center p-10">
      {/* Orbit container */}
      <div className="relative size-[320px] max-w-full">
        <div className="absolute inset-0 rounded-full border border-white/10" />
        <div className="absolute inset-[40px] rounded-full border border-white/10" />
        {/* Center planet — CometOS */}
        <div className="absolute inset-[70px] rounded-full bg-gradient-to-br from-[#7C5CE8] via-[#AA8CF5] to-[#5232C7] shadow-[0_0_60px_rgba(124,92,232,0.5)] flex items-center justify-center">
          <div className="text-center text-white">
            <div className="text-[10px] font-mono uppercase tracking-widest opacity-80">
              CometOS
            </div>
            <div className="text-3xl font-bold mt-1">8.412</div>
            <div className="text-[10px] opacity-70 mt-0.5">von 12.043</div>
          </div>
        </div>
        {/* Orbit comets */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 vc-orbit-1">
          <div className="size-3 rounded-full bg-gradient-to-r from-[#AA8CF5] to-transparent shadow-[0_0_18px_rgba(170,140,245,0.8)]" />
        </div>
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 vc-orbit-2" style={{ animationDelay: "-8s" }}>
          <div className="size-2 rounded-full bg-gradient-to-r from-[#FBBF24] to-transparent shadow-[0_0_14px_rgba(251,191,36,0.7)]" />
        </div>
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 vc-orbit-1" style={{ animationDelay: "-12s" }}>
          <div className="size-2 rounded-full bg-gradient-to-r from-[#10B981] to-transparent shadow-[0_0_14px_rgba(16,185,129,0.7)]" />
        </div>
        {/* Status badges */}
        <div className="absolute -top-2 left-0 px-2 py-1 rounded-md bg-black/60 backdrop-blur-md text-white/85 text-[10px] font-mono">
          rendering · video
        </div>
        <div className="absolute -bottom-2 right-0 px-2 py-1 rounded-md bg-black/60 backdrop-blur-md text-white/85 text-[10px] font-mono">
          building · landingpage
        </div>
        <div className="absolute top-1/2 -right-4 px-2 py-1 rounded-md bg-black/60 backdrop-blur-md text-white/85 text-[10px] font-mono">
          composing · brief
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Visual: 06 — Versenden
// ---------------------------------------------------------------------------
function VisualSend() {
  const CHANNELS = [
    {
      icon: <AtSign className="size-5 text-white" />,
      bg: "from-[#4F46E5] to-[#7C3AED]",
      label: "E-Mail",
      stat: "8.412 versendet",
      detail: "via verbundenes Postfach",
    },
    {
      icon: <Linkedin className="size-5 text-white" />,
      bg: "from-[#0A66C2] to-[#0077B5]",
      label: "LinkedIn",
      stat: "Persönliche URLs",
      detail: "zum Einfügen in Nachrichten",
    },
    {
      icon: <Mail className="size-5 text-white" />,
      bg: "from-[#92400E] to-[#451A03]",
      label: "Briefpost",
      stat: "3.631 PDFs",
      detail: "Druck und Versand optional",
    },
  ];
  return (
    <div className="absolute inset-0 flex items-center justify-center p-8">
      <div className="flex flex-col gap-3 w-[88%] max-w-[480px]">
        {CHANNELS.map((c) => (
          <div
            key={c.label}
            className="flex items-center gap-4 p-4 rounded-2xl bg-white/8 border border-white/15 backdrop-blur-md"
          >
            <div
              className={cn(
                "shrink-0 size-12 rounded-xl bg-gradient-to-br flex items-center justify-center shadow-lg",
                c.bg,
              )}
            >
              {c.icon}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold text-white">{c.label}</div>
              <div className="text-xs text-white/55">{c.detail}</div>
            </div>
            <div className="text-right">
              <div className="text-xs font-mono text-white/90">{c.stat}</div>
              <div className="text-[10px] text-white/45 mt-0.5">
                fertig zum Versand
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Visual: 07 — Tracken & syncen
// ---------------------------------------------------------------------------
function VisualTrack() {
  return (
    <div className="absolute inset-0 flex items-center justify-center p-8">
      <div className="w-[88%] max-w-[480px] flex flex-col gap-3">
        {/* KPI Row */}
        <div className="grid grid-cols-3 gap-3">
          <KpiCard label="Geöffnet" value="4.218" delta="+34%" />
          <KpiCard label="Geschaut" value="2.851" delta="+28%" tone="brand" />
          <KpiCard label="CTA geklickt" value="611" delta="+19%" tone="ok" />
        </div>
        {/* Chart */}
        <div className="rounded-2xl bg-white/8 border border-white/15 backdrop-blur-md p-4">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-semibold text-white">
              Watch-Time-Verlauf
            </span>
            <span className="text-[10px] text-white/45">letzte 14 Tage</span>
          </div>
          <svg viewBox="0 0 200 60" className="w-full h-12">
            <defs>
              <linearGradient id="vc-track-grad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#AA8CF5" stopOpacity="0.5" />
                <stop offset="100%" stopColor="#AA8CF5" stopOpacity="0" />
              </linearGradient>
            </defs>
            <path
              d="M0,45 L15,40 L30,35 L45,38 L60,28 L75,30 L90,22 L105,18 L120,20 L135,14 L150,12 L165,8 L180,10 L200,5 L200,60 L0,60 Z"
              fill="url(#vc-track-grad)"
            />
            <path
              d="M0,45 L15,40 L30,35 L45,38 L60,28 L75,30 L90,22 L105,18 L120,20 L135,14 L150,12 L165,8 L180,10 L200,5"
              fill="none"
              stroke="#AA8CF5"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
        {/* CRM Sync */}
        <div className="rounded-2xl bg-white/8 border border-white/15 backdrop-blur-md p-4">
          <div className="flex items-center gap-2 mb-3">
            <Building2 className="size-3.5 text-white/70" />
            <span className="text-xs font-semibold text-white">
              CRM-Sync aktiv
            </span>
            <span className="ml-auto inline-flex items-center gap-1 text-[10px] text-ok">
              <span className="size-1.5 rounded-full bg-ok animate-pulse" />
              live
            </span>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {["HubSpot", "Salessuite", "Close.com", "Zapier", "Make"].map(
              (crm) => (
                <span
                  key={crm}
                  className="px-2.5 py-1 rounded-full bg-white/10 border border-white/15 text-[10px] text-white/90"
                >
                  {crm}
                </span>
              ),
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function KpiCard({
  label,
  value,
  delta,
  tone = "default",
}: {
  label: string;
  value: string;
  delta: string;
  tone?: "default" | "brand" | "ok";
}) {
  return (
    <div className="rounded-2xl bg-white/8 border border-white/15 backdrop-blur-md p-3">
      <div className="text-[10px] uppercase tracking-wider text-white/55 mb-1">
        {label}
      </div>
      <div
        className={cn(
          "text-xl font-bold",
          tone === "brand"
            ? "text-brand"
            : tone === "ok"
              ? "text-ok"
              : "text-white",
        )}
      >
        {value}
      </div>
      <div className="text-[10px] text-ok mt-0.5">{delta}</div>
    </div>
  );
}
