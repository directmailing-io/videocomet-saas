"use client";

import * as React from "react";
import {
  Bell,
  CheckCircle2,
  Database,
  Eye,
  FileText,
  Globe,
  Mail,
  MousePointerClick,
  PenLine,
  PlayCircle,
  TrendingUp,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { RevealOnScroll } from "./RevealOnScroll";

/**
 * Features-Bento — Style nach User-Referenz:
 *   - Helle Cards mit fokussiertem zentriertem Visual oben
 *   - Title + Sub UNTER dem Visual, zentriert
 *   - Floating Mockups mit Schatten + Ghost-Layers fuer Tiefe
 *   - 1 grosse colorful-mesh-Card als visueller Anker (Anbindungen)
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

        {/* Bento Grid — 3-column layout, alles consistent */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <RevealOnScroll delay={400}>
            <FeatureCard
              title="Persönliche Videos in Serie."
              sub="Eine Aufnahme reicht. Jeder Lead bekommt sein eigenes Video, automatisch zusammengesetzt."
            >
              <VideoVisual />
            </FeatureCard>
          </RevealOnScroll>

          <RevealOnScroll delay={500}>
            <FeatureCard
              title="Eine Landingpage pro Lead."
              sub="Vorname, Firma und das Video sauber im Hero. Vollständig automatisch generiert."
            >
              <LandingVisual />
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
              sub="Push-Notifications für jede Öffnung, jeden Klick. Du bist immer informiert."
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

          {/* Wide hero-card — Anbindungen mit colorful mesh-bg */}
          <RevealOnScroll delay={1050} className="md:col-span-2 lg:col-span-3">
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
// Card Shell
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
    <div className="relative h-full overflow-hidden rounded-3xl border border-line bg-gradient-to-b from-white to-[#FAFAFE] p-7 md:p-8 flex flex-col shadow-[0_4px_22px_-12px_rgba(15,23,42,0.12)] transition-shadow hover:shadow-[0_8px_30px_-12px_rgba(15,23,42,0.18)]">
      <div
        aria-hidden
        className="absolute inset-x-0 top-0 h-px"
        style={{
          background:
            "linear-gradient(90deg, transparent, rgba(255,255,255,0.9), transparent)",
        }}
      />
      <div className="relative flex-1 flex items-center justify-center min-h-[240px]">
        {children}
      </div>
      <div className="text-center mt-6">
        <h3 className="text-[19px] md:text-xl font-bold tracking-[-0.015em] text-ink leading-tight text-balance">
          {title}
        </h3>
        <p className="mt-3 text-sm text-ink-muted leading-relaxed text-balance max-w-[28ch] mx-auto">
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
    <div className="relative h-full overflow-hidden rounded-3xl border border-line p-7 md:p-10 flex flex-col md:flex-row gap-8 md:gap-10 items-stretch shadow-[0_4px_22px_-12px_rgba(15,23,42,0.12)]">
      {/* Mesh gradient background */}
      <div
        aria-hidden
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "radial-gradient(60% 80% at 0% 0%, rgba(170,140,245,0.35) 0%, transparent 50%), radial-gradient(50% 80% at 100% 0%, rgba(251,191,36,0.25) 0%, transparent 50%), radial-gradient(50% 80% at 100% 100%, rgba(16,185,129,0.30) 0%, transparent 50%), radial-gradient(50% 80% at 0% 100%, rgba(14,165,233,0.25) 0%, transparent 50%), white",
          filter: "saturate(1.15)",
        }}
      />
      {/* Fine grain noise */}
      <div
        aria-hidden
        className="absolute inset-0 pointer-events-none opacity-[0.4] mix-blend-overlay"
        style={{
          backgroundImage:
            'url("data:image/svg+xml;utf8,<svg xmlns=\\"http://www.w3.org/2000/svg\\" width=\\"160\\" height=\\"160\\" viewBox=\\"0 0 160 160\\"><filter id=\\"n\\"><feTurbulence type=\\"fractalNoise\\" baseFrequency=\\"0.9\\" numOctaves=\\"2\\" stitchTiles=\\"stitch\\"/></filter><rect width=\\"100%\\" height=\\"100%\\" filter=\\"url(%23n)\\" opacity=\\"0.5\\"/></svg>")',
        }}
      />

      {/* Visual */}
      <div className="relative flex-1 flex items-center justify-center min-h-[260px]">
        {children}
      </div>

      {/* Text */}
      <div className="relative md:w-[340px] md:shrink-0 md:self-center text-center md:text-left">
        <h3 className="text-2xl md:text-3xl font-bold tracking-[-0.02em] text-ink leading-tight text-balance">
          {title}
        </h3>
        <p className="mt-3 text-sm md:text-base text-ink-soft leading-relaxed text-balance">
          {sub}
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 1) Videogenerierung — Floating LP-Card mit Video-Hero
// ---------------------------------------------------------------------------

