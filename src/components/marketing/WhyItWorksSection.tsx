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

        {/* Stats: drei riesige Zahlen */}
        <div className="mt-20 md:mt-32 grid grid-cols-1 md:grid-cols-3 gap-12 md:gap-6">
          <RevealOnScroll delay={400}>
            <Stat
              number="9 / 10"
              line1="öffnen einen Brief,"
              line2="der echt aussieht."
            />
          </RevealOnScroll>
          <RevealOnScroll delay={500}>
            <Stat
              number="1 / 30"
              line1="antwortet auf eine"
              line2="0815-Cold-Email."
              muted
            />
          </RevealOnScroll>
          <RevealOnScroll delay={600}>
            <Stat
              number="∞"
              line1="bleibt im Kopf,"
              line2="wenn es persönlich war."
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

      {/* MAIN: Video player */}
      <div
        className="relative rounded-2xl overflow-hidden border border-white/10 aspect-video"
        style={{
          boxShadow:
            "0 50px 100px -20px rgba(0,0,0,0.7), 0 0 0 1px rgba(255,255,255,0.06)",
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
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Big-Number Stat
// ---------------------------------------------------------------------------

function Stat({
  number,
  line1,
  line2,
  muted,
}: {
  number: string;
  line1: string;
  line2: string;
  muted?: boolean;
}) {
  return (
    <div className="text-center md:text-left">
      <div
        className="font-extralight tracking-[-0.05em] leading-none mb-3 md:mb-5"
        style={{
          fontSize: "clamp(68px, 9.5vw, 132px)",
          background: muted
            ? "linear-gradient(180deg, rgba(255,255,255,0.45) 0%, rgba(255,255,255,0.15) 100%)"
            : "linear-gradient(180deg, #FFFFFF 0%, rgba(255,255,255,0.55) 100%)",
          WebkitBackgroundClip: "text",
          backgroundClip: "text",
          color: "transparent",
        }}
      >
        {number}
      </div>
      <div className="text-[15px] md:text-base leading-snug">
        <span className="text-white/75">{line1}</span>
        <br />
        <span className="text-white/45">{line2}</span>
      </div>
    </div>
  );
}
