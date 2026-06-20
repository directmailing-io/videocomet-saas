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

// Composition-Dauer = 600 Frames (20 s @ 30 fps) — knapp ueber die echte
// Webcam-Laenge (19,9 s), damit der `<Video loop>`-Cut sauber mit dem
// Composition-Loop zusammenfaellt. Vorher: 360 Frames (12 s) → Webcam wurde
// frueh abgeschnitten und der Restart sah hart aus.
export const DEMO_FPS = 30;
export const DEMO_DURATION_IN_FRAMES = 600;
export const DEMO_WIDTH = 1920;
export const DEMO_HEIGHT = 1080;

export type MarketingDemoMode =
  | "screenshot"
  | "scroll"
  | "slides"
  | "gdocs"
  | "solo";

export type MarketingDemoProps = {
  mode: MarketingDemoMode;
  [key: string]: unknown;
};

const SCREENSHOT_SRC = "/demo-assets/website-screenshot.png";
const GDOCS_SRC = "/demo-assets/gdocs-document.png";
const WEBCAM_MP4 = "/demo-assets/webcam.mp4";

const SLIDE_SRCS = [1, 2, 3, 4, 5].map(
  (n) => `/demo-assets/slide-${n}.png`,
);

// 5 Slides × 120 Frames (4 s) = 600 Frames → fuellt die ganze Composition
// gleichmaessig. Crossfade 12 Frames Overlap.
const SLIDE_DURATION = 132;
const SLIDE_STEP = 120;

function ScrollBackground() {
  const frame = useCurrentFrame();
  // Bild 1200x8000, skaliert auf 1920 width → 1920x12800 effektiv.
  // Wir scrollen tief (bis -10000) damit die ganze Seite sichtbar wird,
  // dann wieder hoch.
  const translateY = interpolate(
    frame,
    [0, 280, 320, 600],
    [0, -10000, -10000, 0],
    {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    },
  );

  return (
    <AbsoluteFill style={{ overflow: "hidden", backgroundColor: "#FFFFFF" }}>
      <Img
        src={staticFile(SCREENSHOT_SRC)}
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          width: "100%",
          height: "auto",
          transform: `translateY(${translateY}px)`,
          willChange: "transform",
          display: "block",
        }}
      />
    </AbsoluteFill>
  );
}

/**
 * Google-Docs-Scrollvideo: zeigt ein Dokument im Docs-Chrome (Top-Bar,
 * Toolbar, Sidebar wie bei Slides) und scrollt durch. Webcam bleibt
 * unten-links als Kreis.
 */
function GoogleDocsBackground() {
  const frame = useCurrentFrame();
  // Dokument-Hoehe (1100x6000 → bei contain auf 1080 Stage = ca. 5891 effective)
  // Wir scrollen 0 → -3800 → pause → 0
  const translateY = interpolate(
    frame,
    [0, 280, 320, 600],
    [0, -3800, -3800, 0],
    {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    },
  );

  return (
    <AbsoluteFill
      style={{
        backgroundColor: "#F1F3F4",
        fontFamily: "'Google Sans', Roboto, Arial, sans-serif",
      }}
    >
      {/* Top bar */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          height: 56,
          backgroundColor: "#FFFFFF",
          borderBottom: "1px solid #DADCE0",
          display: "flex",
          alignItems: "center",
          gap: 16,
          padding: "0 20px",
          zIndex: 2,
        }}
      >
        <div
          style={{
            width: 36,
            height: 36,
            borderRadius: 6,
            backgroundColor: "#4285F4",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 20,
            fontWeight: 700,
            color: "#FFFFFF",
          }}
        >
          ▤
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 18, fontWeight: 500, color: "#202124" }}>
            Angebot Mustermann GmbH
          </div>
          <div
            style={{
              fontSize: 13,
              color: "#5F6368",
              display: "flex",
              gap: 18,
              marginTop: 4,
            }}
          >
            <span>Datei</span>
            <span>Bearbeiten</span>
            <span>Ansicht</span>
            <span>Einfügen</span>
            <span>Format</span>
            <span>Tools</span>
            <span>Hilfe</span>
          </div>
        </div>
        <div
          style={{
            padding: "8px 20px",
            borderRadius: 4,
            backgroundColor: "#1A73E8",
            color: "#FFFFFF",
            fontSize: 14,
            fontWeight: 500,
          }}
        >
          Teilen
        </div>
        <div
          style={{
            width: 36,
            height: 36,
            borderRadius: "50%",
            background: "linear-gradient(135deg, #AA8CF5, #7C5CE8)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#FFFFFF",
            fontWeight: 600,
            fontSize: 14,
          }}
        >
          CS
        </div>
      </div>

      {/* Toolbar */}
      <div
        style={{
          position: "absolute",
          top: 56,
          left: 0,
          right: 0,
          height: 40,
          backgroundColor: "#FFFFFF",
          borderBottom: "1px solid #DADCE0",
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "0 20px",
          fontSize: 12,
          color: "#5F6368",
          zIndex: 2,
        }}
      >
        {["↶", "↷", "🖨", "100 %", "Standardtext", "Arial", "11", "B", "I", "U", "🎨", "🔗", "▦", "—"].map(
          (k) => (
            <div
              key={k}
              style={{
                padding: "4px 8px",
                borderRadius: 4,
                fontWeight: k === "B" ? 700 : 400,
                fontStyle: k === "I" ? "italic" : "normal",
                textDecoration: k === "U" ? "underline" : "none",
              }}
            >
              {k}
            </div>
          ),
        )}
      </div>

      {/* Document scroll area */}
      <div
        style={{
          position: "absolute",
          top: 96,
          left: 0,
          right: 0,
          bottom: 0,
          overflow: "hidden",
          backgroundColor: "#F8F9FA",
          display: "flex",
          justifyContent: "center",
        }}
      >
        <div
          style={{
            position: "relative",
            width: 880,
            maxWidth: "100%",
            transform: `translateY(${translateY}px)`,
            willChange: "transform",
          }}
        >
          <Img
            src={staticFile(GDOCS_SRC)}
            style={{
              width: "100%",
              height: "auto",
              display: "block",
              boxShadow: "0 1px 3px rgba(60,64,67,0.15)",
            }}
          />
        </div>
      </div>
    </AbsoluteFill>
  );
}

