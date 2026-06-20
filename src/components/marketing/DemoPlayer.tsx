"use client";

import dynamic from "next/dynamic";
import * as React from "react";
import { Info } from "lucide-react";
import type { Player as PlayerType, PlayerRef } from "@remotion/player";
import { cn } from "@/lib/utils";
import { DemoToggleGroup } from "./DemoToggleGroup";
import MarketingDemoComposition, {
  DEMO_FPS,
  DEMO_DURATION_IN_FRAMES,
  DEMO_WIDTH,
  DEMO_HEIGHT,
} from "./remotion/MarketingDemoComposition";

export type DemoMode = "screenshot" | "slides" | "gdocs" | "solo";

function PlayerSkeleton() {
  return <div className="absolute inset-0 bg-black animate-pulse" />;
}

// `next/dynamic` widens the generic Player signature to a non-generic one,
// which loses the link between `component` and `inputProps`. We cast back to
// the original Player type so TS can still infer the prop type from the
// composition component.
const Player = dynamic(
  () => import("@remotion/player").then((m) => m.Player),
  {
    ssr: false,
    loading: () => <PlayerSkeleton />,
  },
) as unknown as typeof PlayerType;

const PRELOAD_IMAGES = [
  "/demo-assets/website-screenshot.png",
  "/demo-assets/slide-1.png",
  "/demo-assets/slide-2.png",
  "/demo-assets/slide-3.png",
  "/demo-assets/slide-4.png",
  "/demo-assets/slide-5.png",
];

export function DemoPlayer() {
  const [mode, setMode] = React.useState<DemoMode>("screenshot");
  const [scrollEnabled, setScrollEnabled] = React.useState(false);
  const playerRef = React.useRef<PlayerRef>(null);

  const canScroll = mode === "screenshot" || mode === "gdocs";

  // Preload images so background switches are instant
  React.useEffect(() => {
    PRELOAD_IMAGES.forEach((src) => {
      const img = new window.Image();
      img.src = src;
    });
  }, []);

  // Force-start playback. Remotion Player's `autoPlay` prop is unreliable in
  // some browsers (Safari + strict Chrome policies). Player is permanently
  // muted, play() works without user gesture.
  React.useEffect(() => {
    const tryPlay = () => {
      const p = playerRef.current;
      if (!p) return;
      try {
        p.mute();
        p.play();
      } catch {
        /* noop — Player may not be ready yet */
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

  return (
    <div className="flex flex-col gap-6">
      <DemoToggleGroup value={mode} onChange={setMode} />
      <div className="relative w-full max-w-4xl mx-auto aspect-video rounded-2xl overflow-hidden shadow-2xl bg-black">
        <Player
          ref={playerRef}
          component={MarketingDemoComposition}
          inputProps={{ mode, scrollEnabled }}
          durationInFrames={DEMO_DURATION_IN_FRAMES}
          fps={DEMO_FPS}
          compositionWidth={DEMO_WIDTH}
          compositionHeight={DEMO_HEIGHT}
          autoPlay
          loop
          controls={false}
          style={{ width: "100%", height: "100%" }}
        />
        {canScroll ? (
          <button
            type="button"
            onClick={() => setScrollEnabled((v) => !v)}
            className={cn(
              "absolute bottom-3 left-3 z-10 inline-flex items-center gap-2 rounded-full backdrop-blur px-3.5 py-1.5 text-xs font-medium transition-colors",
              scrollEnabled
                ? "bg-brand text-white hover:bg-brand-deep"
                : "bg-black/60 text-white hover:bg-black/80",
            )}
            aria-pressed={scrollEnabled}
          >
            <span
              className={cn(
                "relative inline-flex h-3.5 w-6 rounded-full transition-colors",
                scrollEnabled ? "bg-white/40" : "bg-white/25",
              )}
            >
              <span
                className={cn(
                  "absolute top-0.5 size-2.5 rounded-full bg-white transition-all",
                  scrollEnabled ? "left-3" : "left-0.5",
                )}
              />
            </span>
            Scrollen aktivieren
          </button>
        ) : null}
      </div>
      {canScroll && scrollEnabled ? (
        <div className="mx-auto max-w-2xl rounded-squircle-md border border-warn/30 bg-warn-soft/50 px-4 py-3 text-xs text-ink-soft flex items-start gap-2.5">
          <Info className="size-4 text-warn shrink-0 mt-0.5" aria-hidden />
          <span>
            <strong className="text-ink font-semibold">
              Hinweis zur Demo:
            </strong>{" "}
            Das Scroll-Verhalten hier ist generiert und wirkt etwas
            mechanisch. In deinem echten Video zeichnest du das Scrollen
            vorab einmal selbst auf — dadurch sieht es 1:1 menschlich aus.
          </span>
        </div>
      ) : (
        <p className="text-center text-xs text-ink-muted">
          Demo. Echte Videos werden in deinem Account erzeugt.
        </p>
      )}
    </div>
  );
}
