"use client";

import dynamic from "next/dynamic";
import * as React from "react";
import { Volume2, VolumeX } from "lucide-react";
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
  const [muted, setMuted] = React.useState(true);
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
  // some browsers (Safari + strict Chrome policies) — without this, the Player
  // stays paused on frame 0 and the timeline never advances, so scroll-mode
  // looks static and slides start at opacity 0 (= blank). The Player is muted
  // so play() is allowed even without user gesture.
  React.useEffect(() => {
    const tryPlay = () => {
      const p = playerRef.current;
      if (!p) return;
      try {
        p.play();
      } catch {
        /* noop — Player may not be ready yet */
      }
    };
    // First attempt right after mount, retry shortly after in case Player
    // wasn't ready yet (dynamic import).
    tryPlay();
    const t1 = window.setTimeout(tryPlay, 300);
    const t2 = window.setTimeout(tryPlay, 1000);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, []);

  const handleToggleMute = React.useCallback(() => {
    setMuted((prev) => {
      const next = !prev;
      const p = playerRef.current;
      if (p) {
        try {
          if (next) {
            p.mute();
          } else {
            p.unmute();
          }
        } catch {
          /* noop — Player may not be ready yet */
        }
      }
      return next;
    });
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
        <button
          type="button"
          onClick={handleToggleMute}
          className="absolute bottom-3 right-3 z-10 inline-flex items-center gap-1.5 rounded-full bg-black/60 backdrop-blur px-3 py-1.5 text-xs font-medium text-white hover:bg-black/80 transition-colors"
          aria-label={muted ? "Ton an" : "Ton aus"}
        >
          {muted ? (
            <VolumeX className="size-3.5" />
          ) : (
            <Volume2 className="size-3.5" />
          )}
          {muted ? "Ton an" : "Ton aus"}
        </button>
      </div>
      <p className="text-center text-xs text-ink-muted">
        Demo. Echte Videos werden in deinem Account erzeugt.
      </p>
    </div>
  );
}
