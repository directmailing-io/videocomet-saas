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

export type MarketingDemoMode = "screenshot" | "slides" | "gdocs" | "solo";

export type DemoLeadError = {
  title: string;
  body: string;
};

export type DemoLead = {
  id: string;
  firstName: string;
  fullName: string;
  salutation: string;
  initials: string;
  company: string;
  location: string;
  domain: string;
  screenshot: string;
  industryLabel: string;
  errors: ReadonlyArray<DemoLeadError>;
};

export type MarketingDemoProps = {
  mode: MarketingDemoMode;
  lead: DemoLead;
  scrollEnabled?: boolean;
  [key: string]: unknown;
};

const WEBCAM_MP4 = "/demo-assets/webcam.mp4";
const GENERIC_SLIDE_SRCS = [2, 3, 4].map(
  (n) => `/demo-assets/slide-${n}.png`,
);

const SLIDE_DURATION = 132;
const SLIDE_STEP = 120;

const SANS = "'Inter', 'Helvetica Neue', Arial, sans-serif";
const GOOGLE_SANS =
  "'Google Sans', 'Roboto', 'Helvetica Neue', Arial, sans-serif";

/**
 * Echtes Scroll-Verhalten: viele kleine Wheel-Detents (150-500 px),
 * dazwischen gelegentlich groessere Spruenge (Page Down, ~1500 px),
 * dazwischen kurze Lese-Pausen (1-2 s). Jeder Scroll-Step braucht
 * 1-1,5 s und wird mit ease-in-out interpoliert → smoothes Beschleunigen
 * + Ausklingen pro Segment, kein Springen.
 *
 * Loop = 50 s. Image-Hoehe 1920×(8000/1200)=12800, Visible 1080, max
 * sinnvoller Scroll ~ -10000.
 */
const WEBSITE_SCROLL_KEYFRAMES = `
  @keyframes vc-demo-scroll {
    0%   { transform: translateY(0); }
    2%   { transform: translateY(-160px); }
    5%   { transform: translateY(-160px); }
    8%   { transform: translateY(-480px); }
    12%  { transform: translateY(-480px); }
    15%  { transform: translateY(-900px); }
    18%  { transform: translateY(-900px); }
    21%  { transform: translateY(-1500px); }
    25%  { transform: translateY(-1500px); }
    27%  { transform: translateY(-1380px); }
    30%  { transform: translateY(-1380px); }
    33%  { transform: translateY(-2300px); }
    38%  { transform: translateY(-2300px); }
    40%  { transform: translateY(-2700px); }
    44%  { transform: translateY(-2700px); }
    47%  { transform: translateY(-3900px); }
    51%  { transform: translateY(-3900px); }
    54%  { transform: translateY(-5100px); }
    58%  { transform: translateY(-5100px); }
    60%  { transform: translateY(-4950px); }
    62%  { transform: translateY(-4950px); }
    65%  { transform: translateY(-6400px); }
    69%  { transform: translateY(-6400px); }
    72%  { transform: translateY(-7700px); }
    76%  { transform: translateY(-7700px); }
    78%  { transform: translateY(-8100px); }
    81%  { transform: translateY(-8100px); }
    84%  { transform: translateY(-9400px); }
    88%  { transform: translateY(-9400px); }
    100% { transform: translateY(0); }
  }
`;

/**
 * Google-Docs-Scrollvideo: zeigt ein echtes JSX-gerendertes Dokument im
 * Docs-Chrome (Top-Bar + Toolbar). Inhalt = personalisierter Schnell-
 * Check fuer "Max" mit 3 roten Findings. Scrollt langsam hoch und runter.
 */
