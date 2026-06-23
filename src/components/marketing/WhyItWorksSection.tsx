"use client";

import * as React from "react";
import { Play } from "lucide-react";
import { RevealOnScroll } from "./RevealOnScroll";

/**
 * Dark-Mode Editorial Section am Ende der Page.
 * Apple-Style: Mega-Typography mit Kontrast (muted vs bright),
 * EIN Hero-Visual statt 0815-Icon-Card-Grid, drei Big-Number-Stats.
 */
export function WhyItWorksSection() {
  return (
    <section
      id="why-it-works"
      className="relative z-[2] w-full bg-black overflow-hidden"
      style={{ paddingTop: "clamp(96px, 14vw, 180px)", paddingBottom: "clamp(96px, 14vw, 180px)" }}
    >
      {/* Top radial glow */}
      <div
        aria-hidden
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "radial-gradient(70% 60% at 50% 25%, rgba(124,92,232,0.16) 0%, transparent 70%)",
        }}
      />
      {/* Bottom soft fade */}
      <div
        aria-hidden
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "radial-gradient(50% 40% at 50% 100%, rgba(82,50,199,0.10) 0%, transparent 70%)",
        }}
      />

      <div className="relative max-w-6xl mx-auto px-6 md:px-10">
        {/* Eyebrow */}
        <RevealOnScroll delay={0}>
          <div className="text-center mb-10">
            <div className="inline-flex items-center px-3.5 py-1.5 rounded-full bg-white/[0.08] border border-white/10 text-white/80 text-[11px] font-semibold tracking-[0.2em] uppercase">
              Die Strategie
            </div>
          </div>
        </RevealOnScroll>

        {/* Mega editorial headline */}
        <RevealOnScroll delay={150}>
          <h2
            className="text-center font-light tracking-[-0.04em] leading-[1.02] mb-20 md:mb-28"
            style={{ fontSize: "clamp(34px, 5.4vw, 68px)" }}
          >
            <span className="text-white/25 block">Alle senden E-Mails.</span>
            <span className="text-white/25 block">Alle schalten Ads.</span>
            <span className="block mt-7 text-white">
              Du schickst einen Brief,
            </span>
            <span
              className="block font-semibold"
              style={{ color: "#C9BAFF" }}
            >
              in dem ein Video sitzt.
            </span>
          </h2>
        </RevealOnScroll>

        {/* Hero Video-Letter visual */}
        <RevealOnScroll delay={300}>
          <HeroComposition />
        </RevealOnScroll>

        {/* Drei Benefits — editorial, kein Card-Grid */}
        <div className="mt-24 md:mt-36 grid grid-cols-1 md:grid-cols-3 gap-14 md:gap-12">
          <RevealOnScroll delay={400}>
            <Benefit
              title="Du hebst dich von der Masse ab."
              body="Niemand erwartet einen Brief mit Video. Schon der Briefkasten verrät, dass hier jemand mehr getan hat als alle anderen."
            />
          </RevealOnScroll>
          <RevealOnScroll delay={500}>
            <Benefit
              title="Du bleibst in Erinnerung."
              body="Was du in der Hand hattest, vergisst du nicht. Wo Ads weggeklickt werden, wirst du erinnert."
            />
          </RevealOnScroll>
          <RevealOnScroll delay={600}>
            <Benefit
              title="Du baust Vertrauen, bevor du verkaufst."
              body="Wer dich gesehen hat, hört dir später zu. Persönlichkeit schafft Sympathie, und Sympathie öffnet Türen."
            />
          </RevealOnScroll>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Hero Video Letter composition
// ---------------------------------------------------------------------------

