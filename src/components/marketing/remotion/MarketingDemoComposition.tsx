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
// Composition-Loop zusammenfaellt.
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
  scrollEnabled?: boolean;
  [key: string]: unknown;
};

const SCREENSHOT_SRC = "/demo-assets/website-screenshot.png";
const WEBCAM_MP4 = "/demo-assets/webcam.mp4";

const SLIDE_SRCS = [1, 2, 3, 4, 5].map(
  (n) => `/demo-assets/slide-${n}.png`,
);

const SLIDE_DURATION = 132;
const SLIDE_STEP = 120;

const SANS = "'Inter', 'Helvetica Neue', Arial, sans-serif";
const GOOGLE_SANS =
  "'Google Sans', 'Roboto', 'Helvetica Neue', Arial, sans-serif";

function ScrollBackground({ scrollEnabled }: { scrollEnabled: boolean }) {
  // CSS-Keyframes statt useCurrentFrame: laeuft IMMER, auch wenn der
  // Remotion-Player aus irgendeinem Grund nicht spielt. Standardmaessig
  // Standbild — Scroll erst per Toggle. Animation ungleichmaessig:
  // mal scrollen, mal pausieren, mal kurz nach oben, dann weiter runter.
  // Wirkt wie ein echter Mensch, der die Seite anschaut.
  return (
    <AbsoluteFill style={{ overflow: "hidden", backgroundColor: "#FFFFFF" }}>
      <style>{`
        @keyframes vc-demo-scroll {
          0%   { transform: translateY(0); }
          10%  { transform: translateY(-1400px); }
          14%  { transform: translateY(-1400px); }
          20%  { transform: translateY(-900px); }
          24%  { transform: translateY(-900px); }
          34%  { transform: translateY(-3600px); }
          40%  { transform: translateY(-3600px); }
          45%  { transform: translateY(-3100px); }
          56%  { transform: translateY(-6400px); }
          62%  { transform: translateY(-6400px); }
          66%  { transform: translateY(-5700px); }
          80%  { transform: translateY(-9400px); }
          85%  { transform: translateY(-9400px); }
          90%  { transform: translateY(-8500px); }
          100% { transform: translateY(0); }
        }
      `}</style>
      <Img
        src={staticFile(SCREENSHOT_SRC)}
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          width: "100%",
          height: "auto",
          animation: scrollEnabled
            ? "vc-demo-scroll 45s ease-in-out infinite"
            : "none",
          transform: scrollEnabled ? undefined : "translateY(0)",
          willChange: "transform",
          display: "block",
        }}
      />
    </AbsoluteFill>
  );
}

/**
 * Google-Docs-Scrollvideo: zeigt ein echtes JSX-gerendertes Dokument im
 * Docs-Chrome (Top-Bar + Toolbar). Inhalt = personalisierter Schnell-
 * Check fuer "Max" mit 3 roten Findings. Scrollt langsam hoch und runter.
 */
function GoogleDocsBackground({
  scrollEnabled,
}: {
  scrollEnabled: boolean;
}) {
  // Wie ScrollBackground: Standbild per Default, langsame & ungleichmaessige
  // Scroll-Animation ueber CSS-Keyframes wenn aktiviert.
  return (
    <AbsoluteFill
      style={{
        backgroundColor: "#F1F3F4",
        fontFamily: GOOGLE_SANS,
      }}
    >
      <style>{`
        @keyframes vc-demo-gdocs-scroll {
          0%   { transform: translateY(0); }
          12%  { transform: translateY(-250px); }
          16%  { transform: translateY(-250px); }
          24%  { transform: translateY(-150px); }
          36%  { transform: translateY(-700px); }
          42%  { transform: translateY(-700px); }
          48%  { transform: translateY(-600px); }
          62%  { transform: translateY(-1200px); }
          68%  { transform: translateY(-1200px); }
          74%  { transform: translateY(-1050px); }
          88%  { transform: translateY(-1500px); }
          92%  { transform: translateY(-1500px); }
          100% { transform: translateY(0); }
        }
      `}</style>
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
            Notiz für Max
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
        {[
          "↶",
          "↷",
          "🖨",
          "100 %",
          "Standardtext",
          "Arial",
          "11",
          "B",
          "I",
          "U",
          "🎨",
          "🔗",
          "▦",
          "—",
        ].map((k) => (
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
        ))}
      </div>

      {/* Document area */}
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
          paddingTop: 40,
        }}
      >
        <div
          style={{
            width: 880,
            maxWidth: "100%",
            animation: scrollEnabled
              ? "vc-demo-gdocs-scroll 50s ease-in-out infinite"
              : "none",
            transform: scrollEnabled ? undefined : "translateY(0)",
            willChange: "transform",
          }}
        >
          <DocumentPaper />
        </div>
      </div>
    </AbsoluteFill>
  );
}

