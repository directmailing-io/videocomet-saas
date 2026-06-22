"use client";

import * as React from "react";
import {
  AlignLeft,
  Bell,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Globe,
  HelpCircle,
  Image as ImageIcon,
  Lock,
  MousePointerClick,
  Play,
  Shapes,
  TrendingUp,
  Type,
  UploadCloud,
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

        {/* Bento Grid — 2 wide Hero-Cards + 6 standard cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-5">
          {/* Wide opener: Eigene Domain */}
          <RevealOnScroll delay={400} className="md:col-span-2">
            <FeatureCardMesh
              title="Deine eigene Domain, dein Auftritt."
              sub="Verbinde in zwei Minuten deine eigene Domain. SSL, DNS, Subdomain. Alles inklusive, ohne Frickelei."
            >
              <DomainVisual />
            </FeatureCardMesh>
          </RevealOnScroll>

          <RevealOnScroll delay={500}>
            <FeatureCard
              title="Selber bauen, oder einfach hochladen."
              sub="Schnell-Builder mit allen Blocks in Minuten zusammengesteckt. Oder komplette ZIP-Webseite hochladen, auch direkt von Claude generiert."
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
              title="Scroll-Animationen mitten im Video."
              sub="Zeige die Webseite des Kunden, ein Google-Doc oder eine Karriere-Seite. Live scrollend, direkt im Video."
            >
              <ScrollAnimationVisual />
            </FeatureCard>
          </RevealOnScroll>

          <RevealOnScroll delay={800}>
            <FeatureCard
              title="Slack-Push, sobald jemand reagiert."
              sub="Öffnung, Watch-Time, Klick auf den CTA. Alles landet in deinem Slack, in Echtzeit."
            >
              <SlackPushVisual />
            </FeatureCard>
          </RevealOnScroll>

          <RevealOnScroll delay={900}>
            <FeatureCard
              title="Sieh, was wirklich funktioniert."
              sub="Watch-Time, Klicks und Anfragen in einem klaren Dashboard. Live abrufbar, jederzeit vergleichbar."
            >
              <AnalyticsVisual />
            </FeatureCard>
          </RevealOnScroll>

          <RevealOnScroll delay={1000}>
            <FeatureCard
              title="Daten zeigen, was besser wirkt."
              sub="Zwei Video-Botschaften oder zwei Briefe gegeneinander testen. Die Variante mit der besseren Conversion gewinnt."
            >
              <ABVisual />
            </FeatureCard>
          </RevealOnScroll>

          {/* Wide closer: Anbindungen */}
          <RevealOnScroll delay={1100} className="md:col-span-2">
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
// Scroll-Animation — 3-Frame-Storyboard: selbe Seite, 3 Scroll-Positionen
// ===========================================================================

function ScrollAnimationVisual() {
  return (
    <div className="relative w-full max-w-[340px] mx-auto">
      {/* 3 thumbnails: time progression LEFT to RIGHT */}
      <div className="flex items-center gap-2">
        {/* T1 — Hero */}
        <ScrollThumb time="0:02" inactive>
          <div className="p-1 space-y-0.5">
            <div className="h-2 rounded-sm bg-[#F4F4F8]" />
            <div className="h-6 rounded-sm bg-gradient-to-br from-[#E0E7FF] to-[#F3EEFF]" />
            <div className="h-2 rounded-sm bg-white border border-line/60" />
            <div className="h-1.5 rounded-sm bg-white border border-line/60" />
          </div>
        </ScrollThumb>

        <ScrollArrow />

        {/* T2 — Karriere (current, highlighted) */}
        <ScrollThumb time="0:14" label="Im Video" active>
          <div className="p-1 space-y-0.5">
            <div className="text-[4.5px] font-bold tracking-[0.1em] uppercase text-brand-deep px-0.5">
              Karriere
            </div>
            <div className="grid grid-cols-2 gap-0.5">
              <div className="h-3 rounded-sm bg-brand-soft/80" />
              <div className="h-3 rounded-sm bg-brand-soft/80" />
            </div>
            <div className="h-1 rounded-sm bg-ink/15 w-full" />
            <div className="h-1 rounded-sm bg-ink/15 w-3/4" />
            <div className="h-1 rounded-sm bg-ink/15 w-1/2" />
          </div>
        </ScrollThumb>

        <ScrollArrow />

        {/* T3 — Kontakt */}
        <ScrollThumb time="0:28" inactive>
          <div className="p-1 space-y-0.5">
            <div className="h-1.5 rounded-sm bg-white border border-line/60" />
            <div className="h-2 rounded-sm bg-white border border-line/60" />
            <div className="h-4 rounded-sm bg-white border border-line/60" />
            <div className="h-2 rounded-sm bg-ink/15" />
          </div>
        </ScrollThumb>
      </div>

      {/* Caption: scroll explanation */}
      <div className="mt-6 flex items-center justify-center gap-2.5">
        <div
          className="size-7 rounded-full bg-brand text-white flex items-center justify-center shadow-md"
          style={{ boxShadow: "0 8px 18px -4px rgba(124,92,232,0.5)" }}
        >
          <ChevronDown className="size-4" />
        </div>
        <div className="text-[12px] font-semibold text-ink leading-tight">
          Selbe Seite.<br />
          <span className="text-ink-muted font-medium">
            Automatisch gescrollt im Video.
          </span>
        </div>
      </div>
    </div>
  );
}

function ScrollThumb({
  time,
  label,
  active,
  inactive,
  children,
}: {
  time: string;
  label?: string;
  active?: boolean;
  inactive?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="relative flex-1">
      <div
        className={`relative rounded-lg overflow-hidden bg-white aspect-[3/4] border ${
          active
            ? "border-2 border-brand"
            : "border-line/70"
        } ${inactive ? "opacity-60" : ""}`}
        style={
          active
            ? {
                boxShadow:
                  "0 0 0 4px rgba(124,92,232,0.18), 0 14px 28px -10px rgba(15,23,42,0.35)",
              }
            : { boxShadow: "0 6px 14px -8px rgba(15,23,42,0.2)" }
        }
      >
        {children}
        {/* Bottom video controls — only on active */}
        {active ? (
          <div
            className="absolute inset-x-0 bottom-0 px-1 py-0.5 flex items-center justify-between"
            style={{
              background:
                "linear-gradient(to top, rgba(0,0,0,0.78) 0%, rgba(0,0,0,0) 100%)",
            }}
          >
            <Play className="size-1.5 fill-white text-white" />
            <span className="text-[7px] text-white/95 font-medium tabular-nums">
              {time}
            </span>
          </div>
        ) : (
          <div className="absolute inset-x-0 bottom-0 px-1 py-0.5 bg-black/45 flex items-center justify-end">
            <span className="text-[7px] text-white/85 font-medium tabular-nums">
              {time}
            </span>
          </div>
        )}
      </div>
      {label ? (
        <div className="absolute -top-2.5 left-1/2 -translate-x-1/2 text-[8px] font-bold bg-brand-deep text-white rounded px-1.5 py-0.5 shadow-md whitespace-nowrap">
          {label}
        </div>
      ) : null}
    </div>
  );
}

function ScrollArrow() {
  return (
    <div className="shrink-0 flex flex-col items-center gap-0.5">
      <ChevronRight className="size-3 text-ink-muted/40" />
      <span className="text-[6.5px] font-bold tracking-wider uppercase text-ink-muted/50">
        Scroll
      </span>
      <ChevronDown className="size-3 text-brand-deep/70" />
    </div>
  );
}

// ===========================================================================
// 2) Landingpage — LP-Builder mit Claude/ZIP-Indikator
// ===========================================================================

function LandingPageVisual() {
  const BLOCKS = [
    { label: "Hero", icon: <Type className="size-2.5" /> },
    { label: "Text", icon: <AlignLeft className="size-2.5" /> },
    { label: "Bild", icon: <ImageIcon className="size-2.5" /> },
    { label: "CTA", icon: <MousePointerClick className="size-2.5" /> },
    { label: "Logo", icon: <Shapes className="size-2.5" /> },
    { label: "FAQ", icon: <HelpCircle className="size-2.5" /> },
  ];
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
        {/* Toolbar */}
        <div className="h-8 bg-[#FAFAFE] border-b border-line flex items-center px-2.5 gap-2">
          <div className="flex items-center gap-1">
            <div className="size-1.5 rounded-full bg-[#FF5F57]" />
            <div className="size-1.5 rounded-full bg-[#FEBC2E]" />
            <div className="size-1.5 rounded-full bg-[#28C840]" />
          </div>
          <div className="ml-1.5 text-[9px] font-extrabold text-ink tracking-tight">
            Builder
          </div>
          <span className="text-[8px] text-ink-muted">/ max-mustermann</span>
          <div className="flex-1" />
          {/* Claude-Import-Alternative */}
          <div className="inline-flex items-center gap-1.5 text-[8px] font-semibold bg-white border border-line rounded-md px-1.5 py-1 shadow-sm">
            <img
              src="https://cdn.simpleicons.org/anthropic/D97757"
              alt=""
              className="size-3"
            />
            <span className="font-mono tabular-nums">claude-site.zip</span>
            <UploadCloud className="size-2.5 text-ink-muted" />
          </div>
        </div>

        <div className="flex" style={{ height: 240 }}>
          {/* Block sidebar */}
          <div className="w-[78px] border-r border-line bg-[#FAFAFE] p-2 flex flex-col gap-1">
            <div className="text-[6.5px] font-bold uppercase tracking-[0.1em] text-ink-muted px-0.5 mb-1">
              Blöcke
            </div>
            {BLOCKS.map((b) => (
              <div
                key={b.label}
                className="text-[8.5px] font-semibold text-ink bg-white border border-line rounded-md px-1.5 py-1 flex items-center gap-1.5"
              >
                {b.icon}
                {b.label}
              </div>
            ))}
          </div>

          {/* Canvas */}
          <div className="flex-1 bg-[#F4F4F8] p-2.5 space-y-1.5 overflow-hidden relative">
            <div className="text-[6.5px] font-bold tracking-[0.1em] uppercase text-ink-muted mb-1">
              Canvas · 1280 px
            </div>

            {/* Hero block — selected */}
            <div
              className="rounded-md bg-white p-2 relative shadow-md"
              style={{ border: "2px solid #7C5CE8" }}
            >
              <div className="absolute -top-1.5 left-2 text-[6.5px] font-bold uppercase tracking-wider bg-brand-deep text-white rounded px-1 py-0.5">
                Hero
              </div>
              <div className="text-[6px] font-bold tracking-wider uppercase text-brand-deep mb-0.5 pt-0.5">
                Persönlich für dich
              </div>
              <div className="text-[10px] font-extrabold text-ink leading-tight">
                Max, schau dir das an.
              </div>
              <div className="flex items-center gap-1.5 mt-1.5">
                <div className="text-[6.5px] font-bold text-white bg-ink rounded px-1.5 py-0.5">
                  Termin sichern
                </div>
                <div className="size-3.5 rounded bg-gradient-to-br from-[#7C5CE8] to-[#D946EF]" />
              </div>
              {/* Handles */}
              <div
                className="absolute -left-1 top-1/2 -translate-y-1/2 size-1.5 rounded-full border border-white"
                style={{ background: "#7C5CE8" }}
              />
              <div
                className="absolute -right-1 top-1/2 -translate-y-1/2 size-1.5 rounded-full border border-white"
                style={{ background: "#7C5CE8" }}
              />
            </div>

            {/* Text block */}
            <div className="rounded-md bg-white border border-line p-2">
              <div className="text-[6px] font-bold uppercase tracking-wider text-ink-muted mb-1">
                Text
              </div>
              <div className="h-1 w-full bg-ink/15 rounded mb-1" />
              <div className="h-1 w-5/6 bg-ink/15 rounded mb-1" />
              <div className="h-1 w-2/3 bg-ink/15 rounded" />
            </div>

            {/* Drop zone */}
            <div className="rounded-md border-2 border-dashed border-brand/40 bg-brand-soft/30 p-1.5 text-center text-[7.5px] font-bold text-brand-deep">
              + Block hier ablegen
            </div>
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
        mod.default.toDataURL("https://domain.de/max-mustermann", {
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
        className="relative rounded-md overflow-hidden mx-auto bg-white"
        style={{
          width: "100%",
          aspectRatio: "210/297",
          border: "1px solid rgba(0,0,0,0.08)",
          boxShadow:
            "0 30px 60px -20px rgba(0,0,0,0.35), 0 10px 25px -10px rgba(0,0,0,0.22), inset 0 1px 0 rgba(255,255,255,0.9)",
        }}
      >
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
            Lorem ipsum dolor sit amet.
          </div>

          {/* Anrede */}
          <div className="text-[7.5px] mb-2">
            Sehr geehrter Herr Mustermann,
          </div>

          {/* Body — Lorem ipsum mit URL */}
          <div
            className="text-[7px] leading-[1.55] text-ink"
            style={{ fontFamily: "Georgia, 'Times New Roman', serif" }}
          >
            <p>
              Lorem ipsum dolor sit amet, consetetur sadipscing elitr,
              sed diam nonumy eirmod tempor invidunt ut labore et
              dolore magna aliquyam erat.
            </p>
            <p className="mt-1.5">
              At vero eos et accusam et justo duo dolores et ea rebum.
              Stet clita kasd gubergren, no sea takimata sanctus est.
            </p>
            <p className="mt-1.5">
              Besuchen Sie:{" "}
              <span
                className="inline-block font-mono font-bold text-[6.5px] px-1 py-px rounded"
                style={{
                  fontFamily:
                    "ui-monospace, SFMono-Regular, Menlo, monospace",
                  backgroundColor: "#F3EEFF",
                  color: "#5232C7",
                }}
              >
                domain.de/max-mustermann
              </span>
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
// Slack-Push — Slack-Channel mit Bot-Nachrichten
// ===========================================================================

function SlackPushVisual() {
  return (
    <div className="relative w-full max-w-[320px] mx-auto">
      <div
        className="relative rounded-2xl overflow-hidden bg-white border border-line shadow-[0_14px_36px_-16px_rgba(15,23,42,0.28)]"
      >
        {/* Slack-Channel-Header */}
        <div className="flex items-center gap-2 px-3.5 py-2.5 border-b border-line bg-[#F8F8F8]">
          <span className="text-[14px] text-ink-muted leading-none">#</span>
          <span className="text-[13px] font-bold text-ink leading-none">
            video-comet
          </span>
          <span className="text-[10px] text-ink-muted leading-none ml-auto">
            3 Mitglieder
          </span>
        </div>

        {/* Messages */}
        <div className="px-3.5 py-3 space-y-3 bg-white">
          {[
            {
              emoji: "🎯",
              boldName: "Max Mustermann",
              text: "hat dein Video geöffnet",
              meta: "4 Sek. Watch-Time",
              time: "10:32",
            },
            {
              emoji: "✅",
              boldName: "Lisa Lust",
              text: "hat „Termin sichern“ geklickt",
              meta: "Quelle: Brief",
              time: "10:34",
            },
            {
              emoji: "📈",
              boldName: "Franz Friedrich",
              text: "öffnete die Seite zum 3. Mal",
              meta: "Hot Lead",
              time: "10:36",
            },
          ].map((m, i) => (
            <div key={i} className="flex items-start gap-2.5">
              <div
                className="size-7 shrink-0 rounded-md flex items-center justify-center text-white text-[11px] font-extrabold"
                style={{
                  background:
                    "linear-gradient(135deg, #5232C7 0%, #7C5CE8 100%)",
                }}
              >
                VC
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-2 leading-tight">
                  <span className="text-[12px] font-bold text-ink">
                    VideoComet
                  </span>
                  <span className="text-[9px] font-bold text-emerald-700 bg-emerald-100 rounded px-1 py-px">
                    APP
                  </span>
                  <span className="text-[10px] text-ink-muted ml-auto tabular-nums">
                    {m.time}
                  </span>
                </div>
                <div className="text-[12px] text-ink leading-snug mt-0.5">
                  <span className="mr-1">{m.emoji}</span>
                  <span className="font-semibold">{m.boldName}</span>{" "}
                  {m.text}
                </div>
                <div className="text-[10px] text-ink-muted leading-tight mt-0.5">
                  {m.meta}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
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
  const TARGETS: { name: string; src: string }[] = [
    { name: "HubSpot", src: "https://cdn.simpleicons.org/hubspot" },
    { name: "Salesforce", src: "https://cdn.simpleicons.org/salesforce" },
    { name: "Pipedrive", src: "https://cdn.simpleicons.org/pipedrive" },
    { name: "Close", src: "/brand-logos/close-mark.svg" },
    { name: "Slack", src: "https://cdn.simpleicons.org/slack" },
    { name: "Zapier", src: "https://cdn.simpleicons.org/zapier" },
    { name: "Make", src: "https://cdn.simpleicons.org/make" },
    { name: "n8n", src: "https://cdn.simpleicons.org/n8n" },
    { name: "ActiveCampaign", src: "https://cdn.simpleicons.org/activecampaign" },
    { name: "Mailchimp", src: "https://cdn.simpleicons.org/mailchimp" },
  ];
  return (
    <div className="relative w-full max-w-[560px] mx-auto py-2">
      <div className="flex justify-center mb-3">
        <div className="inline-flex items-center gap-2.5 pr-3.5 pl-1.5 py-1.5 rounded-full bg-white shadow-[0_12px_28px_-14px_rgba(15,23,42,0.3)] border border-line">
          <div
            className="size-7 rounded-full flex items-center justify-center text-white shadow-md"
            style={{ background: "linear-gradient(135deg, #AA8CF5, #5232C7)" }}
          >
            <Bell className="size-3.5" />
          </div>
          <div>
            <div className="text-[12px] font-bold text-ink leading-tight">
              CTA geklickt
            </div>
            <div className="text-[9px] text-ink-muted leading-tight mt-0.5">
              Max Mustermann · gerade eben
            </div>
          </div>
        </div>
      </div>

      <div className="flex justify-center mb-2.5 h-6">
        <svg
          width="220"
          height="24"
          viewBox="0 0 220 24"
          className="text-ink-muted/35"
        >
          <path
            d="M110 0 L110 10 M20 22 L110 12 L200 22"
            stroke="currentColor"
            strokeWidth="1.5"
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray="3 3"
          />
        </svg>
      </div>

      {/* 5x2 grid */}
      <div className="grid grid-cols-5 gap-2.5">
        {TARGETS.map((t) => (
          <div
            key={t.name}
            className="rounded-xl bg-white border border-line shadow-[0_8px_18px_-14px_rgba(15,23,42,0.2)] px-2 py-2.5 flex flex-col items-center gap-1.5 relative"
          >
            <div className="h-7 flex items-center justify-center">
              <img
                src={t.src}
                alt={t.name}
                loading="lazy"
                className="max-h-7 w-auto object-contain"
              />
            </div>
            <div className="text-[9.5px] font-semibold text-ink text-center leading-tight">
              {t.name}
            </div>
            <div className="absolute -top-1 -right-1 size-3.5 rounded-full bg-emerald-500 text-white flex items-center justify-center shadow">
              <CheckCircle2 className="size-2.5" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ===========================================================================
// Domain — Domain-Management-Card
// ===========================================================================

function DomainVisual() {
  const DOMAINS = [
    {
      domain: "deine-firma.de",
      meta: "SSL · Auto-Renewal",
    },
    {
      domain: "videos.deine-firma.de",
      meta: "CNAME → cdn.videocomet.de",
    },
    {
      domain: "kampagne.deine-firma.de",
      meta: "SSL · Auto-Renewal",
    },
  ];
  return (
    <div className="relative w-full max-w-[420px] mx-auto">
      <div className="rounded-2xl bg-white border border-line shadow-[0_18px_40px_-18px_rgba(15,23,42,0.32)] overflow-hidden">
        {/* Card-Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-line bg-[#FAFAFE]">
          <div className="flex items-center gap-2">
            <div
              className="size-7 rounded-lg flex items-center justify-center text-white shadow-sm"
              style={{
                background: "linear-gradient(135deg, #7C5CE8, #5232C7)",
              }}
            >
              <Globe className="size-3.5" />
            </div>
            <div>
              <div className="text-[12px] font-bold text-ink leading-tight">
                Domains
              </div>
              <div className="text-[10px] text-ink-muted leading-tight mt-0.5">
                3 verbunden
              </div>
            </div>
          </div>
          <div className="inline-flex items-center gap-1 text-[10px] font-bold text-ink bg-white border border-line rounded-md px-2 py-1">
            + Hinzufügen
          </div>
        </div>

        {/* Domain-Rows */}
        <div className="divide-y divide-line">
          {DOMAINS.map((d, i) => (
            <div key={i} className="flex items-center gap-3 px-4 py-3">
              <div className="size-2 rounded-full bg-emerald-500 shrink-0 shadow-[0_0_8px_rgba(16,185,129,0.6)]" />
              <div className="flex-1 min-w-0">
                <div className="text-[12.5px] font-semibold text-ink truncate tabular-nums">
                  {d.domain}
                </div>
                <div className="text-[10px] text-ink-muted leading-tight mt-0.5 flex items-center gap-1.5">
                  <Lock className="size-2.5" />
                  {d.meta}
                </div>
              </div>
              <div className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-emerald-50 text-emerald-700 text-[10px] font-bold">
                <CheckCircle2 className="size-2.5" />
                Aktiv
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
