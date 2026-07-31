import * as React from "react";
import {
  ArrowDown,
  ArrowRight,
  AtSign,
  Check,
  Eye,
  Linkedin,
  Mail,
} from "lucide-react";
import { RevealOnScroll } from "./RevealOnScroll";

export function HowItWorksSection() {
  return (
    <section
      id="how-it-works"
      className="relative z-[2] w-full bg-white py-16 md:py-32 rounded-t-[32px] md:rounded-t-[48px] -mt-8 md:-mt-12 shadow-[0_-20px_60px_-20px_rgba(60,50,110,0.18)]"
    >
      <div className="max-w-6xl mx-auto px-6 md:px-10">
        <div className="max-w-2xl mx-auto text-center mb-12 md:mb-16">
          <RevealOnScroll delay={0}>
            <div className="inline-flex items-center px-3.5 py-1.5 rounded-full bg-brand-soft text-brand-deep text-[11px] font-semibold tracking-[0.18em] uppercase mb-6">
              Der Ablauf
            </div>
          </RevealOnScroll>
          <RevealOnScroll delay={100}>
            <h2 className="font-light tracking-[-0.035em] text-ink leading-[1.05] text-[clamp(32px,4.2vw,56px)] mb-5 text-balance">
              Ein Video.
              <br />
              <span className="font-semibold text-brand-deep">
                Tausend persönliche Versionen.
              </span>
            </h2>
          </RevealOnScroll>
          <RevealOnScroll delay={200}>
            <p className="text-ink-muted text-lg leading-relaxed text-balance max-w-2xl mx-auto">
              Drei Schritte, einmalig ungefähr 30 Minuten. Danach erreichst du{" "}
              <strong className="font-semibold text-ink">
                beliebig viele Leads
              </strong>{" "}
              — jeder mit seinem eigenen Video.
            </p>
          </RevealOnScroll>
        </div>

        {/* 3 Schritte mit Pfeilen dazwischen */}
        <div className="flex flex-col md:flex-row md:items-stretch gap-3 md:gap-0">
          <RevealOnScroll delay={100} className="flex-1 min-w-0">
            <StepCard
              number={1}
              title="Einmal aufnehmen"
              text="Nimm ein einziges Video mit deiner Webcam auf. Ganz normal, wie eine Sprachnachricht mit Bild."
            >
              <RecordVisual />
            </StepCard>
          </RevealOnScroll>

          <StepArrow delay={200} />

          <RevealOnScroll delay={250} className="flex-1 min-w-0">
            <StepCard
              number={2}
              title="Leads hochladen"
              text="Lade deine Leadliste hoch. Für jeden Empfänger entsteht automatisch ein persönliches Video mit eigener Landingpage."
            >
              <LeadsVisual />
            </StepCard>
          </RevealOnScroll>

          <StepArrow delay={350} />

          <RevealOnScroll delay={400} className="flex-1 min-w-0">
            <StepCard
              number={3}
              title="Verschicken & zuschauen"
              text="Verschicke per E-Mail, LinkedIn oder Brief — und sieh live, wer dein Video gerade ansieht."
            >
              <TrackingVisual />
            </StepCard>
          </RevealOnScroll>
        </div>
      </div>

      <style>{`
        @keyframes vc-rec-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.35; }
        }
        .vc-rec-dot { animation: vc-rec-pulse 1.4s ease-in-out infinite; }
        @keyframes vc-live-pulse {
          0%, 100% { transform: scale(1); opacity: 1; }
          50% { transform: scale(1.35); opacity: 0.5; }
        }
        .vc-live-dot { animation: vc-live-pulse 1.6s ease-in-out infinite; }
      `}</style>
    </section>
  );
}

function StepCard({
  number,
  title,
  text,
  children,
}: {
  number: number;
  title: string;
  text: string;
  children: React.ReactNode;
}) {
  return (
    <div className="h-full rounded-3xl bg-[#f8f7fd] p-5 md:p-6 flex flex-col">
      {children}
      <div className="flex items-center gap-2.5 mt-5 mb-2">
        <span
          className="size-6 shrink-0 rounded-full bg-ink text-white text-[12px] font-bold flex items-center justify-center"
          aria-hidden
        >
          {number}
        </span>
        <h3 className="text-lg font-semibold text-ink leading-tight">
          {title}
        </h3>
      </div>
      <p className="text-[14.5px] leading-relaxed text-ink-soft">{text}</p>
    </div>
  );
}

