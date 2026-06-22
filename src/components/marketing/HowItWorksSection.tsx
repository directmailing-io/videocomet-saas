"use client";

import * as React from "react";
import { Zap } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Cumulative-Layer-Walkthrough:
 *
 * Das Webcam-<video> bleibt durchgaengig im selben DOM-Knoten gemountet,
 * laeuft konstant durch. Pro Step werden nur Position + Groesse animiert,
 * weitere Layer (Szene, Landingpage-Frame, 4er-Grid, Brief, Push-Notifs)
 * faden zusaetzlich ein. Reines React + CSS, kein Remotion und kein
 * Player-Clock – damit klappt das Klicken auf die Step-Pills 100 %.
 */

const STEPS = [
  {
    id: "webcam",
    title: "Webcam",
    eyebrow: "Aufnehmen",
    headline: "Eine Aufnahme reicht.",
    sub: "Eine ruhige Minute Webcam. Du wählst aus drei Takes den besten aus.",
  },
  {
    id: "scenes",
    title: "Szenen",
    eyebrow: "Szenen wählen",
    headline: "Setze deine Aufnahme in Szene.",
    sub: "Website-Screenshot, Folien, persönliches Dokument oder Solo. Deine Webcam sitzt automatisch im Bild.",
  },
  {
    id: "landing",
    title: "Landingpage",
    eyebrow: "Landingpage gestalten",
    headline: "Dein Video sitzt im Hero.",
    sub: "Wähle eine von drei Vorlagen. Headline, Platzhalter und CTA sind schon dran.",
  },
  {
    id: "leads",
    title: "Leadliste",
    eyebrow: "Leadliste hochladen",
    headline: "Aus eins wird tausend.",
    sub: "CSV rein. Jede Zeile bekommt eine eigene Landingpage. Die fertige Liste wandert in dein Versand-Tool.",
  },
  {
    id: "letter",
    title: "Brief",
    eyebrow: "Brief erstellen",
    headline: "Drucke fertig. PDF inklusive.",
    sub: "Pro Empfänger ein Brief mit Adresse, Anrede und persönlicher URL. Drucke direkt oder gib das Bündel an deinen Druckdienst.",
  },
  {
    id: "tracking",
    title: "Tracking",
    eyebrow: "Live tracken",
    headline: "Du siehst alles, in Echtzeit.",
    sub: "Jede Öffnung, Watch-Time, jeder Klick. Optional synchron in dein HubSpot, Salessuite, Close, Zapier oder Make.",
  },
] as const;