function HeroComposition() {
  return (
    <div className="relative mx-auto" style={{ maxWidth: 580 }}>
      {/* Massive glow behind */}
      <div
        aria-hidden
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "radial-gradient(50% 50% at 50% 50%, rgba(124,92,232,0.45) 0%, transparent 65%)",
          transform: "scale(1.5)",
          filter: "blur(40px)",
        }}
      />

      {/* Subtle letter card behind */}
      <div
        aria-hidden
        className="absolute"
        style={{
          left: "8%",
          top: "12%",
          width: "84%",
          aspectRatio: "16/10",
          background:
            "linear-gradient(180deg, rgba(255,255,255,0.04) 0%, rgba(255,255,255,0.01) 100%)",
          border: "1px solid rgba(255,255,255,0.06)",
          borderRadius: 16,
          transform: "rotate(-3deg) translateY(20px)",
        }}
      />

      {/* MAIN: Video player — mit Dark-Vignette die in den BG einblendet */}
      <div
        className="relative rounded-2xl overflow-hidden border border-white/[0.06] aspect-video"
        style={{
          boxShadow:
            "0 40px 100px -30px rgba(0,0,0,0.85), inset 0 0 80px -20px rgba(0,0,0,0.5)",
        }}
      >
        {/* Brand hero gradient */}
        <div
          className="absolute inset-0 flex items-center"
          style={{
            background:
              "linear-gradient(135deg, #6D28D9 0%, #7C5CE8 35%, #D946EF 100%)",
          }}
        >
          {/* radial highlight */}
          <div
            aria-hidden
            className="absolute inset-0"
            style={{
              background:
                "radial-gradient(50% 80% at 30% 30%, rgba(255,255,255,0.2), transparent 60%)",
            }}
          />

          <div className="relative flex-1 px-6 md:px-10 pr-28 md:pr-40">
            <div className="text-[10px] md:text-[12px] font-bold tracking-[0.3em] uppercase text-white/85 mb-3">
              Persönlich für dich
            </div>
            <div
              className="font-extrabold text-white leading-[1.02] tracking-[-0.02em]"
              style={{ fontSize: "clamp(22px,3.4vw,40px)" }}
            >
              Max,
              <br />
              schau dir das an.
            </div>
          </div>
        </div>

        {/* Webcam — bottom-left, BEHIND controls */}
        <div
          className="absolute left-4 bottom-4 rounded-2xl overflow-hidden border-2 border-white/95"
          style={{
            width: 76,
            height: 76,
            boxShadow: "0 8px 22px -4px rgba(0,0,0,0.55)",
            zIndex: 1,
          }}
        >
          <img
            src="/demo-assets/webcam-still.jpg"
            alt=""
            className="w-full h-full object-cover"
          />
        </div>

        {/* Play button center */}
        <div
          className="absolute inset-0 flex items-center justify-center pointer-events-none"
          style={{ zIndex: 3 }}
        >
          <div
            className="size-16 md:size-20 rounded-full flex items-center justify-center backdrop-blur-md border border-white/30"
            style={{
              background: "rgba(0,0,0,0.4)",
              boxShadow: "0 14px 36px -6px rgba(0,0,0,0.5)",
            }}
          >
            <Play className="size-6 md:size-8 text-white fill-white ml-1" />
          </div>
        </div>

        {/* Bottom controls gradient (over webcam) */}
        <div
          className="absolute inset-x-0 bottom-0 px-5 pt-12 pb-3.5"
          style={{
            zIndex: 2,
            background:
              "linear-gradient(to top, rgba(0,0,0,0.92) 0%, rgba(0,0,0,0.55) 55%, rgba(0,0,0,0) 100%)",
          }}
        >
          <div className="h-[3px] bg-white/25 rounded-full overflow-hidden">
            <div
              className="h-full bg-white rounded-full"
              style={{ width: "38%" }}
            />
          </div>
        </div>

        {/* DARK VIGNETTE — Video verblasst zu den Raendern in den BG */}
        <div
          aria-hidden
          className="absolute inset-0 pointer-events-none"
          style={{
            background:
              "radial-gradient(115% 95% at 50% 25%, transparent 45%, rgba(0,0,0,0.55) 85%, rgba(0,0,0,0.85) 100%)",
            zIndex: 4,
          }}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Benefit — editorial, kein Card-Grid
// ---------------------------------------------------------------------------

function Benefit({ title, body }: { title: string; body: string }) {
  return (
    <div className="text-left">
      {/* Brand-Accent-Line */}
      <div
        className="h-px w-10 mb-6"
        style={{
          background:
            "linear-gradient(to right, #C9BAFF, rgba(201,186,255,0.2))",
        }}
      />
      <h3
        className="font-semibold tracking-[-0.02em] leading-[1.15] text-white mb-4"
        style={{ fontSize: "clamp(20px, 1.9vw, 26px)" }}
      >
        {title}
      </h3>
      <p
        className="text-white/55 leading-relaxed"
        style={{ fontSize: "clamp(14.5px, 1.05vw, 16px)" }}
      >
        {body}
      </p>
    </div>
  );
}