function StepArrow({ delay }: { delay: number }) {
  return (
    <RevealOnScroll
      delay={delay}
      className="flex items-center justify-center md:px-2 shrink-0"
    >
      <span aria-hidden className="text-brand">
        <ArrowRight className="hidden md:block size-5" />
        <ArrowDown className="md:hidden size-5" />
      </span>
    </RevealOnScroll>
  );
}

// ---------------------------------------------------------------------------
// Mini-Visuals — bewusst simpel, ein Blick genügt
// ---------------------------------------------------------------------------

function RecordVisual() {
  return (
    <div
      className="relative h-40 rounded-2xl overflow-hidden"
      style={{ background: "linear-gradient(135deg, #7C5CE8, #9573EE)" }}
      aria-hidden
    >
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="size-16 rounded-full bg-white/95 flex items-center justify-center text-brand-deep font-bold text-lg shadow-lg">
          DU
        </div>
      </div>
      <span className="absolute top-3 left-3 inline-flex items-center gap-1.5 rounded-full bg-black/35 backdrop-blur px-2.5 py-1 text-[10px] font-semibold text-white">
        <span className="vc-rec-dot size-1.5 rounded-full bg-red-400" />
        REC
      </span>
      <span className="absolute bottom-3 right-3 rounded-full bg-black/35 backdrop-blur px-2.5 py-1 text-[10px] font-medium text-white tabular-nums">
        0:48
      </span>
    </div>
  );
}

const LEAD_ROWS = [
  { initials: "MM", name: "Max Mustermann", grad: "linear-gradient(135deg, #7C5CE8, #5232C7)" },
  { initials: "LL", name: "Lisa Lust", grad: "linear-gradient(135deg, #EC4899, #BE185D)" },
  { initials: "FF", name: "Franz Friedrich", grad: "linear-gradient(135deg, #F97316, #C2410C)" },
];

function LeadsVisual() {
  return (
    <div className="h-40 rounded-2xl bg-white p-3 flex flex-col justify-center gap-1.5" aria-hidden>
      {LEAD_ROWS.map((l) => (
        <div key={l.initials} className="flex items-center gap-2.5 rounded-xl px-2 py-1.5">
          <span
            className="size-7 shrink-0 rounded-full flex items-center justify-center text-white text-[9px] font-bold"
            style={{ background: l.grad }}
          >
            {l.initials}
          </span>
          <span className="flex-1 text-[12.5px] font-medium text-ink truncate">
            {l.name}
          </span>
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 text-emerald-600 text-[10px] font-semibold px-2 py-0.5">
            <Check className="size-3" />
            Video fertig
          </span>
        </div>
      ))}
      <span className="px-2 text-[11px] text-ink-muted">+ 214 weitere …</span>
    </div>
  );
}

function TrackingVisual() {
  return (
    <div className="h-40 rounded-2xl bg-white p-3 flex flex-col justify-center gap-2" aria-hidden>
      <div className="flex items-center gap-1.5">
        <ChannelPill icon={<AtSign className="size-3" />} label="E-Mail" />
        <ChannelPill icon={<Linkedin className="size-3" />} label="LinkedIn" />
        <ChannelPill icon={<Mail className="size-3" />} label="Brief" />
      </div>
      <div className="rounded-xl bg-[#f8f7fd] px-3 py-2.5 flex items-center gap-2.5">
        <span className="relative flex size-2 shrink-0">
          <span className="vc-live-dot absolute inline-flex h-full w-full rounded-full bg-emerald-400" />
          <span className="relative inline-flex size-2 rounded-full bg-emerald-500" />
        </span>
        <span className="text-[12px] text-ink leading-snug">
          <strong className="font-semibold">Max Mustermann</strong> schaut
          gerade dein Video
        </span>
      </div>
      <div className="flex items-center gap-2 px-1">
        <Eye className="size-3.5 text-brand-deep shrink-0" />
        <div className="flex-1 h-1.5 rounded-full bg-ink/[0.07] overflow-hidden">
          <div
            className="h-full rounded-full"
            style={{
              width: "78%",
              background: "linear-gradient(90deg, #7C5CE8, #9573EE)",
            }}
          />
        </div>
        <span className="text-[11px] font-semibold text-ink tabular-nums">
          78&nbsp;% gesehen
        </span>
      </div>
    </div>
  );
}

function ChannelPill({
  icon,
  label,
}: {
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-[#f8f7fd] text-ink-soft text-[10.5px] font-medium px-2 py-1">
      {icon}
      {label}
    </span>
  );
}