function VideoVisual() {
  return (
    <div className="relative w-full max-w-[300px] aspect-[16/12] mx-auto">
      {/* Ghost 2 */}
      <div
        aria-hidden
        className="absolute inset-0 rounded-2xl bg-white border border-line/60"
        style={{
          transform: "translate(-20px, -10px) rotate(-4deg)",
          opacity: 0.45,
          filter: "blur(1px)",
          boxShadow: "0 18px 40px -16px rgba(15,23,42,0.25)",
        }}
      />
      {/* Ghost 1 */}
      <div
        aria-hidden
        className="absolute inset-0 rounded-2xl bg-white border border-line/80"
        style={{
          transform: "translate(-10px, -4px) rotate(-2deg)",
          opacity: 0.75,
          boxShadow: "0 22px 50px -18px rgba(15,23,42,0.30)",
        }}
      />
      {/* Front */}
      <div
        className="absolute inset-0 rounded-2xl overflow-hidden border border-line bg-white"
        style={{
          boxShadow:
            "0 30px 60px -20px rgba(15,23,42,0.4), 0 8px 22px -8px rgba(15,23,42,0.18)",
        }}
      >
        <BrowserMock>
          <div
            className="relative h-full p-4 flex items-center gap-3"
            style={{
              background: "linear-gradient(135deg, #7C5CE8, #5232C7)",
            }}
          >
            <div className="flex-1 min-w-0">
              <div className="text-[8px] font-bold tracking-[0.2em] uppercase text-white/80 mb-1.5">
                Persönlich für dich
              </div>
              <div className="text-[14px] font-extrabold text-white leading-[1.05]">
                Max Mustermann,
                <br />
                schau dir das an.
              </div>
              <div className="mt-2 inline-flex text-[9px] font-bold text-ink bg-white rounded px-2 py-1 shadow-sm">
                Termin sichern →
              </div>
            </div>
            <div className="shrink-0 size-14 rounded-full overflow-hidden border-2 border-white shadow-xl">
              <video
                src="/demo-assets/webcam.mp4"
                muted
                autoPlay
                loop
                playsInline
                preload="metadata"
                className="w-full h-full object-cover"
              />
            </div>
          </div>
        </BrowserMock>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 2) Landingpage — Browser mit klarer LP-Komposition
// ---------------------------------------------------------------------------

function LandingVisual() {
  return (
    <div className="relative w-full max-w-[300px] aspect-[16/12] mx-auto">
      {/* Ghosts */}
      <div
        aria-hidden
        className="absolute inset-0 rounded-2xl bg-white border border-line/60"
        style={{
          transform: "translate(-20px, -10px) rotate(-4deg)",
          opacity: 0.45,
          filter: "blur(1px)",
          boxShadow: "0 18px 40px -16px rgba(15,23,42,0.25)",
        }}
      />
      <div
        aria-hidden
        className="absolute inset-0 rounded-2xl bg-white border border-line/80"
        style={{
          transform: "translate(-10px, -4px) rotate(-2deg)",
          opacity: 0.75,
          boxShadow: "0 22px 50px -18px rgba(15,23,42,0.30)",
        }}
      />
      {/* Front */}
      <div
        className="absolute inset-0 rounded-2xl overflow-hidden border border-line bg-white"
        style={{
          boxShadow:
            "0 30px 60px -20px rgba(15,23,42,0.4), 0 8px 22px -8px rgba(15,23,42,0.18)",
        }}
      >
        <BrowserMock url="deine-domain.de/lisa">
          <div className="h-full flex flex-col">
            {/* Header */}
            <div className="h-6 bg-white border-b border-line flex items-center px-3 gap-1.5">
              <div className="size-2.5 rounded bg-brand" />
              <div className="text-[7px] font-extrabold tracking-wider uppercase text-ink">
                Dein Logo
              </div>
              <div className="flex-1" />
              <div className="text-[6px] text-ink-muted flex gap-2">
                <span>Home</span>
                <span>Über</span>
              </div>
            </div>
            {/* Hero */}
            <div className="flex-1 p-3 flex items-center gap-2 bg-gradient-to-br from-[#F3EEFF] to-white">
              <div className="flex-1 min-w-0">
                <div className="text-[6px] font-bold tracking-wider uppercase text-brand-deep mb-0.5">
                  Persönlich für dich
                </div>
                <div className="text-[12px] font-extrabold text-ink leading-[1.05]">
                  Lisa,
                  <br />
                  schau dir das an.
                </div>
                <div className="mt-1.5 inline-block text-[7px] font-bold text-white rounded px-1.5 py-0.5 bg-brand-deep">
                  Termin sichern →
                </div>
              </div>
              <div className="shrink-0 w-16 aspect-video rounded overflow-hidden border-2 border-white shadow-md">
                <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-[#AA8CF5] to-[#7C5CE8] text-white text-[10px]">
                  ▶
                </div>
              </div>
            </div>
          </div>
        </BrowserMock>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 3) Brief — Floating cream A4 paper card mit Footer-QR
// ---------------------------------------------------------------------------

function BriefVisual() {
  return (
    <div className="relative w-full mx-auto" style={{ height: 280, maxWidth: 220 }}>
      {/* Ghosts */}
      <div
        aria-hidden
        className="absolute top-0 right-0 rounded-md"
        style={{
          width: 180,
          aspectRatio: "210/297",
          background: "#FAF6EE",
          border: "1px solid rgba(0,0,0,0.05)",
          transform: "translate(-30px, 14px) rotate(-12deg)",
          opacity: 0.35,
          filter: "blur(2px)",
          boxShadow: "0 18px 50px -16px rgba(0,0,0,0.45)",
        }}
      />
      <div
        aria-hidden
        className="absolute top-0 right-0 rounded-md"
        style={{
          width: 180,
          aspectRatio: "210/297",
          background: "#FFFCF5",
          border: "1px solid rgba(0,0,0,0.07)",
          transform: "translate(-14px, 6px) rotate(-6deg)",
          opacity: 0.6,
          filter: "blur(0.6px)",
          boxShadow: "0 22px 50px -18px rgba(0,0,0,0.5)",
        }}
      />
      {/* Front */}
      <div
        className="absolute top-0 left-1/2 -translate-x-1/2 rounded-md overflow-hidden"
        style={{
          width: 195,
          aspectRatio: "210/297",
          background: "linear-gradient(180deg, #FFFEFA 0%, #FAF6EE 100%)",
          border: "1px solid rgba(0,0,0,0.06)",
          boxShadow:
            "0 30px 60px -20px rgba(0,0,0,0.5), 0 10px 25px -10px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.8)",
        }}
      >
        <div
          aria-hidden
          className="absolute inset-x-0 top-0 h-2"
          style={{
            background: "linear-gradient(90deg, #7C5CE8, #AA8CF5)",
          }}
        />
        <div
          className="relative h-full flex flex-col"
          style={{ padding: "18px 16px 14px" }}
        >
          {/* Sender */}
          <div
            className="text-[4.5px] text-ink-muted pb-1 mb-2 border-b leading-tight"
            style={{ borderColor: "#E8DECC" }}
          >
            Deine Firma · Musterstraße 1 · 12345 Stadt
          </div>

          {/* Adresse + Datum */}
          <div className="flex justify-between items-start mb-3">
            <div className="text-[5.5px] leading-[1.35] text-ink">
              Herrn
              <br />
              <strong>Max Mustermann</strong>
              <br />
              Mustermann Industrie
              <br />
              Industriestr. 42
              <br />
              85737 Ismaning
            </div>
            <div className="text-[4.5px] text-ink-muted text-right">
              22.06.2026
            </div>
          </div>

          {/* Subject */}
          <div className="text-[6px] font-bold text-ink mb-1.5">
            Drei Punkte zu Ihrer Webseite
          </div>

          {/* Anrede */}
          <div className="text-[5.5px] text-ink mb-1.5">
            Sehr geehrter Herr Mustermann,
          </div>

          {/* Body lines */}
          <div className="space-y-[2px] mb-2">
            <div className="h-[1.5px] bg-ink/15 w-full rounded" />
            <div className="h-[1.5px] bg-ink/15 w-[92%] rounded" />
            <div className="h-[1.5px] bg-ink/15 w-[78%] rounded" />
          </div>

          {/* URL highlight */}
          <div
            className="text-[5.5px] font-mono font-bold inline-flex self-start px-1.5 py-0.5 rounded mb-2"
            style={{
              backgroundColor: "#F3EEFF",
              color: "#5232C7",
            }}
          >
            deine-domain.de/max
          </div>

          <div className="flex-1" />

          {/* Footer */}
          <div className="flex items-end justify-between gap-2">
            <div className="flex-1 min-w-0">
              <div className="text-[5px] text-ink mb-1">Mit besten Grüßen</div>
              <div
                className="text-[9px] italic"
                style={{
                  fontFamily: "'Georgia', 'Times New Roman', serif",
                }}
              >
                Dein Name
              </div>
            </div>
            <div className="shrink-0 size-7 rounded-[2px] border border-ink/15 overflow-hidden bg-white p-[1px]">
              <div
                className="size-full"
                style={{
                  background:
                    "repeating-conic-gradient(#0F172A 0deg 90deg, white 90deg 180deg)",
                  backgroundSize: "2px 2px",
                }}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 4) Push — vertikale Pills wie Mac-Notifications
// ---------------------------------------------------------------------------

function PushVisual() {
  const NOTIFS = [
    {
      icon: <Eye className="size-3" />,
      who: "Max Mustermann",
      what: "öffnete deine Seite",
      delay: 0,
    },
    {
      icon: <PlayCircle className="size-3" />,
      who: "Lisa Lust",
      what: "schaut gerade",
      delay: 0.1,
    },
    {
      icon: <MousePointerClick className="size-3" />,
      who: "Franz Friedrich",
      what: "klickte Termin",
      delay: 0.2,
    },
  ];
  return (
    <div className="relative w-full max-w-[260px] mx-auto flex flex-col items-stretch gap-2.5">
      {NOTIFS.map((n, i) => (
        <div
          key={i}
          className="rounded-2xl bg-white border border-line/80 px-3 py-2.5 flex items-center gap-3 shadow-[0_8px_20px_-12px_rgba(15,23,42,0.25)]"
          style={{
            transform: `translateY(${i * 0}px)`,
          }}
        >
          <div
            className="size-7 shrink-0 rounded-lg flex items-center justify-center text-white"
            style={{
              background:
                i === 0
                  ? "linear-gradient(135deg, #10B981, #047857)"
                  : i === 1
                    ? "linear-gradient(135deg, #AA8CF5, #7C5CE8)"
                    : "linear-gradient(135deg, #FBBF24, #D97706)",
            }}
          >
            {n.icon}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[12px] text-ink leading-tight">
              <span className="font-bold">{n.who}</span>{" "}
              <span className="text-ink-muted">{n.what}</span>
            </div>
            <div className="text-[10px] text-ink-muted mt-0.5">
              {i === 0 ? "gerade eben" : i === 1 ? "vor 4 s" : "vor 12 s"}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 5) Analytics — Floating Mini-Dashboard
// ---------------------------------------------------------------------------

function AnalyticsVisual() {
  return (
    <div className="relative w-full max-w-[260px] mx-auto">
      <div
        className="rounded-2xl bg-white border border-line p-5 shadow-[0_8px_30px_-12px_rgba(15,23,42,0.22)]"
      >
        {/* KPI big */}
        <div className="flex items-end justify-between mb-3">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-wider text-ink-muted">
              Watch-Time ø
            </div>
            <div className="text-[40px] font-extrabold leading-none mt-1 text-ink">
              83%
            </div>
          </div>
          <div className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-emerald-50 text-emerald-700 text-[10px] font-bold">
            <TrendingUp className="size-3" />
            +12%
          </div>
        </div>

        {/* Chart */}
        <div className="rounded-xl bg-surface-soft border border-line/60 p-3">
          <svg viewBox="0 0 200 50" className="w-full h-14">
            <defs>
              <linearGradient
                id="vc-feat-chart"
                x1="0"
                y1="0"
                x2="0"
                y2="1"
              >
                <stop offset="0%" stopColor="#7C5CE8" stopOpacity="0.45" />
                <stop offset="100%" stopColor="#7C5CE8" stopOpacity="0" />
              </linearGradient>
            </defs>
            <path
              d="M0,40 L20,35 L40,30 L60,32 L80,22 L100,18 L120,20 L140,12 L160,10 L200,4 L200,50 L0,50 Z"
              fill="url(#vc-feat-chart)"
            />
            <path
              d="M0,40 L20,35 L40,30 L60,32 L80,22 L100,18 L120,20 L140,12 L160,10 L200,4"
              fill="none"
              stroke="#7C5CE8"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>

        {/* Mini-KPIs */}
        <div className="grid grid-cols-3 gap-2 mt-3">
          {[
            { l: "Versendet", v: "743" },
            { l: "Geöffnet", v: "284" },
            { l: "Klicks", v: "39" },
          ].map((k, i) => (
            <div
              key={i}
              className="rounded-lg bg-surface-soft border border-line/60 px-2 py-1.5"
            >
              <div className="text-[8px] uppercase tracking-wider text-ink-muted font-bold">
                {k.l}
              </div>
              <div className="text-[14px] font-extrabold text-ink mt-0.5 leading-none">
                {k.v}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 6) A/B Testing — zwei Cards mit Winner-Markierung
// ---------------------------------------------------------------------------

function ABVisual() {
  return (
    <div className="relative w-full max-w-[300px] mx-auto flex items-end gap-3">
      {/* A */}
      <div
        className="flex-1 rounded-2xl bg-white border border-line p-3 shadow-[0_8px_20px_-12px_rgba(15,23,42,0.18)] relative"
        style={{ minHeight: 180 }}
      >
        <div className="size-6 rounded-full bg-ink-muted/15 flex items-center justify-center text-[10px] font-extrabold text-ink-muted mb-3">
          A
        </div>
        <div className="space-y-1 mb-3">
          <div className="h-1.5 bg-ink/15 w-full rounded" />
          <div className="h-1.5 bg-ink/15 w-3/4 rounded" />
        </div>
        <div className="rounded-lg bg-surface-soft h-12 mb-3" />
        <div className="text-[10px] font-semibold uppercase tracking-wider text-ink-muted">
          Conversion
        </div>
        <div className="text-2xl font-extrabold text-ink-muted/70 leading-none mt-1">
          12%
        </div>
      </div>

      {/* B winner */}
      <div
        className="flex-1 rounded-2xl bg-white border-2 border-brand p-3 shadow-[0_14px_30px_-14px_rgba(124,92,232,0.4)] relative"
        style={{ minHeight: 200 }}
      >
        <div className="absolute -top-2 -right-2 inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-brand text-white text-[9px] font-bold shadow-md">
          <CheckCircle2 className="size-2.5" />
          Winner
        </div>
        <div className="size-6 rounded-full bg-brand text-white flex items-center justify-center text-[10px] font-extrabold mb-3">
          B
        </div>
        <div className="space-y-1 mb-3">
          <div className="h-1.5 bg-brand/40 w-full rounded" />
          <div className="h-1.5 bg-brand/40 w-3/4 rounded" />
        </div>
        <div className="rounded-lg bg-brand-soft h-12 mb-3" />
        <div className="text-[10px] font-semibold uppercase tracking-wider text-brand-deep">
          Conversion
        </div>
        <div className="text-2xl font-extrabold text-brand-deep leading-none mt-1">
          18%
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 7) Integrations — Workflow VIDEOCOMET → CRM
// ---------------------------------------------------------------------------

function IntegrationsVisual() {
  const TARGETS = [
    { slug: "hubspot", name: "HubSpot" },
    { slug: "zapier", name: "Zapier" },
    { slug: "make", name: "Make" },
    { slug: "close", name: "Close" },
  ];
  return (
    <div className="relative w-full max-w-[480px] mx-auto py-6">
      {/* Source Pill: Tracking-Event */}
      <div className="flex justify-center mb-4">
        <div className="inline-flex items-center gap-2.5 px-4 py-2.5 rounded-full bg-white shadow-[0_10px_24px_-12px_rgba(15,23,42,0.25)] border border-line">
          <div className="size-7 rounded-full flex items-center justify-center text-white"
            style={{
              background: "linear-gradient(135deg, #AA8CF5, #5232C7)",
            }}
          >
            <Bell className="size-3.5" />
          </div>
          <div>
            <div className="text-[13px] font-bold text-ink leading-tight">
              CTA geklickt
            </div>
            <div className="text-[10px] text-ink-muted leading-tight">
              Max Mustermann · gerade eben
            </div>
          </div>
        </div>
      </div>

      {/* Connector */}
      <div className="flex justify-center mb-4">
        <svg width="60" height="40" viewBox="0 0 60 40" className="text-ink-muted/40">
          <path
            d="M30 0 L30 20 M10 38 L30 22 L50 38"
            stroke="currentColor"
            strokeWidth="1.5"
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray="3 3"
          />
        </svg>
      </div>

      {/* Target tools — fan out */}
      <div className="grid grid-cols-4 gap-2.5">
        {TARGETS.map((t) => (
          <div
            key={t.slug}
            className="rounded-2xl bg-white border border-line shadow-[0_8px_20px_-12px_rgba(15,23,42,0.2)] p-3 flex flex-col items-center gap-2"
          >
            <img
              src={`https://cdn.simpleicons.org/${t.slug}`}
              alt={t.name}
              width={28}
              height={28}
              loading="lazy"
              className="size-7"
            />
            <div className="text-[11px] font-semibold text-ink text-center">
              {t.name}
            </div>
            <CheckCircle2 className="size-3.5 text-emerald-500" />
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Browser-Mock-Helper
// ---------------------------------------------------------------------------

function BrowserMock({
  children,
  url,
}: {
  children: React.ReactNode;
  url?: string;
}) {
  return (
    <div className="relative w-full h-full flex flex-col bg-white">
      <div className="h-6 bg-white border-b border-line flex items-center px-2 gap-1.5 shrink-0">
        <div className="size-1.5 rounded-full bg-red-400" />
        <div className="size-1.5 rounded-full bg-yellow-400" />
        <div className="size-1.5 rounded-full bg-green-400" />
        {url ? (
          <div className="flex-1 ml-2 h-3 rounded-full bg-surface-soft flex items-center px-2">
            <span className="text-[6px] text-ink-muted truncate">{url}</span>
          </div>
        ) : (
          <div className="flex-1 ml-2 h-2 rounded-full bg-surface-soft" />
        )}
      </div>
      <div className="flex-1 min-h-0">{children}</div>
    </div>
  );
}

// Unused but kept reserved for future variants
void Database;
void FileText;
void Globe;
void Mail;
void PenLine;
