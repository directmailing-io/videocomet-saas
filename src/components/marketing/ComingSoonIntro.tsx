"use client";

import Image from "next/image";
import * as React from "react";
import { RevealOnScroll } from "./RevealOnScroll";

/**
 * COMING-SOON-Sektion für die persönliche KI-Begrüßung.
 *
 * Steht direkt unter dem Hero: Video-Mockup (Thumbnail mit Play-Button)
 * plus Sprechblase, in der der Vorname im Loop wechselt („Hi Max",
 * „Hi Julia", ...). Bewusst reduziert und groß gesetzt, im Stil einer
 * Apple-Feature-Ankündigung, aber mit den bestehenden Seiten-Tokens
 * (Lavendel-Canvas, Brand-Gradient, Ink).
 */

const NAMES = [
  "Max",
  "Julia",
  "Peter",
  "Daniel",
  "Sabine",
  "Andreas",
  "Lisa",
  "Markus",
  "Nina",
  "Thomas",
];

const NAME_INTERVAL_MS = 2000;

function useRotatingName(): string {
  const [idx, setIdx] = React.useState(0);
  React.useEffect(() => {
    const id = window.setInterval(
      () => setIdx((i) => (i + 1) % NAMES.length),
      NAME_INTERVAL_MS,
    );
    return () => window.clearInterval(id);
  }, []);
  return NAMES[idx];
}

/** Kleine animierte Audio-Balken neben dem Namen — „das wird gesprochen". */
function VoiceBars() {
  return (
    <span className="vc-cs-bars inline-flex items-end gap-[3px] h-[14px]" aria-hidden>
      <span className="w-[3px] rounded-full bg-white/85" style={{ animationDelay: "0ms" }} />
      <span className="w-[3px] rounded-full bg-white/85" style={{ animationDelay: "150ms" }} />
      <span className="w-[3px] rounded-full bg-white/85" style={{ animationDelay: "300ms" }} />
      <span className="w-[3px] rounded-full bg-white/85" style={{ animationDelay: "450ms" }} />
    </span>
  );
}

