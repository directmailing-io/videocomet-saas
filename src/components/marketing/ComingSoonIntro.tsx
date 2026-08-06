"use client";

import Image from "next/image";
import * as React from "react";
import { Squircle } from "./Squircle";

/**
 * COMING-SOON-Card für die persönliche KI-Begrüßung.
 *
 * Sitzt als breite Top-Card in der Features-Bento: links das Video-Mockup
 * (Thumbnail mit Play-Button) plus Sprechblase, in der der Vorname im Loop
 * wechselt („Hi Max", „Hi Julia", ...), rechts Headline + Copy. Nutzt die
 * bestehenden Seiten-Tokens (Lavendel, Brand-Gradient, Ink).
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

export function ComingSoonFeatureCard() {
  const name = useRotatingName();

  return (
    <Squircle
      radius={28}
      shadow="pretty"
      wrapperClassName="h-full"
      className="relative p-8 md:p-12 flex flex-col lg:flex-row gap-12 lg:gap-14 items-center overflow-hidden"
    >
      {/* Lavendel-Canvas + Glow — hebt die Card als „Ankündigung" vom Rest ab */}
      <div
        aria-hidden
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "radial-gradient(70% 90% at 20% 0%, rgba(170,140,245,0.28) 0%, transparent 55%), radial-gradient(60% 80% at 100% 100%, rgba(149,115,238,0.20) 0%, transparent 55%), #f7f5fd",
        }}
      />

      {/* Visual: Video-Mockup + Sprechblase */}
      <div className="relative flex-1 w-full max-w-[560px] mx-auto lg:mx-0 pt-6 pb-5">
        <div className="relative rounded-[20px] md:rounded-[24px] overflow-hidden shadow-[0_30px_80px_-20px_rgba(63,45,138,0.35)] ring-1 ring-white/60">
          <div className="relative aspect-video">
            <Image
              src="/marketing/ki-intro-thumb.webp"
              alt="Vorschaubild eines Outreach-Videos: ein Mann winkt freundlich in die Kamera"
              fill
              sizes="(max-width: 768px) 100vw, 560px"
              className="object-cover"
            />
            {/* Play-Button in der Mitte */}
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="vc-cs-play inline-flex size-14 md:size-16 items-center justify-center rounded-full bg-white/75 backdrop-blur-md shadow-[0_8px_30px_-6px_rgba(30,20,70,0.45)]">
                <svg
                  width="24"
                  height="24"
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
        <div className="absolute -top-0 right-2 md:-top-1 md:-right-3" aria-hidden>
          <div
            key={name}
            className="vc-cs-bubble relative flex items-center gap-2.5 rounded-full pl-4 pr-5 py-2.5 text-white shadow-[0_14px_40px_-10px_rgba(63,45,138,0.55)]"
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
          className="absolute -bottom-0 left-3 md:-bottom-1 md:left-1 flex items-center gap-2 rounded-full bg-white/85 backdrop-blur-md px-4 py-2 shadow-[0_10px_30px_-8px_rgba(63,45,138,0.35)] ring-1 ring-white/70"
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

      {/* Text rechts */}
      <div className="relative lg:w-[380px] lg:shrink-0 text-center lg:text-left">
        <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-white border border-brand-200 text-brand-deep text-[11px] font-semibold tracking-[0.18em] uppercase mb-6 shadow-[0_2px_12px_-4px_rgba(124,92,232,0.25)]">
          <span className="relative flex size-2" aria-hidden>
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand opacity-60" />
            <span className="relative inline-flex size-2 rounded-full bg-brand" />
          </span>
          Coming soon
        </div>

        <h3 className="font-light tracking-[-0.03em] text-ink leading-[1.08] text-[clamp(28px,3.2vw,40px)] text-balance">
          Ein Video.{" "}
          <span
            className="bg-clip-text text-transparent font-normal"
            style={{
              backgroundImage:
                "linear-gradient(96deg, #9573EE 0%, #7C5CE8 45%, #5E44C2 75%, #3F2D8A 100%)",
            }}
          >
            Jeder Lead hört seinen Namen.
          </span>{" "}
          In deiner Stimme.
        </h3>

        <p className="mt-5 text-[15px] md:text-base leading-relaxed text-ink-soft text-balance">
          Du nimmst dein Video ganz normal auf. VIDEOCOMET spricht die
          Begrüßung dann{" "}
          <strong className="font-semibold text-ink">
            für jeden Lead einzeln mit Vornamen
          </strong>
          , in deiner Stimme und mit passenden Lippenbewegungen. Klingt nach
          Zauberei, ist aber bald einfach ein Klick.
        </p>

        <p className="mt-5 text-[12.5px] text-ink/55">
          Startet in Kürze für alle VIDEOCOMET Kunden. Ganz ohne
          Zusatz-Setup, du brauchst nur dein Video.
        </p>
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
    </Squircle>
  );
}