function GoogleDocsBackground({
  scrollEnabled,
  lead,
}: {
  scrollEnabled: boolean;
  lead: DemoLead;
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
          3%   { transform: translateY(-80px); }
          6%   { transform: translateY(-80px); }
          9%   { transform: translateY(-200px); }
          13%  { transform: translateY(-200px); }
          16%  { transform: translateY(-360px); }
          22%  { transform: translateY(-360px); }
          25%  { transform: translateY(-500px); }
          29%  { transform: translateY(-500px); }
          31%  { transform: translateY(-460px); }
          33%  { transform: translateY(-460px); }
          36%  { transform: translateY(-680px); }
          42%  { transform: translateY(-680px); }
          45%  { transform: translateY(-820px); }
          50%  { transform: translateY(-820px); }
          53%  { transform: translateY(-980px); }
          58%  { transform: translateY(-980px); }
          60%  { transform: translateY(-940px); }
          62%  { transform: translateY(-940px); }
          65%  { transform: translateY(-1120px); }
          71%  { transform: translateY(-1120px); }
          74%  { transform: translateY(-1280px); }
          80%  { transform: translateY(-1280px); }
          83%  { transform: translateY(-1380px); }
          88%  { transform: translateY(-1380px); }
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
            Notiz für {lead.firstName}
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
          <DocumentPaper lead={lead} />
        </div>
      </div>
    </AbsoluteFill>
  );
}

function DocumentPaper({ lead }: { lead: DemoLead }) {
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
        Notiz für {lead.firstName}
      </h1>
      <div style={{ color: "#5F6368", fontSize: 15, marginBottom: 36 }}>
        Schnell-Check für{" "}
        <span style={{ color: "#1A73E8", textDecoration: "underline" }}>
          {lead.domain}
        </span>
      </div>

      <div
        style={{
          height: 1,
          backgroundColor: "#E8EAED",
          margin: "0 0 36px 0",
        }}
      />

      <p style={{ margin: "0 0 18px 0" }}>Hey {lead.firstName},</p>
      <p style={{ margin: "0 0 18px 0" }}>
        ich hab heute morgen 15 Minuten in deiner Webseite verbracht. Mir
        sind <strong>drei Sachen</strong> aufgefallen, die dich aktuell
        jeden Tag Anfragen kosten — ich schreib&apos;s dir kurz auf, dann
        kannst du in Ruhe drauf gucken.
      </p>
      <p style={{ margin: "0 0 28px 0" }}>
        Wenn du Bock hast, packen wir die Punkte gemeinsam an. Termin per
        Klick auf das Video unten.
      </p>

      {/* Eingebetteter Screenshot — wie als Bild ins Doc kopiert */}
      <div
        style={{
          width: "100%",
          height: 420,
          marginBottom: 12,
          borderRadius: 6,
          overflow: "hidden",
          boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
          border: "1px solid #DADCE0",
          backgroundColor: "#FFFFFF",
        }}
      >
        <Img
          src={staticFile(lead.screenshot)}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
            objectPosition: "top",
            display: "block",
          }}
        />
      </div>
      <div
        style={{
          fontSize: 13,
          color: "#5F6368",
          fontStyle: "italic",
          marginBottom: 40,
        }}
      >
        Bild 1 — Screenshot von {lead.domain} (oben angeheftet).
      </div>

      {lead.errors.map((err, i) => (
        <ErrorBlock
          key={i}
          number={i + 1}
          title={err.title}
          body={err.body}
        />
      ))}

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

function SlideFrameJSX({ children }: { children: React.ReactNode }) {
  const frame = useCurrentFrame();
  const opacity = interpolate(
    frame,
    [SLIDE_DURATION - 14, SLIDE_DURATION],
    [1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );
  return (
    <AbsoluteFill style={{ opacity, backgroundColor: "#FFFFFF" }}>
      {children}
    </AbsoluteFill>
  );
}

function SlidesBackground({ lead }: { lead: DemoLead }) {
  return (
    <AbsoluteFill style={{ backgroundColor: "#FFFFFF" }}>
      <Sequence
        from={0}
        durationInFrames={SLIDE_DURATION}
        layout="none"
      >
        <SlideFrameJSX>
          <SlidePersonalIntro lead={lead} />
        </SlideFrameJSX>
      </Sequence>
      {GENERIC_SLIDE_SRCS.map((src, i) => (
        <Sequence
          key={src}
          from={(i + 1) * SLIDE_STEP}
          durationInFrames={SLIDE_DURATION}
          layout="none"
        >
          <SlideFrame src={src} />
        </Sequence>
      ))}
      <Sequence
        from={4 * SLIDE_STEP}
        durationInFrames={SLIDE_DURATION}
        layout="none"
      >
        <SlideFrameJSX>
          <SlidePersonalOutro lead={lead} />
        </SlideFrameJSX>
      </Sequence>
    </AbsoluteFill>
  );
}

const SLIDE_BRAND_DEEP = "#7C5CE8";
const SLIDE_BRAND_PURPLE = "#AA8CF5";
const SLIDE_INK_DARK = "#0F172A";
const SLIDE_INK_MUTED = "#64748B";
const SLIDE_FONT =
  "'Inter', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";

function SlideShell({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        backgroundImage:
          "radial-gradient(90% 90% at 20% 0%, #F3EEFF 0%, #FFFFFF 55%, #FFFFFF 100%)",
        fontFamily: SLIDE_FONT,
        color: SLIDE_INK_DARK,
      }}
    >
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          height: 6,
          background: `linear-gradient(90deg, ${SLIDE_BRAND_PURPLE}, ${SLIDE_BRAND_DEEP})`,
        }}
      />
      <div
        style={{
          position: "absolute",
          top: 56,
          left: 80,
          display: "flex",
          gap: 8,
          alignItems: "center",
        }}
      >
        <div
          style={{
            width: 14,
            height: 14,
            borderRadius: 3,
            backgroundColor: SLIDE_BRAND_PURPLE,
          }}
        />
        <div
          style={{
            width: 14,
            height: 14,
            borderRadius: 3,
            backgroundColor: SLIDE_BRAND_DEEP,
          }}
        />
        <div
          style={{
            marginLeft: 8,
            fontWeight: 700,
            fontSize: 18,
            letterSpacing: 2.5,
            color: SLIDE_INK_DARK,
          }}
        >
          VIDEOCOMET
        </div>
      </div>
      {children}
    </div>
  );
}

