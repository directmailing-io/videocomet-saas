"use client";

import dynamic from "next/dynamic";
import * as React from "react";
import type { Player as PlayerType, PlayerRef } from "@remotion/player";
import { Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import HowItWorksComposition, {
  HOWITWORKS_FPS,
  HOWITWORKS_FRAMES,
  HOWITWORKS_WIDTH,
  HOWITWORKS_HEIGHT,
  HOWITWORKS_STEPS,
} from "./remotion/HowItWorksComposition";

function PlayerSkeleton() {
  return <div className="absolute inset-0 bg-surface-soft animate-pulse" />;
}

const Player = dynamic(
  () => import("@remotion/player").then((m) => m.Player),
  { ssr: false, loading: () => <PlayerSkeleton /> },
) as unknown as typeof PlayerType;

export function HowItWorksSection() {
  const playerRef = React.useRef<PlayerRef>(null);
  const [activeStep, setActiveStep] = React.useState(0);

  // Subscribe to frame updates → highlight current step
  React.useEffect(() => {
    const p = playerRef.current;
    if (!p) return;
    const onFrame = (e: { detail: { frame: number } }) => {
      const f = e.detail.frame;
      const idx = HOWITWORKS_STEPS.findIndex(
        (s) => f >= s.from && f < s.from + s.duration,
      );
      if (idx >= 0) setActiveStep(idx);
    };
    p.addEventListener("frameupdate", onFrame);
    return () => p.removeEventListener("frameupdate", onFrame);
  }, []);

  // Force-play (iOS-safe), Player is silent
  React.useEffect(() => {
    const tryPlay = () => {
      const p = playerRef.current;
      if (!p) return;
      try {
        p.mute();
        p.play();
      } catch {
        /* noop */
      }
    };
    tryPlay();
    const t1 = window.setTimeout(tryPlay, 300);
    const t2 = window.setTimeout(tryPlay, 1000);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, []);

  const handleStepClick = (i: number) => {
    const p = playerRef.current;
    if (!p) return;
    try {
      p.seekTo(HOWITWORKS_STEPS[i].from + 2);
      p.play();
    } catch {
      /* noop */
    }
    setActiveStep(i);
  };

  return (
    <section
      id="how-it-works"
      className="relative z-[1] w-full bg-white py-24 md:py-32"
    >
      <div className="max-w-6xl mx-auto px-6 md:px-10">
        <div className="max-w-2xl mx-auto text-center mb-14 md:mb-16">
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

        {/* Step row */}
        <div className="flex flex-wrap items-center justify-center gap-2 mb-8">
          {HOWITWORKS_STEPS.map((s, i) => {
            const isActive = i === activeStep;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => handleStepClick(i)}
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

        {/* Player */}
        <div className="relative w-full max-w-5xl mx-auto aspect-[16/10] rounded-3xl overflow-hidden shadow-[0_30px_80px_-30px_rgba(15,23,42,0.35)] border border-line">
          <Player
            ref={playerRef}
            component={HowItWorksComposition}
            durationInFrames={HOWITWORKS_FRAMES}
            fps={HOWITWORKS_FPS}
            compositionWidth={HOWITWORKS_WIDTH}
            compositionHeight={HOWITWORKS_HEIGHT}
            autoPlay
            loop
            controls={false}
            style={{ width: "100%", height: "100%" }}
          />
        </div>

        <p className="mt-6 text-center text-xs text-ink-muted">
          Klick auf einen Schritt und die Animation springt zu dieser Stelle.
        </p>
      </div>
    </section>
  );
}
