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
              Der Unterschied
            </div>
          </div>
        </RevealOnScroll>

        {/* Kleiner muted Kontext-Satz */}
        <RevealOnScroll delay={150}>
          <p
            className="text-center text-white/45 leading-relaxed max-w-2xl mx-auto mb-7"
            style={{ fontSize: "clamp(14.5px, 1.1vw, 17px)" }}
          >
            Deine Mitbewerber senden E-Mails, die nicht gelesen werden,
            schalten Ads, die weggescrollt werden, und rufen ständig
            mit denselben Floskeln an.
          </p>
        </RevealOnScroll>

        {/* Mega editorial headline — die positive Antithese */}
        <RevealOnScroll delay={250}>
          <h2
            className="text-center font-light tracking-[-0.04em] leading-[1.05] mb-20 md:mb-28 max-w-4xl mx-auto"
            style={{ fontSize: "clamp(32px, 5vw, 64px)" }}
          >
            <span className="block text-white">
              Du hebst dich mit einem persönlichen Video ab
            </span>
            <span
              className="block font-semibold"
              style={{ color: "#C9BAFF" }}
            >
              und bleibst positiv in Erinnerung.
            </span>
          </h2>
        </RevealOnScroll>

        {/* Hero Video */}
        <RevealOnScroll delay={300}>
          <HeroComposition />
        </RevealOnScroll>

        {/* 3 Benefits unter dem Video */}
        <div className="mt-24 md:mt-36 grid grid-cols-1 md:grid-cols-3 gap-16 md:gap-12 lg:gap-20">
          <RevealOnScroll delay={400}>
            <Benefit
              index="01"
              title="Du fällst auf, ohne lauter zu sein."
              body="Einen Brief mit Video bekommt kaum jemand. Schon das fällt auf, noch bevor das Video überhaupt läuft."
            />
          </RevealOnScroll>
          <RevealOnScroll delay={500}>
            <Benefit
              index="02"
              title="Du bleibst lange positiv in Erinnerung."
              body="Was persönlich war, vergisst niemand schnell. Wo Werbung nach Sekunden weg ist, denkt der Empfänger noch Wochen später an dich."
            />
          </RevealOnScroll>
          <RevealOnScroll delay={600}>
            <Benefit
              index="03"
              title="Du gewinnst Vertrauen noch vor dem echten Gespräch."
              body="Beim ersten Termin bist du kein Unbekannter mehr. Du hast schon Sympathie aufgebaut, bevor das erste Wort gesprochen wurde."
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
    <div className="relative mx-auto" style={{ maxWidth: 720 }}>
      {/* Brand backdrop glow — nicht masked, gibt Tiefe */}
      <div
        aria-hidden
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "radial-gradient(50% 50% at 50% 50%, rgba(124,92,232,0.4) 0%, transparent 70%)",
          transform: "scale(1.7)",
          filter: "blur(60px)",
        }}
      />

      {/* MAIN: Video player — Nebelartig in den BG verschwindend */}
      <div
        className="relative rounded-3xl overflow-hidden aspect-video"
        style={{
          WebkitMaskImage:
            "radial-gradient(85% 78% at 50% 45%, black 12%, rgba(0,0,0,0.92) 32%, rgba(0,0,0,0.5) 58%, rgba(0,0,0,0.15) 82%, transparent 100%)",
          maskImage:
            "radial-gradient(85% 78% at 50% 45%, black 12%, rgba(0,0,0,0.92) 32%, rgba(0,0,0,0.5) 58%, rgba(0,0,0,0.15) 82%, transparent 100%)",
        }}
      >
        {/* Premium Dark Hero */}
        <div
          className="absolute inset-0 flex items-center"
          style={{
            background:
              "linear-gradient(135deg, #0B0418 0%, #1A0E3A 35%, #2A1656 65%, #160828 100%)",
          }}
        >
          {/* Subtle radial highlight upper-left */}
          <div
            aria-hidden
            className="absolute inset-0"
            style={{
              background:
                "radial-gradient(45% 70% at 22% 22%, rgba(170,140,245,0.28) 0%, transparent 65%)",
            }}
          />
          {/* Subtle brand-glow lower-right */}
          <div
            aria-hidden
            className="absolute inset-0"
            style={{
              background:
                "radial-gradient(35% 60% at 85% 85%, rgba(124,92,232,0.20) 0%, transparent 65%)",
            }}
          />

          <div className="relative flex-1 px-8 md:px-14 pr-28 md:pr-44">
            <div
              className="font-extrabold text-white leading-[1.08] tracking-[-0.02em]"
              style={{ fontSize: "clamp(17px, 2.4vw, 32px)" }}
            >
              Herr Müller, die Wahrheit
              <br />
              in der Baubranche sieht
              <br />
              folgendermaßen aus:
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
// Benefit — Mega-Number Apple-Style
// ---------------------------------------------------------------------------

function Benefit({
  index,
  title,
  body,
}: {
  index: string;
  title: string;
  body: string;
}) {
  return (
    <div className="relative text-left">
      {/* Mega Brand-Soft Number — visueller Akzent */}
      <div
        className="font-extralight tracking-[-0.06em] leading-[0.85] mb-7 md:mb-9 tabular-nums"
        style={{
          fontSize: "clamp(72px, 8.5vw, 124px)",
          background:
            "linear-gradient(180deg, rgba(221,208,255,0.95) 0%, rgba(201,186,255,0.5) 35%, rgba(124,92,232,0.08) 100%)",
          WebkitBackgroundClip: "text",
          backgroundClip: "text",
          color: "transparent",
          paddingBottom: "0.05em",
        }}
      >
        {index}
      </div>

      {/* Title */}
      <h3
        className="font-semibold tracking-[-0.02em] leading-[1.15] text-white mb-4"
        style={{ fontSize: "clamp(20px, 1.85vw, 26px)" }}
      >
        {title}
      </h3>

      {/* Body */}
      <p
        className="text-white/55 leading-relaxed"
        style={{ fontSize: "clamp(14.5px, 1.05vw, 16.5px)" }}
      >
        {body}
      </p>
    </div>
  );
}