function DocumentPaper() {
  return (
    <div
      style={{
        backgroundColor: "#FFFFFF",
        boxShadow: "0 1px 3px rgba(60,64,67,0.15)",
        padding: "100px 110px",
        color: "#202124",
        fontSize: 17,
        lineHeight: 1.65,
        fontFamily: SANS,
      }}
    >
      <div
        style={{
          fontSize: 13,
          textTransform: "uppercase",
          letterSpacing: 2,
          color: "#7C5CE8",
          fontWeight: 600,
          marginBottom: 12,
        }}
      >
        Persönliche Notiz · Vertraulich
      </div>
      <h1
        style={{
          fontSize: 44,
          fontWeight: 700,
          margin: "0 0 12px 0",
          color: "#0F172A",
          letterSpacing: -0.5,
        }}
      >
        Notiz für Max
      </h1>
      <div style={{ color: "#5F6368", fontSize: 15, marginBottom: 36 }}>
        Schnell-Check für{" "}
        <span style={{ color: "#1A73E8", textDecoration: "underline" }}>
          mustermann-industrie.de
        </span>
      </div>

      <div
        style={{
          height: 1,
          backgroundColor: "#E8EAED",
          margin: "0 0 36px 0",
        }}
      />

      <p style={{ margin: "0 0 18px 0" }}>Hey Max,</p>
      <p style={{ margin: "0 0 18px 0" }}>
        ich hab heute morgen 15 Minuten in deiner Webseite verbracht. Mir
        sind <strong>drei Sachen</strong> aufgefallen, die dich aktuell
        jeden Tag Anfragen kosten — ich schreib&apos;s dir kurz auf, dann
        kannst du in Ruhe drauf gucken.
      </p>
      <p style={{ margin: "0 0 40px 0" }}>
        Wenn du Bock hast, packen wir die Punkte gemeinsam an. Termin per
        Klick auf das Video unten.
      </p>

      <ErrorBlock
        number={1}
        title="Kein Meta-Pixel installiert"
        body="Weder Meta- noch Google-Tag-Manager liegen im Quelltext. Heißt: jeder Besucher, der heute nicht direkt kauft, ist für Retargeting verloren. Setup-Aufwand: 30 Minuten. Impact: 25–40 % günstigere Leads, weil Wiederkehrer dramatisch besser konvertieren."
      />

      <ErrorBlock
        number={2}
        title="Keine echten Fallstudien sichtbar"
        body={'Auf „Über uns“ und „Referenzen“ zähle ich null messbare Cases. Die Kundenlogos sehen schick aus — verkaufen aber nichts. Im B2B-Maschinenbau gilt: ohne Zahlen, Gesichter und Vorher/Nachher glaubt dir niemand. Drei 200-Wort-Cases mit den letzten Stuttgart-Projekten reichen, um die Anfragen-Landingpage ca. 1,8× hochzuziehen.'}
      />

      <ErrorBlock
        number={3}
        title="Hero-Bild im Stockfoto-Look"
        body="Das Header-Bild ist eine Shutterstock-Aufnahme einer Schweißanlage, die nicht zu eurem Portfolio passt. In den ersten drei Sekunden entscheidet dein Besucher, ob er weiterscrollt — Stockfotos sind Trust-Killer Nr. 1. Halbtages-Shooting bei euch vor Ort, 12 echte Bilder für unter 800 € und ein Hero, das wirklich verkauft."
      />

      <h2
        style={{
          fontSize: 22,
          fontWeight: 700,
          color: "#0F172A",
          margin: "20px 0 14px 0",
        }}
      >
        Was machen wir jetzt?
      </h2>
      <p style={{ margin: "0 0 16px 0" }}>
        Ich hab nächste Woche Dienstag und Donnerstag jeweils einen
        30-Minuten-Slot frei. Wir gehen die drei Punkte durch, ich zeig dir
        live, wo der Pixel hingehört, und am Ende hast du eine
        Aufgabenliste, die du entweder selbst abarbeitest oder an mein Team
        gibst.
      </p>
      <p style={{ margin: "0 0 36px 0" }}>
        Falls dir das alles zu viel ist: kein Stress, melde dich einfach,
        wenn der Zeitpunkt besser passt.
      </p>

      <div
        style={{
          height: 1,
          backgroundColor: "#E8EAED",
          margin: "0 0 24px 0",
        }}
      />
      <div style={{ color: "#5F6368", fontSize: 14 }}>
        Lieben Gruß
      </div>
    </div>
  );
}

