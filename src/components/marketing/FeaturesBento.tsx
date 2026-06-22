"use client";

import * as React from "react";
import {
  ArrowRight,
  Bell,
  CheckCircle2,
  Eye,
  Maximize2,
  MousePointerClick,
  Play,
  PlayCircle,
  TrendingUp,
  Volume2,
} from "lucide-react";
import { RevealOnScroll } from "./RevealOnScroll";

/**
 * Features-Bento — Polished Edition
 *
 * Layout:
 *   - 2-col-Grid auf desktop (cards groesser, mehr Platz fuer Detail)
 *   - 6 helle Cards mit zentriertem realistischen UI-Mockup
 *   - 1 wide Hero-Card mit colorful mesh-gradient (Anbindungen)
 *
 * Visuals:
 *   - Video → echter Video-Player (NICHT wie eine LP)
 *   - Landingpage → echte LP mit Brand-Logo, Nav, Hero, Trust-Row
 *   - Brief → DIN-Padding, echter Body-Text, REAL QR-Code
 *   - Push → polished Notification-Stack
 *   - Analytics → polished Mini-Dashboard
 *   - A/B → polished Variant-Compare
 *   - Anbindungen → workflow-diagram mit echten Brand-Logos
 */
export function FeaturesBento() {
  return (
    <section
      id="features"
      className="relative z-[2] w-full bg-white py-24 md:py-32 overflow-hidden"
    >
      <div
        aria-hidden
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "radial-gradient(80% 50% at 50% 0%, rgba(243,238,255,0.5) 0%, rgba(255,255,255,0) 60%)",
        }}
      />

      <div className="relative max-w-6xl mx-auto px-6 md:px-10">
        {/* Header */}
        <div className="max-w-2xl mx-auto text-center mb-14 md:mb-20">
          <RevealOnScroll delay={0}>
            <div className="inline-flex items-center px-3.5 py-1.5 rounded-full bg-brand-soft text-brand-deep text-[11px] font-semibold tracking-[0.18em] uppercase mb-6">
              Die Features
            </div>
          </RevealOnScroll>
          <RevealOnScroll delay={150}>
            <h2 className="font-light tracking-[-0.035em] text-ink leading-[1.05] text-[clamp(32px,4.2vw,56px)] mb-5 text-balance">
              Alles drin.
              <br />
              <span className="font-semibold text-brand-deep">
                Nichts halb.
              </span>
            </h2>
          </RevealOnScroll>
          <RevealOnScroll delay={300}>
            <p className="text-ink-muted text-lg leading-relaxed text-balance max-w-xl mx-auto">
              Von der Webcam-Aufnahme bis ins CRM. Alles, was du
              brauchst, um Akquise wirklich persönlich zu machen.
            </p>
          </RevealOnScroll>
        </div>

        {/* Bento Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-5">
          <RevealOnScroll delay={400}>
            <FeatureCard
              title="Persönliche Videos in Serie."
              sub="Eine Aufnahme reicht. Jeder Lead bekommt sein eigenes Video, automatisch zusammengesetzt."
            >
              <VideoPlayerVisual />
            </FeatureCard>
          </RevealOnScroll>

          <RevealOnScroll delay={500}>
            <FeatureCard
              title="Eine Landingpage pro Lead."
              sub="Vorname, Firma und das Video sauber im Hero. Komplett automatisch generiert."
            >
              <LandingPageVisual />
            </FeatureCard>
          </RevealOnScroll>

          <RevealOnScroll delay={600}>
            <FeatureCard
              title="Briefpost, die ankommt."
              sub="Persönlich adressiert, mit QR-Code zum Video. Druckfertig als PDF zum Download."
            >
              <BriefVisual />
            </FeatureCard>
          </RevealOnScroll>

          <RevealOnScroll delay={700}>
            <FeatureCard
              title="Live, sobald jemand reagiert."
              sub="Push-Notifications für jede Öffnung und jeden Klick. Du bist immer informiert."
            >
              <PushVisual />
            </FeatureCard>
          </RevealOnScroll>

          <RevealOnScroll delay={800}>
            <FeatureCard
              title="Sieh, was wirklich funktioniert."
              sub="Watch-Time, Klicks und Anfragen in einem klaren Dashboard."
            >
              <AnalyticsVisual />
            </FeatureCard>
          </RevealOnScroll>

          <RevealOnScroll delay={900}>
            <FeatureCard
              title="Daten zeigen, was besser wirkt."
              sub="Templates und Headlines gegeneinander testen. Die Version mit der besseren Conversion gewinnt."
            >
              <ABVisual />
            </FeatureCard>
          </RevealOnScroll>

          {/* Wide mesh card */}
          <RevealOnScroll delay={1050} className="md:col-span-2">
            <FeatureCardMesh
              title="Eingebunden in deine Tools."
              sub="Jedes Tracking-Event landet automatisch in deinem CRM oder Automation-Tool. Per Webhook, ohne Umweg."
            >
              <IntegrationsVisual />
            </FeatureCardMesh>
          </RevealOnScroll>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Card Shells
