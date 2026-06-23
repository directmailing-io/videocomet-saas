"use client";

import * as React from "react";
import {
  BarChart3,
  Film,
  Heart,
  MapPin,
  MessageSquareText,
  Sparkles,
} from "lucide-react";
import { RevealOnScroll } from "./RevealOnScroll";

type Reason = {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  body: string;
};

const REASONS: ReadonlyArray<Reason> = [
  {
    icon: Sparkles,
    title: "Du fällst auf, weil alle anderen das Gleiche machen.",
    body: "Jeder schaltet Ads. Jeder postet bei LinkedIn. Fast niemand schickt einen Brief, in dem ein persönliches Video auf den Empfänger wartet. Du bist die Ausnahme. Ausnahmen bleiben im Kopf.",
  },
  {
    icon: Film,
    title: "Aus Broschüre wird Aufmerksamkeit.",
    body: "32 Seiten Hochglanz liest niemand, der dich nicht kennt. Ein zwei Minuten Video, in dem du ihn persönlich ansprichst, schaut sich der Empfänger fast immer an. Aus Druckkosten wird Werbewirkung mit Emotion.",
  },
  {
    icon: MessageSquareText,
    title: "LinkedIn ohne 0815-Nachrichten.",
    body: "Statt der hundertsten Standardanfrage schickst du ein kurzes Kennenlernvideo. Du baust Problembewusstsein auf oder zeigst echte Kundenergebnisse. Vertrauen entsteht nicht durch Worte, sondern durch Persönlichkeit.",
  },
  {
    icon: BarChart3,
    title: "Du testest, was wirklich überzeugt.",
    body: "Jede Öffnung, jede Watchtime, jeder Klick wird getrackt. Du weißt, welches Wording heute zieht, und nimmst die Erkenntnis direkt mit ins ganze Marketing. Bauchgefühl wird durch Daten ersetzt.",
  },
  {
    icon: MapPin,
    title: "250 Briefe. 250 Briefkästen.",
    body: "Bei Meta Ads kann ein falscher Haken dein Budget verbrennen. Ein Brief landet zuverlässig dort, wo er hingehört. Du planst sauber, du verbrennst kein Geld, und du hast die Wirkung in der Hand.",
  },
  {
    icon: Heart,
    title: "Mietfrei im Kopf des Empfängers.",
    body: "Wenn jemand spürt, dass du dir extra Zeit genommen hast, signalisiert das Respekt. Respekt schafft Sympathie. Sympathie schafft Erinnerung. Du bleibst da, wo andere weggeklickt werden.",
  },
];

/**
 * Dark-Mode "Warum das funktioniert" Section.
 * Sitzt zwischen DemoSection und HowItWorksSection.
 * Apple-Style: clean, viel Whitespace, klare Hierarchie.
 */
export function WhyItWorksSection() {
  return (
    <section
      id="why-it-works"
      className="relative z-[2] w-full bg-black py-24 md:py-32 overflow-hidden"
    >
      {/* Subtle radial glow oben */}
      <div
        aria-hidden
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "radial-gradient(70% 50% at 50% 0%, rgba(124,92,232,0.14) 0%, transparent 60%)",
        }}
      />
      {/* Subtle radial glow unten */}
      <div
        aria-hidden
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "radial-gradient(60% 40% at 50% 100%, rgba(82,50,199,0.10) 0%, transparent 70%)",
        }}
      />

      <div className="relative max-w-6xl mx-auto px-6 md:px-10">
        {/* Header */}
        <div className="max-w-3xl mx-auto text-center mb-16 md:mb-24">
          <RevealOnScroll delay={0}>
            <div className="inline-flex items-center px-3.5 py-1.5 rounded-full bg-white/[0.08] text-white/80 text-[11px] font-semibold tracking-[0.18em] uppercase mb-6 border border-white/10">
              Die Strategie
            </div>
          </RevealOnScroll>
          <RevealOnScroll delay={150}>
            <h2 className="font-light tracking-[-0.035em] text-white leading-[1.05] text-[clamp(34px,4.6vw,60px)] mb-6 text-balance">
              Warum das funktioniert,
              <br />
              <span
                className="font-semibold"
                style={{ color: "#C9BAFF" }}
              >
                wenn nichts anderes mehr zieht.
              </span>
            </h2>
          </RevealOnScroll>
          <RevealOnScroll delay={300}>
            <p className="text-white/60 text-lg leading-relaxed text-balance max-w-xl mx-auto">
              Ads werden teurer. Organischer Content braucht Jahre.
              Ein persönlicher Brief mit Video kommt sofort an. Und
              bleibt im Kopf.
            </p>
          </RevealOnScroll>
        </div>

        {/* Reasons-Grid 3x2 */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-5">
          {REASONS.map((r, i) => (
            <RevealOnScroll key={r.title} delay={400 + i * 100}>
              <ReasonCard {...r} />
            </RevealOnScroll>
          ))}
        </div>
      </div>
    </section>
  );
}

function ReasonCard({
  icon: Icon,
  title,
  body,
}: Reason) {
  return (
    <div className="relative h-full overflow-hidden rounded-3xl border border-white/[0.08] bg-white/[0.025] backdrop-blur-sm p-7 md:p-8 transition-colors hover:bg-white/[0.045] hover:border-white/[0.14]">
      {/* Subtle top highlight line */}
      <div
        aria-hidden
        className="absolute inset-x-0 top-0 h-px"
        style={{
          background:
            "linear-gradient(90deg, transparent, rgba(255,255,255,0.12), transparent)",
        }}
      />

      {/* Icon */}
      <div
        className="size-11 rounded-2xl flex items-center justify-center mb-5"
        style={{
          background: "linear-gradient(135deg, #7C5CE8 0%, #5232C7 100%)",
          boxShadow:
            "0 8px 22px -4px rgba(124,92,232,0.5), inset 0 1px 0 rgba(255,255,255,0.15)",
        }}
      >
        <Icon className="size-5 text-white" />
      </div>

      {/* Title */}
      <h3 className="text-[19px] md:text-[20px] font-semibold tracking-[-0.015em] text-white leading-[1.2] mb-3 text-balance">
        {title}
      </h3>

      {/* Body */}
      <p className="text-[14.5px] text-white/65 leading-relaxed text-balance">
        {body}
      </p>
    </div>
  );
}
