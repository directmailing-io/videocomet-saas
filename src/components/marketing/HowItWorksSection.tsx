import * as React from "react";
import { ArrowDown, ArrowRight, Eye } from "lucide-react";
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
              Drei Schritte, einmal ungefähr 30 Minuten. Danach kriegt{" "}
              <strong className="font-semibold text-ink">
                jeder Lead sein eigenes Video
              </strong>
              , egal ob 50 oder 5.000.
            </p>
          </RevealOnScroll>
        </div>

        {/* 3 Schritte mit Pfeilen dazwischen */}
        <div className="flex flex-col md:flex-row md:items-stretch gap-3 md:gap-0">
          <RevealOnScroll delay={100} className="flex-1 min-w-0">
            <StepCard
              number={1}
              title="Einmal aufnehmen"
              text="Nimm ein Video mit deiner Webcam auf. Ganz locker, so wie du auch eine Sprachnachricht schicken würdest."
            >
              <RecordVisual />
            </StepCard>
          </RevealOnScroll>

          <StepArrow delay={200} />

          <RevealOnScroll delay={250} className="flex-1 min-w-0">
            <StepCard
              number={2}
              title="Leads hochladen"
              text="Wirf deine Leadliste rein. Den Rest macht VIDEOCOMET: Jeder Lead bekommt automatisch sein eigenes Video samt Landingpage."
            >
              <LeadsVisual />
            </StepCard>
          </RevealOnScroll>

          <StepArrow delay={350} />

          <RevealOnScroll delay={400} className="flex-1 min-w-0">
            <StepCard
              number={3}
              title="Verschicken & zuschauen"
              text="Verschick alles per E-Mail, LinkedIn oder Brief. Danach siehst du live, wer sich dein Video gerade anschaut."
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
    <div className="h-full rounded-[28px] vc-squircle vc-shadow-pretty bg-[#f8f7fd] p-5 md:p-6 flex flex-col">
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
// Mini-Visuals: Sky-Hintergrund + genau ein weißes UI-Element, apple-like
// ---------------------------------------------------------------------------

function Visual({
  position,
  children,
}: {
  position: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className="relative h-40 rounded-2xl vc-squircle overflow-hidden bg-cover"
      style={{
        backgroundImage: "url(/visual-sky.jpg)",
        backgroundPosition: position,
      }}
      aria-hidden
    >
      <div className="absolute inset-0 flex items-center justify-center p-4">
        {children}
      </div>
    </div>
  );
}

const GLASS_CARD =
  "rounded-2xl vc-squircle bg-white/95 backdrop-blur-md shadow-[0_16px_40px_-12px_rgba(20,10,60,0.45)]";

function RecordVisual() {
  return (
    <Visual position="50% 18%">
      <div className={`${GLASS_CARD} px-4 py-3 flex items-center gap-2.5`}>
        <span className="vc-rec-dot size-2 rounded-full bg-red-500 shrink-0" />
        <span className="text-[13px] font-semibold text-ink">
          Aufnahme läuft
        </span>
        <span className="text-[12px] text-ink-muted tabular-nums">0:48</span>
      </div>
    </Visual>
  );
}

const AVATARS = [
  { initials: "MM", grad: "linear-gradient(135deg, #7C5CE8, #5232C7)" },
  { initials: "LL", grad: "linear-gradient(135deg, #EC4899, #BE185D)" },
  { initials: "FF", grad: "linear-gradient(135deg, #F97316, #C2410C)" },
];

function LeadsVisual() {
  return (
    <Visual position="50% 50%">
      <div className={`${GLASS_CARD} px-4 py-3 flex items-center gap-3`}>
        <div className="flex -space-x-2">
          {AVATARS.map((a) => (
            <span
              key={a.initials}
              className="size-7 rounded-full ring-2 ring-white flex items-center justify-center text-white text-[9px] font-bold"
              style={{ background: a.grad }}
            >
              {a.initials}
            </span>
          ))}
        </div>
        <div className="leading-tight">
          <div className="text-[13px] font-semibold text-ink">217 Videos</div>
          <div className="text-[11px] text-ink-muted">eins pro Lead, fertig</div>
        </div>
      </div>
    </Visual>
  );
}

function TrackingVisual() {
  return (
    <Visual position="50% 88%">
      <div className={`${GLASS_CARD} px-3.5 py-3 flex items-start gap-3 w-full max-w-[250px]`}>
        <span
          className="size-9 shrink-0 rounded-[10px] flex items-center justify-center text-white"
          style={{ background: "linear-gradient(135deg, #7C5CE8, #5232C7)" }}
        >
          <Eye className="size-4" />
        </span>
        <div className="flex-1 min-w-0 leading-tight">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-[13px] font-semibold text-ink truncate">
              Max Mustermann
            </span>
            <span className="text-[10px] text-ink-muted shrink-0">Jetzt</span>
          </div>
          <div className="text-[12px] text-ink-muted mt-0.5">
            schaut gerade dein Video an
          </div>
        </div>
      </div>
    </Visual>
  );
}