function SlideFrame({ src, index }: { src: string; index: number }) {
  const frame = useCurrentFrame();
  const opacity = interpolate(
    frame,
    [0, 12, SLIDE_DURATION - 14, SLIDE_DURATION],
    [0, 1, 1, 0],
    {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    },
  );

  // Slide-Bild + Google-Slides-aehnliches Chrome drumherum, damit der User
  // sofort erkennt: "das ist eine Praesentation".
  return (
    <AbsoluteFill style={{ opacity, backgroundColor: "#F1F3F4" }}>
      <GoogleSlidesChrome slideNumber={index + 1} totalSlides={SLIDE_SRCS.length}>
        <Img
          src={staticFile(src)}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "contain",
            backgroundColor: "#FFFFFF",
          }}
        />
      </GoogleSlidesChrome>
    </AbsoluteFill>
  );
}

/**
 * Google-Slides-Chrome: realistischer Tab-Bar + Toolbar + Sidebar mit
 * Slide-Thumbnails. Das Slide selbst landet im grossen Stage-Bereich.
 */
function GoogleSlidesChrome({
  children,
  slideNumber,
  totalSlides,
}: {
  children: React.ReactNode;
  slideNumber: number;
  totalSlides: number;
}) {
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        flexDirection: "column",
        backgroundColor: "#F1F3F4",
        fontFamily:
          "'Google Sans', Roboto, Arial, sans-serif",
        color: "#3C4043",
      }}
    >
      {/* Top bar — title + Google-Konto */}
      <div
        style={{
          height: 56,
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          gap: 16,
          padding: "0 20px",
          backgroundColor: "#FFFFFF",
          borderBottom: "1px solid #DADCE0",
        }}
      >
        <div
          style={{
            width: 36,
            height: 36,
            borderRadius: 6,
            backgroundColor: "#FBBC04",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 22,
            fontWeight: 700,
            color: "#FFFFFF",
          }}
        >
          ▱
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 18, fontWeight: 500, color: "#202124" }}>
            VideoComet Pitch
          </div>
          <div
            style={{
              fontSize: 13,
              color: "#5F6368",
              display: "flex",
              gap: 18,
              marginTop: 4,
            }}
          >
            <span>Datei</span>
            <span>Bearbeiten</span>
            <span>Ansicht</span>
            <span>Einfügen</span>
            <span>Folie</span>
            <span>Format</span>
            <span>Hilfe</span>
          </div>
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
          }}
        >
          <div
            style={{
              padding: "8px 20px",
              borderRadius: 4,
              backgroundColor: "#1A73E8",
              color: "#FFFFFF",
              fontSize: 14,
              fontWeight: 500,
            }}
          >
            Präsentieren
          </div>
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: "50%",
              background: "linear-gradient(135deg, #AA8CF5, #7C5CE8)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#FFFFFF",
              fontWeight: 600,
              fontSize: 14,
            }}
          >
            CS
          </div>
        </div>
      </div>

      {/* Toolbar */}
      <div
        style={{
          height: 40,
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "0 20px",
          backgroundColor: "#FFFFFF",
          borderBottom: "1px solid #DADCE0",
          fontSize: 12,
          color: "#5F6368",
        }}
      >
        {["↶", "↷", "🖨", "🔍 100 %", "🅰", "B", "I", "U", "🎨", "▦", "—", "🔗"].map(
          (k) => (
            <div
              key={k}
              style={{
                padding: "4px 8px",
                borderRadius: 4,
                fontWeight: k === "B" ? 700 : 400,
                fontStyle: k === "I" ? "italic" : "normal",
                textDecoration: k === "U" ? "underline" : "none",
              }}
            >
              {k}
            </div>
          ),
        )}
      </div>

      {/* Body */}
      <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
        {/* Sidebar with slide thumbnails */}
        <div
          style={{
            width: 200,
            flexShrink: 0,
            backgroundColor: "#FFFFFF",
            borderRight: "1px solid #DADCE0",
            padding: 12,
            display: "flex",
            flexDirection: "column",
            gap: 10,
            overflow: "hidden",
          }}
        >
          {Array.from({ length: totalSlides }).map((_, i) => {
            const idx = i + 1;
            const active = idx === slideNumber;
            return (
              <div
                key={idx}
                style={{
                  display: "flex",
                  gap: 8,
                  alignItems: "stretch",
                }}
              >
                <div
                  style={{
                    width: 16,
                    color: active ? "#1A73E8" : "#5F6368",
                    fontSize: 13,
                    fontWeight: active ? 600 : 400,
                    textAlign: "right",
                  }}
                >
                  {idx}
                </div>
                <div
                  style={{
                    flex: 1,
                    aspectRatio: "16/9",
                    borderRadius: 4,
                    backgroundColor: active ? "#E8F0FE" : "#FFFFFF",
                    border: active
                      ? "2px solid #1A73E8"
                      : "1px solid #DADCE0",
                    overflow: "hidden",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "#9AA0A6",
                    fontSize: 10,
                    fontWeight: 500,
                  }}
                >
                  Slide {idx}
                </div>
              </div>
            );
          })}
        </div>

        {/* Main stage */}
        <div
          style={{
            flex: 1,
            backgroundColor: "#F8F9FA",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 28,
            minWidth: 0,
            minHeight: 0,
          }}
        >
          <div
            style={{
              width: "100%",
              maxWidth: "100%",
              aspectRatio: "16/9",
              backgroundColor: "#FFFFFF",
              boxShadow:
                "0 1px 3px rgba(60,64,67,0.15), 0 4px 8px rgba(60,64,67,0.1)",
              borderRadius: 2,
              overflow: "hidden",
              position: "relative",
            }}
          >
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}