export function ComingSoonIntro() {
  const name = useRotatingName();

  return (
    <section
      id="ki-begruessung"
      aria-label="Coming soon: Persönliche KI-Begrüßung"
      className="relative z-[1] w-full bg-[#f7f5fd] text-ink overflow-hidden pt-6 pb-20 md:pt-10 md:pb-32"
    >
      <div
        aria-hidden
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "radial-gradient(90% 70% at 50% 30%, rgba(170,140,245,0.16) 0%, rgba(170,140,245,0.05) 45%, rgba(170,140,245,0) 100%)",
        }}
      />

      <div className="relative max-w-5xl mx-auto px-6 md:px-10">
        <div className="text-center max-w-3xl mx-auto mb-12 md:mb-16">
          <RevealOnScroll delay={0}>
            <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-white border border-brand-200 text-brand-deep text-[11px] font-semibold tracking-[0.18em] uppercase mb-7 shadow-[0_2px_12px_-4px_rgba(124,92,232,0.25)]">
              <span className="relative flex size-2" aria-hidden>
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand opacity-60" />
                <span className="relative inline-flex size-2 rounded-full bg-brand" />
              </span>
              Coming soon
            </div>
          </RevealOnScroll>

          <RevealOnScroll delay={200}>
            <h2 className="font-light tracking-[-0.04em] leading-[1.05] text-ink text-[clamp(34px,4.6vw,60px)] text-balance">
              Ein Video.
            </h2>
          </RevealOnScroll>

          <RevealOnScroll delay={380}>
            <h2
              className="font-light tracking-[-0.04em] leading-[1.05] bg-clip-text text-transparent text-[clamp(34px,4.6vw,60px)] text-balance"
              style={{
                backgroundImage:
                  "linear-gradient(96deg, #9573EE 0%, #7C5CE8 45%, #5E44C2 75%, #3F2D8A 100%)",
              }}
            >
              Jeder Lead hört seinen Namen.
            </h2>
          </RevealOnScroll>

          <RevealOnScroll delay={540}>
            <h2 className="font-light tracking-[-0.04em] leading-[1.05] text-ink text-[clamp(34px,4.6vw,60px)] text-balance">
              In deiner Stimme.
            </h2>
          </RevealOnScroll>

          <RevealOnScroll delay={820}>
            <p className="mt-9 text-lg md:text-xl leading-relaxed text-ink-soft text-balance max-w-xl mx-auto">
              Du nimmst dein Video ganz normal auf. VIDEOCOMET spricht die
              Begrüßung dann{" "}
              <strong className="font-semibold text-ink">
                für jeden Lead einzeln mit Vornamen
              </strong>
              , in deiner Stimme und mit passenden Lippenbewegungen. Klingt
              nach Zauberei, ist aber bald einfach ein Klick.
            </p>
          </RevealOnScroll>
        </div>

        <RevealOnScroll delay={1020}>
          <div className="relative max-w-3xl mx-auto">
            {/* Video-Mockup */}
            <div className="relative rounded-[24px] md:rounded-[32px] overflow-hidden shadow-[0_30px_80px_-20px_rgba(63,45,138,0.35)] ring-1 ring-white/60">
              <div className="relative aspect-video">
                <Image
                  src="/marketing/ki-intro-thumb.webp"
                  alt="Vorschaubild eines Outreach-Videos: ein Mann winkt freundlich in die Kamera"
                  fill
                  sizes="(max-width: 768px) 100vw, 768px"
                  className="object-cover"
                />
                {/* Play-Button in der Mitte */}
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className="vc-cs-play inline-flex size-16 md:size-20 items-center justify-center rounded-full bg-white/75 backdrop-blur-md shadow-[0_8px_30px_-6px_rgba(30,20,70,0.45)]">
                    <svg
                      width="26"
                      height="26"
                      viewBox="0 0 24 24"
                      fill="currentColor"
                      className="text-ink translate-x-[2px]"
                      aria-hidden
                    >
                      <path d="M8 5.5v13l11-6.5z" />
                    </svg>
                  </span>
                </div>
                {/* Player-Chrome unten */}
                <div
                  className="absolute inset-x-0 bottom-0 pt-10 pb-3.5 px-4 md:px-5"
                  style={{
                    background:
                      "linear-gradient(180deg, rgba(15,10,35,0) 0%, rgba(15,10,35,0.55) 100%)",
                  }}
                  aria-hidden
                >
                  <div className="flex items-center gap-3">
                    <span className="text-white/90 text-[11px] font-medium font-mono tabular-nums">
                      0:00
                    </span>
                    <span className="relative h-[4px] flex-1 rounded-full bg-white/25 overflow-hidden">
                      <span
                        className="absolute inset-y-0 left-0 w-[14%] rounded-full"
                        style={{
                          background:
                            "linear-gradient(90deg, #9573EE 0%, #7C5CE8 100%)",
                        }}
                      />
                    </span>
                    <span className="text-white/60 text-[11px] font-medium font-mono tabular-nums">
                      0:38
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Sprechblase mit rotierendem Vornamen */}
            <div
              className="absolute -top-5 right-3 md:-top-7 md:-right-10"
              aria-hidden
            >
              <div
                key={name}
                className="vc-cs-bubble relative flex items-center gap-2.5 rounded-full pl-4 pr-5 py-2.5 md:py-3 text-white shadow-[0_14px_40px_-10px_rgba(63,45,138,0.55)]"
                style={{
                  background:
                    "linear-gradient(120deg, #9573EE 0%, #7C5CE8 55%, #5E44C2 100%)",
                }}
              >
                <VoiceBars />
                <span className="text-sm md:text-base font-semibold whitespace-nowrap">
                  „Hi {name}!"
                </span>
                {/* Sprechblasen-Zipfel */}
                <span
                  className="absolute -bottom-1.5 left-6 size-3.5 rotate-45 rounded-[3px]"
                  style={{ background: "#8465e9" }}
                />
              </div>
            </div>

            {/* Kleines Info-Pill unten links */}
            <div
              className="absolute -bottom-4 left-4 md:-bottom-5 md:-left-8 flex items-center gap-2 rounded-full bg-white/85 backdrop-blur-md px-4 py-2 md:py-2.5 shadow-[0_10px_30px_-8px_rgba(63,45,138,0.35)] ring-1 ring-white/70"
              aria-hidden
            >
              <span className="inline-flex size-5 items-center justify-center rounded-full bg-brand-soft text-brand-deep">
                <svg
                  width="11"
                  height="11"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden
                >
                  <path d="M12 2a4 4 0 0 0-4 4v6a4 4 0 0 0 8 0V6a4 4 0 0 0-4-4z" />
                  <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                  <path d="M12 19v3" />
                </svg>
              </span>
              <span className="text-xs md:text-[13px] font-semibold text-ink whitespace-nowrap">
                Deine Stimme, echte Lippenbewegungen
              </span>
            </div>
          </div>
        </RevealOnScroll>

        <RevealOnScroll delay={1200}>
          <p className="mt-14 md:mt-16 text-center text-[13px] text-ink/55">
            Startet in Kürze für alle VIDEOCOMET Kunden. Ganz ohne
            Zusatz-Setup, du brauchst nur dein Video.
          </p>
        </RevealOnScroll>
      </div>

      <style>{`
        @keyframes vc-cs-bubble-pop {
          0%   { opacity: 0; transform: translateY(10px) scale(0.9); }
          60%  { opacity: 1; transform: translateY(-2px) scale(1.03); }
          100% { opacity: 1; transform: translateY(0) scale(1); }
        }
        .vc-cs-bubble {
          animation: vc-cs-bubble-pop 0.45s cubic-bezier(0.2, 0.8, 0.2, 1) both;
          transform-origin: 20% 100%;
        }
        @keyframes vc-cs-bar-bounce {
          0%, 100% { height: 5px; }
          50%      { height: 14px; }
        }
        .vc-cs-bars span {
          height: 5px;
          animation: vc-cs-bar-bounce 0.9s ease-in-out infinite;
        }
        @keyframes vc-cs-play-breathe {
          0%, 100% { transform: scale(1); }
          50%      { transform: scale(1.06); }
        }
        .vc-cs-play {
          animation: vc-cs-play-breathe 3.2s ease-in-out infinite;
        }
        @media (prefers-reduced-motion: reduce) {
          .vc-cs-bubble, .vc-cs-bars span, .vc-cs-play {
            animation: none;
          }
        }
      `}</style>
    </section>
  );
}