// ---------------------------------------------------------------------------

function FeatureCard({
  children,
  title,
  sub,
}: {
  children: React.ReactNode;
  title: string;
  sub: string;
}) {
  return (
    <div className="relative h-full overflow-hidden rounded-3xl border border-line bg-gradient-to-b from-white to-[#FAFAFE] p-8 md:p-10 flex flex-col shadow-[0_4px_22px_-12px_rgba(15,23,42,0.12)] transition-shadow hover:shadow-[0_8px_30px_-12px_rgba(15,23,42,0.18)]">
      <div
        aria-hidden
        className="absolute inset-x-0 top-0 h-px"
        style={{
          background:
            "linear-gradient(90deg, transparent, rgba(255,255,255,0.9), transparent)",
        }}
      />
      <div className="relative flex-1 flex items-center justify-center min-h-[320px] mb-8">
        {children}
      </div>
      <div className="text-center">
        <h3 className="text-[22px] md:text-[26px] font-bold tracking-[-0.02em] text-ink leading-[1.15] text-balance">
          {title}
        </h3>
        <p className="mt-3 text-[15px] text-ink-muted leading-relaxed text-balance max-w-[36ch] mx-auto">
          {sub}
        </p>
      </div>
    </div>
  );
}

function FeatureCardMesh({
  children,
  title,
  sub,
}: {
  children: React.ReactNode;
  title: string;
  sub: string;
}) {
  return (
    <div className="relative h-full overflow-hidden rounded-3xl border border-line p-8 md:p-12 flex flex-col md:flex-row gap-10 md:gap-14 items-center shadow-[0_4px_22px_-12px_rgba(15,23,42,0.12)]">
      <div
        aria-hidden
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "radial-gradient(60% 80% at 0% 0%, rgba(170,140,245,0.35) 0%, transparent 50%), radial-gradient(50% 80% at 100% 0%, rgba(251,191,36,0.25) 0%, transparent 50%), radial-gradient(50% 80% at 100% 100%, rgba(16,185,129,0.30) 0%, transparent 50%), radial-gradient(50% 80% at 0% 100%, rgba(14,165,233,0.25) 0%, transparent 50%), white",
          filter: "saturate(1.15)",
        }}
      />
      <div
        aria-hidden
        className="absolute inset-0 pointer-events-none opacity-[0.4] mix-blend-overlay"
        style={{
          backgroundImage:
            'url("data:image/svg+xml;utf8,<svg xmlns=\\"http://www.w3.org/2000/svg\\" width=\\"160\\" height=\\"160\\" viewBox=\\"0 0 160 160\\"><filter id=\\"n\\"><feTurbulence type=\\"fractalNoise\\" baseFrequency=\\"0.9\\" numOctaves=\\"2\\" stitchTiles=\\"stitch\\"/></filter><rect width=\\"100%\\" height=\\"100%\\" filter=\\"url(%23n)\\" opacity=\\"0.5\\"/></svg>")',
        }}
      />

      <div className="relative flex-1 flex items-center justify-center min-h-[280px] w-full">
        {children}
      </div>

      <div className="relative md:w-[360px] md:shrink-0 text-center md:text-left">
        <h3 className="text-[26px] md:text-[32px] font-bold tracking-[-0.02em] text-ink leading-[1.1] text-balance">
          {title}
        </h3>
        <p className="mt-4 text-[15px] md:text-base text-ink-soft leading-relaxed text-balance">
          {sub}
        </p>
      </div>
    </div>
  );
}