function SlidesBackground() {
  return (
    <AbsoluteFill style={{ backgroundColor: "#F1F3F4" }}>
      {SLIDE_SRCS.map((src, i) => (
        <Sequence
          key={src}
          from={i * SLIDE_STEP}
          durationInFrames={SLIDE_DURATION}
          layout="none"
        >
          <SlideFrame src={src} index={i} />
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
  if (mode === "gdocs") return <GoogleDocsBackground />;
  return null;
}

export default function MarketingDemoComposition({
  mode,
}: MarketingDemoProps) {
  // Webcam-PiP: bottom-LEFT statt right, perfekter KREIS (square + 50%).
  // In solo-Mode wird daraus fullscreen via CSS-Transition.
  const wrapperStyle: React.CSSProperties =
    mode === "solo"
      ? {
          position: "absolute",
          inset: 0,
          borderRadius: 0,
          boxShadow: "none",
          overflow: "hidden",
          transition: "all 450ms cubic-bezier(0.2,0.8,0.2,1)",
        }
      : {
          position: "absolute",
          bottom: 56,
          left: 56,
          width: 360,
          height: 360,
          borderRadius: 9999,
          boxShadow:
            "0 30px 60px -15px rgba(0,0,0,0.55), 0 0 0 6px rgba(255,255,255,0.95)",
          overflow: "hidden",
          transition: "all 450ms cubic-bezier(0.2,0.8,0.2,1)",
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