function SlideDecorations() {
  return (
    <>
      <div
        style={{
          position: "absolute",
          top: 120,
          right: 100,
          width: 180,
          height: 180,
          borderRadius: "50%",
          backgroundColor: "#D1FAE5",
          opacity: 0.85,
        }}
      />
      <div
        style={{
          position: "absolute",
          bottom: 180,
          left: 120,
          width: 140,
          height: 140,
          borderRadius: "50%",
          backgroundColor: "#FCE7F3",
          opacity: 0.8,
        }}
      />
      <div
        style={{
          position: "absolute",
          bottom: 240,
          right: 140,
          width: 90,
          height: 90,
          borderRadius: 16,
          backgroundColor: "#FEF3C7",
          opacity: 0.9,
        }}
      />
    </>
  );
}

function SlideFooter({
  pageNumber,
  totalPages,
  lead,
}: {
  pageNumber: number;
  totalPages: number;
  lead: DemoLead;
}) {
  return (
    <>
      <div
        style={{
          position: "absolute",
          left: 220,
          right: 220,
          bottom: 130,
          height: 2,
          backgroundColor: "#E2E8F0",
        }}
      />
      <div
        style={{
          position: "absolute",
          left: 220,
          bottom: 80,
          fontSize: 22,
          fontWeight: 500,
          color: SLIDE_INK_MUTED,
        }}
      >
        5 Minuten · Vertraulich · {lead.company}
      </div>
      <div
        style={{
          position: "absolute",
          right: 80,
          bottom: 40,
          fontSize: 20,
          fontWeight: 500,
          color: SLIDE_INK_MUTED,
        }}
      >
        {pageNumber}/{totalPages}
      </div>
    </>
  );
}

function SlidePersonalIntro({ lead }: { lead: DemoLead }) {
  return (
    <SlideShell>
      <SlideDecorations />
      {/* Avatar */}
      <div
        style={{
          position: "absolute",
          left: 220,
          top: 380,
          width: 200,
          height: 200,
          borderRadius: "50%",
          background: `linear-gradient(135deg, ${SLIDE_BRAND_PURPLE}, ${SLIDE_BRAND_DEEP})`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#FFFFFF",
          fontSize: 92,
          fontWeight: 800,
          letterSpacing: -2,
        }}
      >
        {lead.initials}
      </div>
      {/* Text block */}
      <div
        style={{
          position: "absolute",
          left: 460,
          top: 390,
          right: 220,
        }}
      >
        <div
          style={{
            fontSize: 32,
            fontWeight: 600,
            letterSpacing: 4,
            color: SLIDE_BRAND_DEEP,
            textTransform: "uppercase",
            marginBottom: 14,
          }}
        >
          Persönliches Video
        </div>
        <div
          style={{
            fontSize: 92,
            fontWeight: 800,
            lineHeight: 1.05,
            color: SLIDE_INK_DARK,
            marginBottom: 4,
          }}
        >
          Video für
        </div>
        <div
          style={{
            fontSize: 92,
            fontWeight: 800,
            lineHeight: 1.05,
            color: SLIDE_BRAND_DEEP,
            marginBottom: 30,
          }}
        >
          {lead.fullName}
        </div>
        <div
          style={{
            fontSize: 32,
            fontWeight: 400,
            color: SLIDE_INK_MUTED,
          }}
        >
          {lead.company} · {lead.location}
        </div>
      </div>
      <SlideFooter pageNumber={1} totalPages={5} lead={lead} />
    </SlideShell>
  );
}

