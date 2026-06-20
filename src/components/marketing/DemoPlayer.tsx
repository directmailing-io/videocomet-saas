"use client";

import dynamic from "next/dynamic";
import * as React from "react";
import { Volume2, VolumeX } from "lucide-react";
import type { Player as PlayerType, PlayerRef } from "@remotion/player";
import { DemoToggleGroup } from "./DemoToggleGroup";
import MarketingDemoComposition, {
  DEMO_FPS,
  DEMO_DURATION_IN_FRAMES,
  DEMO_WIDTH,
  DEMO_HEIGHT,
} from "./remotion/MarketingDemoComposition";

export type DemoMode =
  | "screenshot"
  | "scroll"
  | "slides"
  | "gdocs"
  | "solo";

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
  "/demo-assets/gdocs-document.png",
  "/demo-assets/slide-1.png",
  "/demo-assets/slide-2.png",
  "/demo-assets/slide-3.png",
  "/demo-assets/slide-4.png",
  "/demo-assets/slide-5.png",
];

export function DemoPlayer() {
  const [mode, setMode] = React.useState<DemoMode>("screenshot");
  const [muted, setMuted] = React.useState(true);
  const playerRef = React.useRef<PlayerRef>(null);

  // Preload images so background switches are instant
  React.useEffect(() => {
    PRELOAD_IMAGES.forEach((src) => {
      const img = new window.Image();
      img.src = src;
    });
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
          inputProps={{ mode }}
          durationInFrames={DEMO_DURATION_IN_FRAMES}
          fps={DEMO_FPS}
          compositionWidth={DEMO_WIDTH}
          compositionHeight={DEMO_HEIGHT}
          autoPlay
          loop
          controls={false}
          style={{ width: "100%", height: "100%" }}
        />
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