function ErrorBlock({
  number,
  title,
  body,
}: {
  number: number;
  title: string;
  body: string;
}) {
  return (
    <div
      style={{
        display: "flex",
        gap: 20,
        padding: "22px 26px",
        marginBottom: 22,
        border: "1px solid #FCA5A5",
        borderLeft: "5px solid #DC2626",
        borderRadius: 8,
        backgroundColor: "#FEF2F2",
      }}
    >
      <div
        style={{
          width: 40,
          height: 40,
          flexShrink: 0,
          borderRadius: "50%",
          backgroundColor: "#DC2626",
          color: "#FFFFFF",
          fontWeight: 700,
          fontSize: 18,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          marginTop: 2,
        }}
      >
        {number}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 19,
            fontWeight: 700,
            color: "#7F1D1D",
            marginBottom: 6,
          }}
        >
          {title}
        </div>
        <div style={{ color: "#3F1818", lineHeight: 1.6 }}>{body}</div>
      </div>
    </div>
  );
}

function SlideFrame({ src }: { src: string }) {
  const frame = useCurrentFrame();
  // Opacity startet bei 1; nur Fade-OUT am Ende fuer sauberen Cross-Fade
  // zur naechsten Folie. Damit ist die erste Folie sofort sichtbar.
  const opacity = interpolate(
    frame,
    [SLIDE_DURATION - 14, SLIDE_DURATION],
    [1, 0],
    {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    },
  );

  return (
    <AbsoluteFill style={{ opacity, backgroundColor: "#FFFFFF" }}>
      <Img
        src={staticFile(src)}
        style={{
          width: "100%",
          height: "100%",
          objectFit: "contain",
        }}
      />
    </AbsoluteFill>
  );
}

function SlidesBackground() {
  return (
    <AbsoluteFill style={{ backgroundColor: "#FFFFFF" }}>
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

function Background({
  mode,
  scrollEnabled,
}: {
  mode: MarketingDemoMode;
  scrollEnabled: boolean;
}) {
  if (mode === "screenshot") return <ScreenshotBackground />;
  if (mode === "scroll")
    return <ScrollBackground scrollEnabled={scrollEnabled} />;
  if (mode === "slides") return <SlidesBackground />;
  if (mode === "gdocs")
    return <GoogleDocsBackground scrollEnabled={scrollEnabled} />;
  return null;
}

export default function MarketingDemoComposition({
  mode,
  scrollEnabled = false,
}: MarketingDemoProps) {
  // Webcam-PiP: bottom-LEFT, perfekter KREIS. In solo-Mode → fullscreen.
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
      <Background mode={mode} scrollEnabled={scrollEnabled} />
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