function SlidePersonalOutro({ lead }: { lead: DemoLead }) {
  return (
    <SlideShell>
      <SlideDecorations />
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: 290,
          textAlign: "center",
          fontSize: 32,
          fontWeight: 600,
          letterSpacing: 4,
          color: SLIDE_BRAND_DEEP,
          textTransform: "uppercase",
        }}
      >
        Nächster Schritt
      </div>
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: 380,
          textAlign: "center",
          fontSize: 90,
          fontWeight: 800,
          lineHeight: 1.05,
          color: SLIDE_INK_DARK,
        }}
      >
        Lassen Sie uns sprechen,
      </div>
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: 490,
          textAlign: "center",
          fontSize: 90,
          fontWeight: 800,
          lineHeight: 1.05,
          color: SLIDE_BRAND_DEEP,
        }}
      >
        {lead.salutation}.
      </div>
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: 640,
          textAlign: "center",
          fontSize: 30,
          fontWeight: 400,
          color: SLIDE_INK_MUTED,
        }}
      >
        30 Minuten · unverbindlich · per Video
      </div>
      {/* CTA */}
      <div
        style={{
          position: "absolute",
          left: "50%",
          top: 760,
          transform: "translateX(-50%)",
          width: 480,
          height: 110,
          borderRadius: 16,
          background: `linear-gradient(135deg, ${SLIDE_BRAND_PURPLE}, ${SLIDE_BRAND_DEEP})`,
          color: "#FFFFFF",
          fontSize: 42,
          fontWeight: 700,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          boxShadow: "0 14px 36px -10px rgba(124,92,232,0.55)",
        }}
      >
        Termin vereinbaren →
      </div>
      <SlideFooter pageNumber={5} totalPages={5} lead={lead} />
    </SlideShell>
  );
}

function ScreenshotBackground({
  scrollEnabled,
  lead,
}: {
  scrollEnabled: boolean;
  lead: DemoLead;
}) {
  // scrollEnabled=false: Standbild (Top der Webseite, cover).
  // scrollEnabled=true: animiertes Scroll-Video durch die ganze Seite mit
  // realistischen Lese-Pausen. Webseite kommt aus lead.screenshot.
  if (!scrollEnabled) {
    return (
      <AbsoluteFill style={{ backgroundColor: "#FFFFFF" }}>
        <Img
          src={staticFile(lead.screenshot)}
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

  return (
    <AbsoluteFill style={{ overflow: "hidden", backgroundColor: "#FFFFFF" }}>
      <style>{WEBSITE_SCROLL_KEYFRAMES}</style>
      <Img
        src={staticFile(lead.screenshot)}
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          width: "100%",
          height: "auto",
          animation: "vc-demo-scroll 50s ease-in-out infinite",
          willChange: "transform",
          display: "block",
        }}
      />
    </AbsoluteFill>
  );
}

function Background({
  mode,
  scrollEnabled,
  lead,
}: {
  mode: MarketingDemoMode;
  scrollEnabled: boolean;
  lead: DemoLead;
}) {
  if (mode === "screenshot")
    return (
      <ScreenshotBackground scrollEnabled={scrollEnabled} lead={lead} />
    );
  if (mode === "slides") return <SlidesBackground lead={lead} />;
  if (mode === "gdocs")
    return (
      <GoogleDocsBackground scrollEnabled={scrollEnabled} lead={lead} />
    );
  return null;
}

export default function MarketingDemoComposition({
  mode,
  lead,
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
      <Background mode={mode} scrollEnabled={scrollEnabled} lead={lead} />
      <div style={wrapperStyle}>
        <Video
          src={staticFile(WEBCAM_MP4)}
          muted
          playsInline
          loop
          volume={0}
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
