"use client";

import * as React from "react";
import {
  AbsoluteFill,
  Video,
  Img,
  Sequence,
  useCurrentFrame,
  interpolate,
  staticFile,
} from "remotion";

export const DEMO_FPS = 30;
export const DEMO_DURATION_IN_FRAMES = 360;
export const DEMO_WIDTH = 1920;
export const DEMO_HEIGHT = 1080;

export type MarketingDemoMode = "screenshot" | "scroll" | "slides" | "solo";

export type MarketingDemoProps = {
  mode: MarketingDemoMode;
  [key: string]: unknown;
};

const SCREENSHOT_SRC = "/demo-assets/website-screenshot.png";
const WEBCAM_MP4 = "/demo-assets/webcam.mp4";

const SLIDE_SRCS = [1, 2, 3, 4, 5].map(
  (n) => `/demo-assets/slide-${n}.png`,
);

// Crossfade for slides: each slide visible for 75 frames, next slide starts 70
// frames after the previous one (so we get a 5-frame overlap for the fade).
const SLIDE_DURATION = 75;
const SLIDE_STEP = 70;

function ScrollBackground() {
  const frame = useCurrentFrame();
  const translateY = interpolate(
    frame,
    [0, 90, 180, 360],
    [0, -800, -800, -2000],
    {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    },
  );

  return (
    <AbsoluteFill style={{ overflow: "hidden", backgroundColor: "#0F172A" }}>
      <div
        style={{
          position: "absolute",
          inset: 0,
          transform: `translateY(${translateY}px)`,
          willChange: "transform",
        }}
      >
        <Img
          src={staticFile(SCREENSHOT_SRC)}
          style={{
            width: "100%",
            height: "auto",
            display: "block",
          }}
        />
      </div>
    </AbsoluteFill>
  );
}

function SlideFrame({ src }: { src: string }) {
  const frame = useCurrentFrame();
  const opacity = interpolate(
    frame,
    [0, 8, SLIDE_DURATION - 10, SLIDE_DURATION],
    [0, 1, 1, 0],
    {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    },
  );

  return (
    <AbsoluteFill style={{ opacity }}>
      <Img
        src={staticFile(src)}
        style={{
          width: "100%",
          height: "100%",
          objectFit: "cover",
        }}
      />
    </AbsoluteFill>
  );
}

function SlidesBackground() {
  return (
    <AbsoluteFill style={{ backgroundColor: "#0F172A" }}>
      {SLIDE_SRCS.map((src, i) => (
        <Sequence
          key={src}
          from={i * SLIDE_STEP}
          durationInFrames={SLIDE_DURATION}
          layout="none"
        >
          <SlideFrame src={src} />
        </Sequence>
      ))}
    </AbsoluteFill>
  );
}

function ScreenshotBackground() {
  return (
    <AbsoluteFill style={{ backgroundColor: "#0F172A" }}>
      <Img
        src={staticFile(SCREENSHOT_SRC)}
        style={{
          width: "100%",
          height: "100%",
          objectFit: "cover",
          objectPosition: "top",
        }}
      />
    </AbsoluteFill>
  );
}

function Background({ mode }: { mode: MarketingDemoMode }) {
  if (mode === "screenshot") return <ScreenshotBackground />;
  if (mode === "scroll") return <ScrollBackground />;
  if (mode === "slides") return <SlidesBackground />;
  return null;
}

export default function MarketingDemoComposition({
  mode,
}: MarketingDemoProps) {
  const wrapperStyle: React.CSSProperties =
    mode === "solo"
      ? {
          position: "absolute",
          inset: 0,
          borderRadius: 0,
          boxShadow: "none",
          overflow: "hidden",
          transition: "all 400ms cubic-bezier(0.2,0.8,0.2,1)",
        }
      : {
          position: "absolute",
          bottom: 48,
          right: 48,
          width: 420,
          height: 315,
          borderRadius: 24,
          boxShadow:
            "0 30px 60px -15px rgba(0,0,0,0.55), 0 0 0 4px rgba(255,255,255,0.9)",
          overflow: "hidden",
          transition: "all 400ms cubic-bezier(0.2,0.8,0.2,1)",
        };

  return (
    <AbsoluteFill style={{ backgroundColor: "#0F172A" }}>
      {/* Layer 1: background switches by mode */}
      <Background mode={mode} />

      {/* Layer 2: STABLE webcam — always rendered at the same JSX position
          so that the underlying <video> element does not remount when mode
          changes. Only the wrapper styles transition. */}
      <div style={wrapperStyle}>
        <Video
          src={staticFile(WEBCAM_MP4)}
          muted
          playsInline
          loop
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
          }}
        />
      </div>
    </AbsoluteFill>
  );
}