export function HowItWorksSection() {
  const [step, setStep] = React.useState(0);
  const [manual, setManual] = React.useState(false);

  // Auto-advance unless user has clicked
  React.useEffect(() => {
    if (manual) return;
    const id = window.setInterval(() => {
      setStep((s) => (s + 1) % STEPS.length);
    }, 5200);
    return () => window.clearInterval(id);
  }, [manual]);

  const handleClick = (i: number) => {
    setStep(i);
    setManual(true);
  };

  return (
    <section
      id="how-it-works"
      className="relative z-[1] w-full bg-white py-24 md:py-32"
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
                onClick={() => handleClick(i)}
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

        {/* Stage + caption */}
        <div className="grid grid-cols-12 gap-8 items-center">
          <div className="col-span-12 lg:col-span-7">
            <Stage step={step} />
          </div>

          <div className="col-span-12 lg:col-span-5">
            <StepCaption step={step} />
            {!manual ? (
              <div className="mt-6 flex items-center gap-2 text-xs text-ink-muted">
                <span className="size-1.5 rounded-full bg-brand animate-pulse" />
                Auto-Demo läuft. Klick auf einen Schritt, um zu steuern.
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}

function StepCaption({ step }: { step: number }) {
  const s = STEPS[step];
  return (
    <div key={s.id} className="vc-fade-up">
      <div className="text-xs font-bold tracking-[0.22em] uppercase text-brand-deep mb-3">
        {s.eyebrow}
      </div>
      <h3 className="text-2xl md:text-3xl font-bold tracking-[-0.02em] text-ink leading-tight mb-3 text-balance">
        {s.headline}
      </h3>
      <p className="text-ink-muted leading-relaxed text-balance">{s.sub}</p>

      <style>{`
        @keyframes vc-fade-up-anim {
          0%   { opacity: 0; transform: translateY(8px); }
          100% { opacity: 1; transform: translateY(0); }
        }
        .vc-fade-up { animation: vc-fade-up-anim 0.5s cubic-bezier(0.2,0.8,0.2,1) forwards; }
      `}</style>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Stage — alle Layer in einem Container, Webcam-Video bleibt mounted
// ---------------------------------------------------------------------------
function Stage({ step }: { step: number }) {
  // Webcam-Geometrie pro Step (Prozent vom Stage)
  const webcamPos = WEBCAM_LAYOUT[step] ?? WEBCAM_LAYOUT[0];

  return (
    <div className="relative w-full aspect-[16/10] rounded-3xl overflow-hidden bg-gradient-to-br from-[#0F172A] via-[#1a1d35] to-[#0F172A] border border-line shadow-[0_30px_80px_-30px_rgba(15,23,42,0.35)]">
      {/* subtle stars */}
      <div className="absolute inset-0 opacity-[0.18]" style={STARS_STYLE} />

      {/* Layer 1: scene background (Step 1+) */}
      <SceneLayer active={step >= 1} />

      {/* Layer 2: landingpage frame (Step 2+) — wraps the scene */}
      <LandingFrame active={step >= 2 && step <= 2} />

      {/* Layer 3: 4er-Grid (Step 3+) */}
      <MultiGridLayer active={step >= 3} />

      {/* Layer 4: Brief-Stack (Step 4+) */}
      <LetterStack active={step >= 4} />

      {/* Layer 5: Push-Notifs (Step 5) */}
      <PushNotifications active={step === 5} />

      {/* Webcam — always mounted, just resized/repositioned */}
      <div
        className="absolute transition-all duration-700"
        style={{
          ...webcamPos,
          transitionTimingFunction: "cubic-bezier(0.65, 0, 0.35, 1)",
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
          className="w-full h-full object-cover"
          style={{
            borderRadius: webcamPos.borderRadius as string,
            boxShadow:
              "0 0 0 4px rgba(255,255,255,0.92), 0 18px 36px -12px rgba(15,23,42,0.55)",
            transition: "box-shadow 700ms",
          }}
        />
      </div>

      {/* Step overlay top-left */}
      <div className="absolute top-4 left-4 z-30 flex items-center gap-2 px-3 py-1.5 rounded-full bg-black/40 backdrop-blur-md text-white text-[11px] font-mono tracking-wider">
        <span className="text-brand-light font-bold">
          0{step + 1}
        </span>
        <span className="opacity-60">/</span>
        <span className="opacity-60">06</span>
      </div>
    </div>
  );
}

// Webcam layout-rules pro Step (Position via top/left, kein Center-Offset
// notwendig). Werte in % vom Stage. Aspect ratio des Containers ist 16:10,
// also width:height vom Webcam-Element bezieht sich proportional auf die
// Stage-Breite bzw. -Hoehe — was bei aspect-ratio asymmetrisch zu Verzerrung
// fuehrt. Wir setzen aspect-ratio via Style direkt auf "1/1" damit der
// Kreis ein Kreis bleibt.
const WEBCAM_LAYOUT: Array<{
  top: string;
  left: string;
  width: string;
  aspectRatio: string;
  borderRadius: string;
  zIndex: number;
}> = [
  // 0 Webcam: zentriert, großes Rund
  { top: "16%", left: "33%", width: "34%", aspectRatio: "1/1", borderRadius: "9999px", zIndex: 20 },
  // 1 Szenen: bottom-left PiP
  { top: "62%", left: "5%", width: "16%", aspectRatio: "1/1", borderRadius: "9999px", zIndex: 20 },
  // 2 Landingpage: links unten im LP-Hero
  { top: "55%", left: "8%", width: "14%", aspectRatio: "1/1", borderRadius: "9999px", zIndex: 20 },
  // 3 Leads: in der ersten LP-Kachel oben links
  { top: "27%", left: "11%", width: "8%", aspectRatio: "1/1", borderRadius: "9999px", zIndex: 20 },
  // 4 Brief: gleich wie Step 3, Brief liegt rechts daneben
  { top: "27%", left: "9%", width: "8%", aspectRatio: "1/1", borderRadius: "9999px", zIndex: 20 },
  // 5 Tracking: kleines PiP in der oberen rechten Ecke
  { top: "8%", left: "78%", width: "14%", aspectRatio: "1/1", borderRadius: "9999px", zIndex: 20 },
];

// ---------------------------------------------------------------------------
// SceneLayer — Website-Screenshot (Mustermann) als Hintergrund
// ---------------------------------------------------------------------------
function SceneLayer({ active }: { active: boolean }) {
  return (
    <div
      className="absolute inset-0 transition-opacity duration-700"
      style={{
        opacity: active ? 1 : 0,
        transitionTimingFunction: "cubic-bezier(0.65, 0, 0.35, 1)",
      }}
    >
      <img
        src="/demo-assets/website-max.png"
        alt=""
        aria-hidden
        className="w-full h-full object-cover object-top"
        style={{
          filter: "brightness(0.95)",
        }}
      />
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "linear-gradient(180deg, rgba(0,0,0,0.2) 0%, transparent 30%, transparent 70%, rgba(0,0,0,0.4) 100%)",
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// LandingFrame — Browser-Chrome + Header oben + CTA unten um die Szene
// ---------------------------------------------------------------------------
function LandingFrame({ active }: { active: boolean }) {
  return (
    <div
      className="absolute inset-0 transition-opacity duration-700 z-10"
      style={{ opacity: active ? 1 : 0, pointerEvents: "none" }}
    >
      {/* Browser top-bar */}
      <div className="absolute top-0 left-0 right-0 h-9 bg-white/95 backdrop-blur flex items-center px-3 gap-2">
        <div className="flex gap-1.5">
          <div className="size-2 rounded-full bg-red-400" />
          <div className="size-2 rounded-full bg-yellow-400" />
          <div className="size-2 rounded-full bg-green-400" />
        </div>
        <div className="flex-1 h-5 mx-2 rounded-md bg-surface-soft text-[10px] text-ink-muted flex items-center px-2 font-mono">
          videocomet.de/lp/max-mustermann
        </div>
      </div>
      {/* CTA banner bottom */}
      <div className="absolute bottom-4 right-4 px-3 py-2 rounded-lg bg-brand text-white text-xs font-semibold shadow-lg">
        Termin sichern →
      </div>
      {/* Personalized headline overlay */}
      <div className="absolute top-14 left-6 max-w-[55%]">
        <div className="text-[9px] font-bold tracking-widest uppercase text-yellow-300 mb-1 drop-shadow">
          Persönlich für dich
        </div>
        <div className="text-white text-xl md:text-2xl font-extrabold leading-tight drop-shadow-lg">
          Max,
          <br />
          schau dir das an.
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// MultiGridLayer — 2x2 Grid mit 4 personalisierten Landingpages
// ---------------------------------------------------------------------------
const LEADS = [
  { name: "Max Mustermann", company: "Mustermann Industrie", color: "#7C5CE8" },
  { name: "Lisa Lust", company: "Lust Cosmetics", color: "#EC4899" },
  { name: "Franz Friedrich", company: "Friedrich Manufaktur", color: "#92400E" },
  { name: "Sofia Reuter", company: "Reuter Coaching", color: "#10B981" },
];

function MultiGridLayer({ active }: { active: boolean }) {
  return (
    <div
      className="absolute inset-0 transition-opacity duration-700 z-10 p-4"
      style={{
        opacity: active ? 1 : 0,
        pointerEvents: "none",
      }}
    >
      <div className="grid grid-cols-2 grid-rows-2 gap-3 w-full h-full">
        {LEADS.map((lead, i) => (
          <LeadCard
            key={lead.name}
            lead={lead}
            isFirst={i === 0}
            delay={i * 80}
            active={active}
          />
        ))}
      </div>
      <div className="absolute -top-1 right-4 px-3 py-1 rounded-full bg-ink text-white text-[10px] font-bold shadow-lg">
        <span className="text-brand-light">+12.039</span> weitere generiert
      </div>
    </div>
  );
}

function LeadCard({
  lead,
  isFirst,
  delay,
  active,
}: {
  lead: { name: string; company: string; color: string };
  isFirst: boolean;
  delay: number;
  active: boolean;
}) {
  return (
    <div
      className="relative rounded-xl overflow-hidden bg-white border border-line transition-all duration-500 shadow-md"
      style={{
        opacity: active ? 1 : 0,
        transform: active ? "scale(1)" : "scale(0.95)",
        transitionDelay: `${delay}ms`,
      }}
    >
      {/* Hero stripe */}
      <div
        className="h-2/3 relative p-3 flex flex-col justify-between"
        style={{
          background: `linear-gradient(135deg, ${lead.color}40, ${lead.color}90)`,
        }}
      >
        <div>
          <div className="text-[8px] font-bold uppercase tracking-wider text-white/90 mb-0.5">
            Persönlich für
          </div>
          <div className="text-xs md:text-sm font-extrabold text-white leading-tight drop-shadow">
            {lead.name}
          </div>
          <div className="text-[9px] text-white/80 mt-0.5">
            {lead.company}
          </div>
        </div>
        {/* Mini-Video placeholder — except for first card (where real video sits) */}
        {!isFirst ? (
          <div
            className="absolute bottom-2 left-2 size-8 rounded-full border-2 border-white shadow-md flex items-center justify-center text-white text-[10px] font-bold"
            style={{
              background: `linear-gradient(135deg, ${lead.color}, ${lead.color}cc)`,
            }}
          >
            ▶
          </div>
        ) : null}
      </div>
      {/* Body */}
      <div className="p-2 bg-white">
        <div className="space-y-0.5">
          <div className="h-0.5 w-full bg-ink-muted/30 rounded" />
          <div className="h-0.5 w-3/4 bg-ink-muted/30 rounded" />
          <div className="h-0.5 w-2/3 bg-ink-muted/30 rounded" />
        </div>
        <div
          className="mt-1.5 inline-block px-2 py-0.5 rounded text-[8px] font-bold text-white font-mono"
          style={{ backgroundColor: lead.color }}
        >
          /lp/{lead.name.split(" ")[0].toLowerCase()}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// LetterStack — gefächerte Briefe rechts oben
// ---------------------------------------------------------------------------
function LetterStack({ active }: { active: boolean }) {
  const LETTERS = [
    { name: "Lisa Lust", url: "videocomet.de/lp/lisa-lust" },
    { name: "Franz Friedrich", url: "videocomet.de/lp/franz-friedrich" },
    { name: "Sofia Reuter", url: "videocomet.de/lp/sofia-reuter" },
  ];

  return (
    <div
      className="absolute right-4 top-1/2 -translate-y-1/2 transition-all duration-700 z-20"
      style={{
        opacity: active ? 1 : 0,
        transform: active
          ? "translate(0, -50%) rotate(0deg)"
          : "translate(120%, -50%) rotate(8deg)",
      }}
    >
      <div className="relative w-[220px] h-[280px]">
        {LETTERS.map((l, i) => {
          const offset = i * 8;
          const rot = (i - 1) * -3;
          return (
            <div
              key={l.name}
              className="absolute inset-0 rounded-lg bg-white border border-line shadow-xl p-4"
              style={{
                transform: `translate(${offset}px, ${offset * 0.5}px) rotate(${rot}deg)`,
                zIndex: LETTERS.length - i,
              }}
            >
              <div className="w-8 h-1 rounded bg-brand mb-3" />
              <div className="text-[9px] text-ink-muted leading-tight mb-3">
                Christoph Skuk
                <br />
                VIDEOCOMET · Köln
              </div>
              <div className="text-[10px] font-semibold text-ink mb-3 leading-tight">
                {l.name}
              </div>
              <div className="text-[9px] text-ink leading-relaxed">
                Sehr geehrte/r {l.name.split(" ")[0]},<br />
                ein persönliches Video für Sie:
              </div>
              <div className="text-[9px] font-mono font-bold text-brand-deep mt-1 break-all">
                {l.url}
              </div>
              {/* QR placeholder */}
              <div
                className="absolute bottom-3 right-3 size-10"
                style={{
                  background: `repeating-conic-gradient(${"#0F172A"} 0deg 90deg, white 90deg 180deg)`,
                }}
              />
            </div>
          );
        })}
      </div>
      {/* Badge */}
      <div className="absolute -top-3 -left-3 px-3 py-1 rounded-full bg-ink text-white text-[10px] font-bold shadow-lg">
        <span className="text-brand-light">PDF</span> · 3.631× druckfertig
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// PushNotifications — drei iOS-style toasts rechts oben
// ---------------------------------------------------------------------------
function PushNotifications({ active }: { active: boolean }) {
  const NOTIFS = [
    {
      icon: "👁️",
      who: "Max Mustermann",
      what: "öffnete deine Seite",
      meta: "vor 2 s · Mustermann Industrie",
      color: "#10B981",
    },
    {
      icon: "▶️",
      who: "Lisa Lust",
      what: "schaut gerade (00:42)",
      meta: "vor 8 s · Lust Cosmetics",
      color: "#7C5CE8",
    },
    {
      icon: "🎯",
      who: "Franz Friedrich",
      what: "klickte Termin-Button",
      meta: "vor 14 s · Friedrich Manufaktur",
      color: "#FBBF24",
    },
  ];

  return (
    <>
      {/* Dashboard background */}
      <div
        className="absolute inset-3 rounded-2xl bg-white border border-line p-4 transition-all duration-700 z-10"
        style={{
          opacity: active ? 1 : 0,
          transform: active ? "scale(1)" : "scale(0.96)",
          pointerEvents: "none",
        }}
      >
        <div className="text-xs font-bold tracking-wide uppercase text-ink-muted mb-3">
          Live-Dashboard
        </div>
        <div className="grid grid-cols-4 gap-2 mb-3">
          {[
            { l: "Versendet", v: "12.043" },
            { l: "Geöffnet", v: "4.218", c: "text-ok" },
            { l: "Geschaut", v: "2.851", c: "text-brand-deep" },
            { l: "Klicks", v: "611", c: "text-brand-deep" },
          ].map((k, i) => (
            <div
              key={i}
              className="rounded-lg bg-surface-soft border border-line p-2"
            >
              <div className="text-[8px] font-bold text-ink-muted uppercase tracking-wider">
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
        <div className="flex-1 rounded-lg bg-surface-soft border border-line p-3">
          <div className="text-[8px] font-bold text-ink-muted uppercase tracking-wider mb-1">
            Watch-Time-Verlauf
          </div>
          <svg viewBox="0 0 200 40" className="w-full h-14">
            <defs>
              <linearGradient id="vc-track-mini" x1="0" y1="0" x2="0" y2="1">
                <stop
                  offset="0%"
                  stopColor="#AA8CF5"
                  stopOpacity="0.55"
                />
                <stop offset="100%" stopColor="#AA8CF5" stopOpacity="0" />
              </linearGradient>
            </defs>
            <path
              d="M0,35 L20,30 L40,25 L60,28 L80,18 L100,14 L120,16 L140,10 L160,8 L200,3 L200,40 L0,40 Z"
              fill="url(#vc-track-mini)"
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

      {/* Push notifications */}
      <div className="absolute top-12 right-3 w-[200px] flex flex-col gap-2 z-30">
        {NOTIFS.map((n, i) => (
          <div
            key={n.who}
            className="rounded-xl p-2.5 backdrop-blur-md border border-white/15 transition-all duration-500"
            style={{
              backgroundColor: "rgba(15,23,42,0.85)",
              opacity: active ? 1 : 0,
              transform: active
                ? "translateX(0)"
                : "translateX(60px)",
              transitionDelay: `${i * 220 + 300}ms`,
              boxShadow:
                "0 14px 28px -14px rgba(15,23,42,0.5)",
            }}
          >
            <div className="flex gap-2 items-start">
              <div
                className="shrink-0 size-7 rounded-md flex items-center justify-center text-sm"
                style={{ backgroundColor: n.color }}
              >
                {n.icon}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[10px] leading-tight">
                  <span className="text-white font-bold">{n.who}</span>{" "}
                  <span className="text-white/70">{n.what}</span>
                </div>
                <div className="text-[8px] text-white/45 mt-0.5">
                  {n.meta}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Stars background
// ---------------------------------------------------------------------------
const STARS_STYLE: React.CSSProperties = {
  backgroundImage:
    "radial-gradient(circle at 20% 30%, white 1px, transparent 1.5px), radial-gradient(circle at 70% 60%, white 1px, transparent 1.5px), radial-gradient(circle at 40% 80%, white 0.8px, transparent 1.2px), radial-gradient(circle at 85% 20%, white 1px, transparent 1.5px)",
  backgroundSize: "320px 320px, 240px 240px, 180px 180px, 280px 280px",
};