// ===========================================================================
// 1) Videogenerierung — ECHTER Video-Player
// ===========================================================================

function VideoPlayerVisual() {
  return (
    <div className="relative w-full max-w-[360px] mx-auto">
      <div
        aria-hidden
        className="absolute -inset-x-6 -bottom-6 h-8 rounded-full"
        style={{
          background:
            "radial-gradient(50% 100% at 50% 0%, rgba(124,92,232,0.25), transparent 70%)",
          filter: "blur(8px)",
        }}
      />

      <div
        className="relative rounded-2xl overflow-hidden border border-line/60 bg-black aspect-video"
        style={{
          boxShadow:
            "0 30px 60px -20px rgba(15,23,42,0.45), 0 10px 25px -8px rgba(15,23,42,0.2)",
        }}
      >
        {/* Hero composition */}
        <div
          className="absolute inset-0 flex items-center"
          style={{
            background:
              "linear-gradient(135deg, #6D28D9 0%, #7C5CE8 35%, #D946EF 100%)",
          }}
        >
          <div
            aria-hidden
            className="absolute inset-0"
            style={{
              background:
                "radial-gradient(50% 80% at 30% 30%, rgba(255,255,255,0.18), transparent 60%)",
            }}
          />

          <div className="relative flex-1 px-6 pr-24">
            <div className="text-[9px] font-bold tracking-[0.25em] uppercase text-white/85 mb-2">
              Persönlich für dich
            </div>
            <div className="text-[20px] font-extrabold text-white leading-[1.05] tracking-[-0.02em]">
              Max,
              <br />
              schau dir das an.
            </div>
          </div>
        </div>

        {/* Webcam PiP */}
        <div className="absolute top-3 right-3 size-14 rounded-full overflow-hidden border-2 border-white/95 shadow-[0_6px_20px_-2px_rgba(0,0,0,0.5)]">
          <video
            src="/demo-assets/webcam.mp4"
            autoPlay
            muted
            loop
            playsInline
            preload="metadata"
            className="w-full h-full object-cover"
          />
        </div>

        {/* Center play button */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div
            className="size-14 rounded-full flex items-center justify-center backdrop-blur-md border border-white/30"
            style={{
              background: "rgba(0,0,0,0.45)",
              boxShadow: "0 10px 30px -6px rgba(0,0,0,0.5)",
            }}
          >
            <Play className="size-5 text-white fill-white ml-0.5" />
          </div>
        </div>

        {/* Bottom controls */}
        <div
          className="absolute inset-x-0 bottom-0 px-3.5 pt-8 pb-2.5"
          style={{
            background:
              "linear-gradient(to top, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0) 100%)",
          }}
        >
          <div className="h-[3px] bg-white/25 rounded-full mb-2 overflow-hidden">
            <div
              className="h-full bg-white rounded-full relative"
              style={{ width: "38%" }}
            >
              <div className="absolute right-0 top-1/2 -translate-y-1/2 size-2.5 rounded-full bg-white shadow-md" />
            </div>
          </div>
          <div className="flex items-center justify-between text-white">
            <div className="flex items-center gap-2">
              <Play className="size-3 fill-white" />
              <span className="text-[10px] font-medium tabular-nums">
                0:32 / 1:24
              </span>
            </div>
            <div className="flex items-center gap-2 text-white/85">
              <span className="text-[9px] font-bold tracking-wider px-1.5 py-0.5 rounded bg-white/15">
                1080p
              </span>
              <Volume2 className="size-3" />
              <Maximize2 className="size-3" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ===========================================================================
// 2) Landingpage — ECHTE LP mit Brand, Nav, Hero, Trust-Row
// ===========================================================================

function LandingPageVisual() {
  return (
    <div className="relative w-full max-w-[400px] mx-auto">
      <div
        aria-hidden
        className="absolute -inset-x-6 -bottom-4 h-8 rounded-full"
        style={{
          background:
            "radial-gradient(50% 100% at 50% 0%, rgba(124,92,232,0.18), transparent 70%)",
          filter: "blur(10px)",
        }}
      />

      <div
        className="relative rounded-xl overflow-hidden border border-line/80 bg-white"
        style={{
          boxShadow:
            "0 30px 60px -20px rgba(15,23,42,0.4), 0 8px 22px -8px rgba(15,23,42,0.18)",
        }}
      >
        {/* Browser chrome */}
        <div className="h-7 bg-[#F4F4F8] border-b border-line flex items-center px-3 gap-1.5">
          <div className="size-2 rounded-full bg-[#FF5F57]" />
          <div className="size-2 rounded-full bg-[#FEBC2E]" />
          <div className="size-2 rounded-full bg-[#28C840]" />
          <div className="flex-1 mx-3 h-4 rounded-md bg-white border border-line flex items-center px-2.5 gap-1.5">
            <div className="size-1.5 rounded-full bg-emerald-500" />
            <span className="text-[8px] text-ink-muted truncate font-medium">
              zenith.io/max-mustermann
            </span>
          </div>
          <div className="size-2.5 rounded-sm bg-line" />
        </div>

        {/* Nav */}
        <div className="h-8 bg-white border-b border-line flex items-center px-4 gap-4">
          <div className="flex items-center gap-1.5">
            <div
              className="size-3.5 rounded"
              style={{
                background:
                  "conic-gradient(from 220deg at 50% 50%, #7C5CE8, #D946EF, #7C5CE8)",
              }}
            />
            <span className="text-[9px] font-extrabold tracking-tight text-ink">
              ZENITH
            </span>
          </div>
          <div className="flex-1 flex justify-center gap-3.5 text-[7.5px] font-medium text-ink-muted">
            <span>Plattform</span>
            <span>Preise</span>
            <span>Kunden</span>
            <span>Über uns</span>
          </div>
          <div className="text-[7.5px] font-semibold text-ink">Login</div>
          <div className="text-[7.5px] font-bold bg-ink text-white rounded-md px-2 py-1">
            Demo
          </div>
        </div>

        {/* Hero */}
        <div
          className="p-5 flex items-center gap-4 relative overflow-hidden"
          style={{
            background:
              "linear-gradient(135deg, #FAFAFE 0%, #FFFFFF 70%, #F3EEFF 100%)",
          }}
        >
          <div className="flex-1 min-w-0 relative">
            <div className="inline-flex items-center gap-1.5 text-[7px] font-bold tracking-[0.15em] uppercase text-brand-deep bg-brand-soft rounded-full px-2 py-1 mb-2">
              <span className="size-1 rounded-full bg-brand-deep" />
              Persönlich für dich
            </div>
            <div className="text-[15px] font-extrabold text-ink leading-[1.05] tracking-[-0.02em]">
              Max, schau dir
              <br />
              das an.
            </div>
            <div className="text-[8px] text-ink-muted mt-2 leading-snug">
              Drei Punkte zu Ihrer Webseite. <br />
              In 90 Sekunden, persönlich erklärt.
            </div>
            <div className="mt-3 inline-flex items-center gap-1 text-[8px] font-bold text-white bg-ink rounded-full px-3 py-1.5 shadow-md">
              Termin sichern
              <ArrowRight className="size-2.5" />
            </div>
          </div>

          {/* Video tile */}
          <div className="shrink-0 w-[96px] aspect-video rounded-lg overflow-hidden border border-white/80 shadow-[0_10px_24px_-8px_rgba(0,0,0,0.3)] relative">
            <div
              className="absolute inset-0"
              style={{
                background:
                  "linear-gradient(135deg, #6D28D9 0%, #7C5CE8 35%, #D946EF 100%)",
              }}
            />
            <div className="absolute inset-0 flex items-center justify-center">
              <div
                className="size-6 rounded-full backdrop-blur-md border border-white/30 flex items-center justify-center"
                style={{ background: "rgba(0,0,0,0.4)" }}
              >
                <Play className="size-2.5 fill-white text-white ml-px" />
              </div>
            </div>
            <div className="absolute inset-x-1.5 bottom-1.5">
              <div className="h-[1.5px] bg-white/30 rounded-full overflow-hidden">
                <div className="h-full bg-white rounded-full w-2/5" />
              </div>
            </div>
          </div>
        </div>

        {/* Trust row */}
        <div className="px-4 py-2.5 bg-white border-t border-line flex items-center justify-between gap-3">
          <div className="text-[6.5px] font-bold tracking-[0.18em] uppercase text-ink-muted shrink-0">
            Vertraut von
          </div>
          <div className="flex-1 flex items-center justify-around opacity-55">
            <span className="text-[9px] font-extrabold tracking-tighter italic">
              forbes
            </span>
            <span className="text-[9px] font-black tracking-tight">t3n</span>
            <span className="text-[8px] font-bold tracking-widest">
              HORIZONT
            </span>
            <span className="text-[8px] font-bold tracking-wider">
              CAPITAL
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ===========================================================================
// 3) Brief — DIN-Padding + echter Text + ECHTER QR-Code
// ===========================================================================

function BriefVisual() {
  const [qrSrc, setQrSrc] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    import("qrcode")
      .then((mod) =>
        mod.default.toDataURL("https://zenith.io/max-mustermann", {
          margin: 0,
          width: 200,
          errorCorrectionLevel: "M",
          color: { dark: "#0F172A", light: "#FFFFFF00" },
        }),
      )
      .then((url) => {
        if (!cancelled) setQrSrc(url);
      })
      .catch(() => {
        /* swallow */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="relative w-full mx-auto" style={{ maxWidth: 260 }}>
      <div
        aria-hidden
        className="absolute -inset-x-3 -bottom-4 h-8 rounded-full"
        style={{
          background:
            "radial-gradient(50% 100% at 50% 0%, rgba(0,0,0,0.18), transparent 70%)",
          filter: "blur(10px)",
        }}
      />

      <div
        className="relative rounded-md overflow-hidden mx-auto"
        style={{
          width: "100%",
          aspectRatio: "210/297",
          background: "linear-gradient(180deg, #FFFEFA 0%, #FAF5EB 100%)",
          border: "1px solid rgba(0,0,0,0.07)",
          boxShadow:
            "0 30px 60px -20px rgba(0,0,0,0.45), 0 10px 25px -10px rgba(0,0,0,0.28), inset 0 1px 0 rgba(255,255,255,0.9)",
        }}
      >
        <div
          aria-hidden
          className="absolute inset-0 opacity-[0.35] mix-blend-multiply pointer-events-none"
          style={{
            backgroundImage:
              'url("data:image/svg+xml;utf8,<svg xmlns=\\"http://www.w3.org/2000/svg\\" width=\\"100\\" height=\\"100\\" viewBox=\\"0 0 100 100\\"><filter id=\\"n\\"><feTurbulence type=\\"fractalNoise\\" baseFrequency=\\"1.2\\" numOctaves=\\"2\\" stitchTiles=\\"stitch\\"/></filter><rect width=\\"100%\\" height=\\"100%\\" filter=\\"url(%23n)\\" opacity=\\"0.18\\"/></svg>")',
          }}
        />

        <div
          aria-hidden
          className="absolute inset-x-0 top-0 h-1.5"
          style={{
            background:
              "linear-gradient(90deg, #5232C7 0%, #7C5CE8 50%, #D946EF 100%)",
          }}
        />

        {/* DIN-ähnliche Ränder */}
        <div
          className="relative h-full flex flex-col text-ink"
          style={{ padding: "8.5% 9% 7%" }}
        >
          {/* Sender mini-line */}
          <div
            className="text-[6.5px] text-ink-muted pb-1.5 leading-tight"
            style={{
              borderBottom: "1px solid rgba(0,0,0,0.08)",
              letterSpacing: "0.01em",
            }}
          >
            Deine Firma GmbH · Musterstraße 1 · 12345 Stadt
          </div>

          {/* Address + Date */}
          <div className="flex justify-between items-start mt-3.5 mb-3">
            <div className="text-[7.5px] leading-[1.4]">
              <div>Herrn</div>
              <div className="font-bold">Max Mustermann</div>
              <div>Mustermann Industrie GmbH</div>
              <div>Industriestraße 42</div>
              <div>85737 Ismaning</div>
            </div>
            <div className="text-[6.5px] text-ink-muted text-right">
              22.06.2026
            </div>
          </div>

          {/* Subject */}
          <div className="text-[8.5px] font-bold mt-1 mb-2.5 leading-tight">
            Drei Punkte zu Ihrer Webseite.
          </div>

          {/* Anrede */}
          <div className="text-[7.5px] mb-2">
            Sehr geehrter Herr Mustermann,
          </div>

          {/* Body — echter Text */}
          <div
            className="text-[7px] leading-[1.55] text-ink"
            style={{ fontFamily: "Georgia, 'Times New Roman', serif" }}
          >
            <p>
              ich habe mir Ihre Webseite angesehen und drei Punkte
              gefunden, die Sie täglich Kunden kosten.
            </p>
            <p className="mt-1.5">
              In neunzig Sekunden zeige ich Ihnen die wichtigsten
              Optimierungen, persönlich auf Sie zugeschnitten.
            </p>
            <p className="mt-1.5">
              Scannen Sie einfach den QR-Code unten rechts, dann öffnet
              sich Ihr Video.
            </p>
          </div>

          <div className="flex-1" />

          {/* Footer mit echtem QR */}
          <div className="flex items-end justify-between gap-3 pt-2">
            <div className="flex-1 min-w-0">
              <div className="text-[7px] mb-1">Mit besten Grüßen</div>
              <div
                className="text-[12px] leading-tight"
                style={{
                  fontFamily:
                    "'Caveat', 'Brush Script MT', 'Lucida Handwriting', cursive",
                  color: "#1A237E",
                  transform: "rotate(-2deg)",
                  transformOrigin: "left bottom",
                  display: "inline-block",
                }}
              >
                Daniel Kurzeja
              </div>
              <div className="text-[5.5px] text-ink-muted mt-0.5 tracking-wide">
                Daniel Kurzeja · Gründer
              </div>
            </div>
            <div
              className="shrink-0 rounded-[3px] bg-white p-[2px]"
              style={{
                width: 42,
                height: 42,
                border: "1px solid rgba(0,0,0,0.12)",
              }}
            >
              {qrSrc ? (
                <img
                  src={qrSrc}
                  alt="QR-Code zur personalisierten Landingpage"
                  className="w-full h-full block"
                />
              ) : (
                <div className="w-full h-full bg-ink/5 rounded-sm" />
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ===========================================================================
// 4) Push — Mac-Notification-Stack
// ===========================================================================

function PushVisual() {
  const NOTIFS = [
    {
      icon: <Eye className="size-3.5" />,
      who: "Max Mustermann",
      what: "öffnete deine Seite",
      time: "gerade eben",
      gradient: ["#10B981", "#047857"],
    },
    {
      icon: <PlayCircle className="size-3.5" />,
      who: "Lisa Lust",
      what: "schaut gerade Sek. 0:18",
      time: "vor 4 Sek.",
      gradient: ["#AA8CF5", "#7C5CE8"],
    },
    {
      icon: <MousePointerClick className="size-3.5" />,
      who: "Franz Friedrich",
      what: "klickte „Termin sichern“",
      time: "vor 12 Sek.",
      gradient: ["#FBBF24", "#D97706"],
    },
  ];
  return (
    <div className="relative w-full max-w-[300px] mx-auto flex flex-col gap-2.5">
      {NOTIFS.map((n, i) => (
        <div
          key={i}
          className="rounded-[18px] bg-white/95 backdrop-blur-md border border-line/70 px-3.5 py-3 flex items-center gap-3 shadow-[0_10px_28px_-14px_rgba(15,23,42,0.32)]"
        >
          <div
            className="size-9 shrink-0 rounded-xl flex items-center justify-center text-white shadow-md"
            style={{
              background: `linear-gradient(135deg, ${n.gradient[0]}, ${n.gradient[1]})`,
              boxShadow: `0 6px 16px -4px ${n.gradient[1]}66`,
            }}
          >
            {n.icon}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-[12px] font-bold text-ink leading-tight">
                {n.who}
              </span>
              <span className="text-[10px] text-ink-muted shrink-0 tabular-nums">
                {n.time}
              </span>
            </div>
            <div className="text-[11px] text-ink-muted leading-tight mt-0.5 truncate">
              {n.what}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ===========================================================================
// 5) Analytics — Mini-Dashboard
// ===========================================================================

function AnalyticsVisual() {
  return (
    <div className="relative w-full max-w-[300px] mx-auto">
      <div className="rounded-2xl bg-white border border-line p-5 shadow-[0_14px_36px_-16px_rgba(15,23,42,0.25)]">
        <div className="flex items-end justify-between mb-4">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-muted">
              Watch-Time ø
            </div>
            <div className="text-[44px] font-extrabold leading-none mt-1.5 text-ink tracking-[-0.02em] tabular-nums">
              83%
            </div>
          </div>
          <div className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-emerald-50 text-emerald-700 text-[10px] font-bold">
            <TrendingUp className="size-3" />
            +12%
          </div>
        </div>

        <div className="rounded-xl bg-[#FAFAFE] border border-line/60 p-3">
          <svg viewBox="0 0 220 56" className="w-full h-16">
            <defs>
              <linearGradient id="vc-feat-chart" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#7C5CE8" stopOpacity="0.5" />
                <stop offset="100%" stopColor="#7C5CE8" stopOpacity="0" />
              </linearGradient>
            </defs>
            <path
              d="M0,42 L24,38 L48,32 L72,34 L96,24 L120,20 L144,22 L168,12 L192,10 L220,4 L220,56 L0,56 Z"
              fill="url(#vc-feat-chart)"
            />
            <path
              d="M0,42 L24,38 L48,32 L72,34 L96,24 L120,20 L144,22 L168,12 L192,10 L220,4"
              fill="none"
              stroke="#7C5CE8"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <circle
              cx="220"
              cy="4"
              r="3"
              fill="white"
              stroke="#7C5CE8"
              strokeWidth="2"
            />
          </svg>
        </div>

        <div className="grid grid-cols-3 gap-2 mt-3">
          {[
            { l: "Versendet", v: "743" },
            { l: "Geöffnet", v: "284" },
            { l: "Klicks", v: "39" },
          ].map((k, i) => (
            <div
              key={i}
              className="rounded-lg bg-[#FAFAFE] border border-line/60 px-2.5 py-2"
            >
              <div className="text-[8px] uppercase tracking-[0.1em] text-ink-muted font-bold">
                {k.l}
              </div>
              <div className="text-[15px] font-extrabold text-ink mt-0.5 leading-none tabular-nums">
                {k.v}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ===========================================================================
// 6) A/B Testing
// ===========================================================================

function ABVisual() {
  return (
    <div className="relative w-full max-w-[340px] mx-auto flex items-end gap-3">
      <div
        className="flex-1 rounded-2xl bg-white border border-line p-3.5 shadow-[0_10px_24px_-14px_rgba(15,23,42,0.22)] relative"
        style={{ minHeight: 200 }}
      >
        <div className="flex items-center justify-between mb-3">
          <div className="size-6 rounded-full bg-ink-muted/15 flex items-center justify-center text-[10px] font-extrabold text-ink-muted">
            A
          </div>
        </div>
        <div className="space-y-1 mb-3">
          <div className="h-1.5 bg-ink/15 w-full rounded" />
          <div className="h-1.5 bg-ink/15 w-3/4 rounded" />
        </div>
        <div className="rounded-lg bg-[#F4F4F8] h-14 mb-3" />
        <div className="text-[9px] font-semibold uppercase tracking-[0.1em] text-ink-muted">
          Conversion
        </div>
        <div className="text-[24px] font-extrabold text-ink-muted/70 leading-none mt-1 tabular-nums">
          12%
        </div>
      </div>

      <div
        className="flex-1 rounded-2xl bg-white p-3.5 relative"
        style={{
          minHeight: 230,
          border: "2px solid #7C5CE8",
          boxShadow:
            "0 14px 32px -14px rgba(124,92,232,0.5), 0 0 0 4px rgba(124,92,232,0.08)",
        }}
      >
        <div className="absolute -top-2.5 left-1/2 -translate-x-1/2 inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-brand-deep text-white text-[9px] font-bold shadow-md whitespace-nowrap">
          <CheckCircle2 className="size-2.5" />
          Winner
        </div>
        <div className="flex items-center justify-between mb-3">
          <div className="size-6 rounded-full bg-brand-deep text-white flex items-center justify-center text-[10px] font-extrabold">
            B
          </div>
        </div>
        <div className="space-y-1 mb-3">
          <div className="h-1.5 bg-brand/50 w-full rounded" />
          <div className="h-1.5 bg-brand/50 w-3/4 rounded" />
        </div>
        <div className="rounded-lg bg-brand-soft h-14 mb-3" />
        <div className="text-[9px] font-semibold uppercase tracking-[0.1em] text-brand-deep">
          Conversion
        </div>
        <div className="text-[24px] font-extrabold text-brand-deep leading-none mt-1 tabular-nums">
          18%
        </div>
      </div>
    </div>
  );
}

// ===========================================================================
// 7) Integrations — Workflow
// ===========================================================================

function IntegrationsVisual() {
  const TARGETS = [
    { slug: "hubspot", name: "HubSpot" },
    { slug: "zapier", name: "Zapier" },
    { slug: "make", name: "Make" },
    { slug: "close", name: "Close" },
  ];
  return (
    <div className="relative w-full max-w-[520px] mx-auto py-4">
      <div className="flex justify-center mb-4">
        <div className="inline-flex items-center gap-3 pr-4 pl-2 py-2 rounded-full bg-white shadow-[0_12px_28px_-14px_rgba(15,23,42,0.3)] border border-line">
          <div
            className="size-8 rounded-full flex items-center justify-center text-white shadow-md"
            style={{ background: "linear-gradient(135deg, #AA8CF5, #5232C7)" }}
          >
            <Bell className="size-4" />
          </div>
          <div>
            <div className="text-[13px] font-bold text-ink leading-tight">
              CTA geklickt
            </div>
            <div className="text-[10px] text-ink-muted leading-tight mt-0.5">
              Max Mustermann · gerade eben
            </div>
          </div>
        </div>
      </div>

      <div className="flex justify-center mb-3 h-10">
        <svg
          width="280"
          height="40"
          viewBox="0 0 280 40"
          className="text-ink-muted/35"
        >
          <path
            d="M140 0 L140 14 M40 38 L140 16 L240 38"
            stroke="currentColor"
            strokeWidth="1.5"
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray="3 3"
          />
        </svg>
      </div>

      <div className="grid grid-cols-4 gap-3">
        {TARGETS.map((t) => (
          <div
            key={t.slug}
            className="rounded-2xl bg-white border border-line shadow-[0_10px_24px_-14px_rgba(15,23,42,0.22)] p-3 flex flex-col items-center gap-2 relative"
          >
            <img
              src={`https://cdn.simpleicons.org/${t.slug}`}
              alt={t.name}
              width={30}
              height={30}
              loading="lazy"
              className="size-8"
            />
            <div className="text-[11px] font-semibold text-ink text-center leading-tight">
              {t.name}
            </div>
            <div className="absolute -top-1.5 -right-1.5 size-4 rounded-full bg-emerald-500 text-white flex items-center justify-center shadow-md">
              <CheckCircle2 className="size-3" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
