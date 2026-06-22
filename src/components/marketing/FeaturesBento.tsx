"use client";

import * as React from "react";
import {
  Bell,
  Eye,
  FlaskConical,
  LineChart,
  Mail,
  MousePointerClick,
  PlayCircle,
  Plug,
  TrendingUp,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { RevealOnScroll } from "./RevealOnScroll";

/**
 * Features-Bento — Apple-Style Grid mit glas-morphismus, transparenten
 * Gradients und fokussierten Visuals. Jede Card hat EIN klares Visual,
 * ruhige Typo, viel Whitespace.
 */
export function FeaturesBento() {
  return (
    <section
      id="features"
      className="relative z-[2] w-full bg-white py-24 md:py-32 overflow-hidden"
    >
      {/* sehr softer Background-Gradient für Tiefe */}
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
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 md:gap-4 auto-rows-[minmax(260px,_auto)]">
          {/* 1) Video — large hero */}
          <RevealOnScroll
            delay={400}
            className="lg:col-span-7 lg:row-span-2"
          >
            <BentoCard dark className="bg-[#0B0D1A]">
              <VideoBento />
            </BentoCard>
          </RevealOnScroll>

          {/* 2) Push */}
          <RevealOnScroll delay={520} className="lg:col-span-5">
            <BentoCard dark className="bg-[#0F2E26]">
              <PushBento />
            </BentoCard>
          </RevealOnScroll>

          {/* 3) Analytics */}
          <RevealOnScroll delay={640} className="lg:col-span-5">
            <BentoCard dark className="bg-[#0B2540]">
              <AnalyticsBento />
            </BentoCard>
          </RevealOnScroll>

          {/* 4) Landingpage — light, wide */}
          <RevealOnScroll delay={760} className="lg:col-span-7">
            <BentoCard className="bg-[#FAFAFE]">
              <LandingpageBento />
            </BentoCard>
          </RevealOnScroll>

          {/* 5) Brief */}
          <RevealOnScroll delay={880} className="lg:col-span-5">
            <BentoCard dark className="bg-[#2A1505]">
              <BriefBento />
            </BentoCard>
          </RevealOnScroll>

          {/* 6) A/B-Testing — light */}
          <RevealOnScroll delay={1000} className="lg:col-span-4">
            <BentoCard className="bg-[#FEF3C7]">
              <ABBento />
            </BentoCard>
          </RevealOnScroll>

          {/* 7) Anbindungen — light, wide */}
          <RevealOnScroll delay={1120} className="lg:col-span-8">
            <BentoCard className="bg-white">
              <IntegrationsBento />
            </BentoCard>
          </RevealOnScroll>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Card-Shell + decorative gradient layer
// ---------------------------------------------------------------------------

function BentoCard({
  children,
  className,
  dark = false,
}: {
  children: React.ReactNode;
  className?: string;
  dark?: boolean;
}) {
  return (
    <div
      className={cn(
        "relative w-full h-full overflow-hidden rounded-3xl border transition-shadow",
        dark
          ? "border-white/[0.07] shadow-[0_24px_60px_-30px_rgba(15,23,42,0.6)]"
          : "border-line shadow-[0_24px_60px_-30px_rgba(15,23,42,0.18)]",
        className,
      )}
    >
      {/* Apple "shine" — Top edge highlight */}
      <div
        aria-hidden
        className="absolute inset-x-0 top-0 h-px"
        style={{
          background: dark
            ? "linear-gradient(90deg, transparent, rgba(255,255,255,0.18), transparent)"
            : "linear-gradient(90deg, transparent, rgba(255,255,255,0.9), transparent)",
        }}
      />
      {children}
    </div>
  );
}

function Eyebrow({
  children,
  dark = false,
}: {
  children: React.ReactNode;
  dark?: boolean;
}) {
  return (
    <div
      className={cn(
        "text-[10px] font-semibold tracking-[0.22em] uppercase",
        dark ? "text-white/45" : "text-brand-deep",
      )}
    >
      {children}
    </div>
  );
}

function GlassIcon({
  children,
  tint = "white",
  size = "md",
}: {
  children: React.ReactNode;
  tint?: "white" | "brand";
  size?: "sm" | "md";
}) {
  return (
    <div className="relative inline-flex shrink-0">
      <div
        aria-hidden
        className={cn(
          "absolute inset-0 rounded-2xl blur-2xl",
          size === "sm" ? "scale-110" : "scale-125",
          tint === "white" ? "bg-white/25" : "bg-brand/30",
        )}
      />
      <div
        className={cn(
          "relative rounded-2xl flex items-center justify-center border backdrop-blur-xl",
          size === "sm" ? "size-10" : "size-12",
          tint === "white"
            ? "bg-white/10 text-white border-white/20"
            : "bg-brand-soft/80 text-brand-deep border-brand/30",
        )}
      >
        {children}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 1) Videogenerierung — large hero card
// ---------------------------------------------------------------------------

function VideoBento() {
  return (
    <div className="relative w-full h-full flex flex-col p-8 md:p-10">
      {/* Decorative purple glow */}
      <div
        aria-hidden
        className="absolute -top-32 -right-24 size-[520px] rounded-full pointer-events-none"
        style={{
          background:
            "radial-gradient(closest-side, rgba(170,140,245,0.45), rgba(170,140,245,0) 70%)",
        }}
      />
      <div
        aria-hidden
        className="absolute bottom-0 left-0 size-[280px] rounded-full pointer-events-none opacity-60"
        style={{
          background:
            "radial-gradient(closest-side, rgba(236,72,153,0.30), transparent 75%)",
        }}
      />

      {/* Visual area top */}
      <div className="relative flex-1 flex items-start justify-end min-h-[200px]">
        {/* Two ghost cards behind */}
        <div
          aria-hidden
          className="absolute top-8 right-4 w-[300px] aspect-[16/10] rounded-2xl border border-white/[0.06] shadow-2xl opacity-40 blur-sm"
          style={{
            transform: "rotate(-10deg) translate(-30px, 30px)",
            background:
              "linear-gradient(135deg, rgba(124,92,232,0.6), rgba(82,50,199,0.4))",
          }}
        />
        <div
          aria-hidden
          className="absolute top-2 right-10 w-[300px] aspect-[16/10] rounded-2xl border border-white/[0.08] shadow-2xl opacity-70"
          style={{
            transform: "rotate(-5deg) translate(-12px, 18px)",
            background:
              "linear-gradient(135deg, rgba(170,140,245,0.5), rgba(124,92,232,0.6))",
          }}
        />

        {/* Foreground crisp video preview */}
        <div
          className="relative w-[320px] aspect-[16/10] rounded-2xl border border-white/15 shadow-[0_25px_60px_-15px_rgba(0,0,0,0.7)] overflow-hidden"
          style={{ transform: "rotate(2deg) translate(-6px, 0)" }}
        >
          <VideoPreviewMock />
        </div>
      </div>

      {/* Text bottom-left */}
      <div className="relative mt-6 max-w-[320px]">
        <Eyebrow dark>Videogenerierung</Eyebrow>
        <h3 className="mt-3 text-3xl md:text-4xl font-semibold tracking-[-0.02em] text-white leading-[1.05]">
          Persönliche Videos.
          <br />
          <span className="text-brand-light">In Serie.</span>
        </h3>
        <p className="mt-3 text-sm md:text-base text-white/65 leading-relaxed">
          Eine Aufnahme. Hunderte personalisierte Videos. Vollautomatisch.
        </p>
      </div>
    </div>
  );
}

function VideoPreviewMock() {
  return (
    <div className="absolute inset-0 flex flex-col bg-[#11131F]">
      {/* Browser chrome */}
      <div className="h-6 bg-white/95 flex items-center px-3 gap-1.5">
        <div className="size-1.5 rounded-full bg-red-400" />
        <div className="size-1.5 rounded-full bg-yellow-400" />
        <div className="size-1.5 rounded-full bg-green-400" />
        <div className="flex-1 ml-2 h-2 rounded-full bg-surface-soft" />
      </div>
      {/* LP hero */}
      <div
        className="flex-1 relative p-3 flex items-center"
        style={{
          background: "linear-gradient(135deg, #7C5CE8, #5232C7)",
        }}
      >
        <div className="flex-1 min-w-0">
          <div className="text-[7px] font-bold tracking-[0.2em] uppercase text-white/80 mb-1">
            Persönlich für dich
          </div>
          <div className="text-[13px] font-extrabold text-white leading-tight">
            Max Mustermann,
            <br />
            schau dir das an.
          </div>
          <div
            className="mt-2 inline-flex text-[7px] font-bold text-brand-deep bg-white rounded px-1.5 py-0.5"
          >
            Termin sichern →
          </div>
        </div>
        {/* Webcam PiP */}
        <div className="shrink-0 size-12 rounded-full overflow-hidden border-[2px] border-white shadow-xl ml-2">
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
    </div>
  );
}

// ---------------------------------------------------------------------------
// 2) Push Notifications
// ---------------------------------------------------------------------------

function PushBento() {
  return (
    <div className="relative w-full h-full flex flex-col p-7">
      {/* Background glow */}
      <div
        aria-hidden
        className="absolute -top-12 -right-12 size-72 rounded-full pointer-events-none"
        style={{
          background:
            "radial-gradient(closest-side, rgba(16,185,129,0.45), transparent 70%)",
        }}
      />

      <GlassIcon>
        <Bell className="size-5" />
      </GlassIcon>

      {/* Stacked notifs floating */}
      <div className="absolute top-6 right-4 flex flex-col gap-1.5 w-[170px]">
        {[
          { icon: <Eye className="size-3" />, who: "Max", what: "öffnete deine Seite" },
          { icon: <PlayCircle className="size-3" />, who: "Lisa", what: "schaut gerade" },
          { icon: <MousePointerClick className="size-3" />, who: "Franz", what: "klickte Termin" },
        ].map((n, i) => (
          <div
            key={i}
            className="rounded-xl backdrop-blur-md border border-white/15 p-2 flex items-center gap-2"
            style={{
              backgroundColor: "rgba(15,23,42,0.55)",
              transform: `translateX(${-i * 4}px) translateY(${i * -2}px)`,
              opacity: 1 - i * 0.18,
            }}
          >
            <div className="size-5 shrink-0 rounded-md bg-white/15 flex items-center justify-center text-white">
              {n.icon}
            </div>
            <div className="text-[9px] leading-tight text-white">
              <span className="font-bold">{n.who}</span>{" "}
              <span className="opacity-70">{n.what}</span>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-auto pt-12">
        <Eyebrow dark>Push-Notifications</Eyebrow>
        <h3 className="mt-3 text-xl md:text-2xl font-semibold tracking-[-0.02em] text-white leading-tight">
          Live, wenn jemand reagiert.
        </h3>
        <p className="mt-2 text-sm text-white/60 leading-relaxed">
          Jede Öffnung, jeden Klick sofort sehen.
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 3) Analytics
// ---------------------------------------------------------------------------

function AnalyticsBento() {
  return (
    <div className="relative w-full h-full flex flex-col p-7">
      <div
        aria-hidden
        className="absolute -top-20 -right-10 size-72 rounded-full pointer-events-none"
        style={{
          background:
            "radial-gradient(closest-side, rgba(14,165,233,0.45), transparent 70%)",
        }}
      />

      <GlassIcon>
        <LineChart className="size-5" />
      </GlassIcon>

      {/* KPI floating + Chart floating */}
      <div className="absolute top-6 right-4 w-[170px] flex flex-col gap-2">
        <div className="rounded-xl backdrop-blur-md border border-white/15 p-2.5"
          style={{ backgroundColor: "rgba(255,255,255,0.06)" }}
        >
          <div className="flex items-center justify-between mb-1">
            <span className="text-[8px] font-bold uppercase tracking-wider text-white/55">
              Watch-Time ø
            </span>
            <TrendingUp className="size-3 text-emerald-300" />
          </div>
          <div className="text-xl font-extrabold text-white leading-none">
            83 %
          </div>
        </div>
        <div className="rounded-xl backdrop-blur-md border border-white/15 p-2"
          style={{ backgroundColor: "rgba(255,255,255,0.06)" }}
        >
          <svg viewBox="0 0 100 28" className="w-full h-8">
            <defs>
              <linearGradient id="vc-bento-chart" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="rgba(255,255,255,0.55)" />
                <stop offset="100%" stopColor="rgba(255,255,255,0)" />
              </linearGradient>
            </defs>
            <path
              d="M0,24 L15,22 L30,18 L45,16 L60,10 L75,12 L90,5 L100,3 L100,28 L0,28 Z"
              fill="url(#vc-bento-chart)"
            />
            <path
              d="M0,24 L15,22 L30,18 L45,16 L60,10 L75,12 L90,5 L100,3"
              fill="none"
              stroke="white"
              strokeWidth="1.3"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
      </div>

      <div className="mt-auto pt-12">
        <Eyebrow dark>Analytics</Eyebrow>
        <h3 className="mt-3 text-xl md:text-2xl font-semibold tracking-[-0.02em] text-white leading-tight">
          Zahlen, die zählen.
        </h3>
        <p className="mt-2 text-sm text-white/60 leading-relaxed">
          Watch-Time und CTAs auf einen Blick.
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 4) Landingpage — wide light card
// ---------------------------------------------------------------------------

function LandingpageBento() {
  const LEADS = ["Max", "Lisa", "Franz"];
  return (
    <div className="relative w-full h-full flex p-8 md:p-10 gap-6">
      {/* Subtle brand wash */}
      <div
        aria-hidden
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "radial-gradient(60% 80% at 0% 50%, rgba(243,238,255,0.6), rgba(243,238,255,0) 70%)",
        }}
      />

      {/* Left text */}
      <div className="relative flex-1 flex flex-col justify-center max-w-[280px]">
        <Eyebrow>Landingpages</Eyebrow>
        <h3 className="mt-3 text-3xl font-semibold tracking-[-0.02em] text-ink leading-[1.05]">
          Eine eigene Seite.
          <br />
          <span className="text-brand-deep">Für jeden Lead.</span>
        </h3>
        <p className="mt-3 text-sm text-ink-muted leading-relaxed">
          Automatisch personalisiert. Vorname, Firma und das Video
          sauber im Hero.
        </p>
      </div>

      {/* Right visual — fanned LP thumbnails */}
      <div className="relative flex-1 hidden md:flex items-center justify-end pr-4">
        <div className="relative w-[280px] h-[180px]">
          {LEADS.map((name, i) => (
            <div
              key={name}
              className="absolute top-0 rounded-xl bg-white shadow-[0_18px_40px_-16px_rgba(15,23,42,0.4)] border border-line overflow-hidden"
              style={{
                width: "240px",
                aspectRatio: "16/10",
                right: 0,
                transform: `translate(${-i * 18}px, ${i * 12}px) rotate(${(i - 1) * -3}deg)`,
                zIndex: LEADS.length - i,
              }}
            >
              <LpThumbMock name={name} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function LpThumbMock({ name }: { name: string }) {
  return (
    <div className="w-full h-full flex flex-col bg-white">
      <div className="h-3 bg-surface-soft border-b border-line flex items-center px-2 gap-1">
        <div className="size-1 rounded-full bg-red-400" />
        <div className="size-1 rounded-full bg-yellow-400" />
        <div className="size-1 rounded-full bg-green-400" />
        <div className="flex-1 ml-1 h-1 rounded bg-line" />
      </div>
      <div className="h-4 bg-white border-b border-line flex items-center px-2 gap-1">
        <div className="size-2 rounded bg-brand" />
        <div className="text-[6px] font-bold tracking-wider uppercase text-ink">
          Dein Logo
        </div>
      </div>
      <div className="flex-1 flex items-center px-3 gap-2">
        <div className="flex-1 min-w-0">
          <div className="text-[5px] font-bold tracking-wider uppercase text-brand-deep mb-0.5">
            Persönlich für dich
          </div>
          <div className="text-[11px] font-extrabold text-ink leading-[1.05]">
            {name},
            <br />
            schau dir das an.
          </div>
          <div
            className="mt-1 inline-block text-[5px] font-bold text-white rounded px-1 py-0.5"
            style={{ backgroundColor: "#7C5CE8" }}
          >
            Termin sichern →
          </div>
        </div>
        <div className="shrink-0 w-14 aspect-video rounded bg-gradient-to-br from-[#AA8CF5] to-[#7C5CE8] border-2 border-white shadow flex items-center justify-center text-white text-[8px] overflow-hidden">
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
    </div>
  );
}

// ---------------------------------------------------------------------------
// 5) Brief
// ---------------------------------------------------------------------------

function BriefBento() {
  return (
    <div className="relative w-full h-full flex flex-col p-7">
      <div
        aria-hidden
        className="absolute -top-20 -right-12 size-72 rounded-full pointer-events-none"
        style={{
          background:
            "radial-gradient(closest-side, rgba(251,146,60,0.5), transparent 70%)",
        }}
      />

      <GlassIcon>
        <Mail className="size-5" />
      </GlassIcon>

      {/* Letter peek floating top-right */}
      <div
        className="absolute top-5 right-3 bg-white rounded-md shadow-2xl border border-black/5"
        style={{
          width: 100,
          aspectRatio: "210/297",
          transform: "rotate(10deg)",
          padding: "8px 10px 6px",
        }}
      >
        <div className="text-[3.5px] text-ink/60 leading-tight font-medium">
          Max Mustermann
          <br />
          Industriestr. 42
          <br />
          85737 Ismaning
        </div>
        <div className="text-[4px] font-bold text-ink/80 mt-2.5">
          Sehr geehrter
        </div>
        <div className="space-y-0.5 mt-1.5">
          <div className="h-px bg-ink/15 w-full" />
          <div className="h-px bg-ink/15 w-5/6" />
          <div className="h-px bg-ink/15 w-3/4" />
        </div>
        <div
          className="text-[3.5px] font-mono font-bold mt-1.5 px-1 py-0.5 rounded inline-block"
          style={{
            backgroundColor: "#F3EEFF",
            color: "#5232C7",
          }}
        >
          deine-domain.de/max
        </div>
        <div className="absolute bottom-1 right-1 size-4"
          style={{
            background: "repeating-conic-gradient(#0F172A 0deg 90deg, white 90deg 180deg)",
            backgroundSize: "2px 2px",
          }}
        />
      </div>

      <div className="mt-auto pt-12">
        <Eyebrow dark>Briefe</Eyebrow>
        <h3 className="mt-3 text-xl md:text-2xl font-semibold tracking-[-0.02em] text-white leading-tight">
          Briefe pro Lead.
        </h3>
        <p className="mt-2 text-sm text-white/60 leading-relaxed">
          Persönlich adressiert, mit QR-Code zum Video.
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 6) A/B Testing — light, amber
// ---------------------------------------------------------------------------

function ABBento() {
  return (
    <div className="relative w-full h-full flex flex-col p-7">
      <div
        aria-hidden
        className="absolute -top-16 -right-12 size-72 rounded-full pointer-events-none"
        style={{
          background:
            "radial-gradient(closest-side, rgba(251,191,36,0.5), transparent 70%)",
        }}
      />

      <GlassIcon tint="brand">
        <FlaskConical className="size-5" />
      </GlassIcon>

      {/* Split comparison floating top-right */}
      <div className="absolute top-6 right-4 flex gap-1.5 w-[140px]">
        {[
          { label: "A", v: "12 %", win: false },
          { label: "B", v: "18 %", win: true },
        ].map((c) => (
          <div
            key={c.label}
            className={cn(
              "flex-1 rounded-xl p-2 border backdrop-blur-md",
              c.win
                ? "bg-white border-amber-900/20"
                : "bg-white/40 border-amber-900/10",
            )}
          >
            <div
              className={cn(
                "size-4 rounded-full flex items-center justify-center text-[8px] font-extrabold mb-1",
                c.win
                  ? "bg-amber-900 text-white"
                  : "bg-amber-900/30 text-amber-900",
              )}
            >
              {c.label}
            </div>
            <div
              className={cn(
                "text-base font-extrabold leading-none",
                c.win ? "text-amber-900" : "text-amber-900/60",
              )}
            >
              {c.v}
            </div>
            <div className="text-[7px] text-amber-900/55 mt-0.5">
              Conversion
            </div>
          </div>
        ))}
      </div>

      <div className="mt-auto pt-12">
        <Eyebrow>A/B-Testing</Eyebrow>
        <h3 className="mt-3 text-xl md:text-2xl font-semibold tracking-[-0.02em] text-ink leading-tight">
          Was wirklich wirkt.
        </h3>
        <p className="mt-2 text-sm text-ink-muted leading-relaxed">
          Templates und Headlines vergleichen.
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 7) Anbindungen — light, wider
// ---------------------------------------------------------------------------

function IntegrationsBento() {
  const LOGOS = [
    { name: "HubSpot", color: "#FF7A59" },
    { name: "Salessuite", color: "#0EA5E9" },
    { name: "Close", color: "#22C55E" },
    { name: "Zapier", color: "#FF4F00" },
    { name: "Make", color: "#6D28D9" },
  ];
  return (
    <div className="relative w-full h-full flex p-7 md:p-8 gap-6">
      <div
        aria-hidden
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "radial-gradient(60% 80% at 0% 50%, rgba(243,238,255,0.6), rgba(243,238,255,0) 70%)",
        }}
      />

      {/* Left text */}
      <div className="relative flex-1 flex flex-col justify-center max-w-[260px]">
        <Eyebrow>Anbindungen</Eyebrow>
        <h3 className="mt-3 text-xl md:text-2xl font-semibold tracking-[-0.02em] text-ink leading-tight">
          Verbunden mit deinen Tools.
        </h3>
        <p className="mt-2 text-sm text-ink-muted leading-relaxed">
          HubSpot, Salessuite, Close, Zapier oder Make. Webhook-Events
          pro Aktion.
        </p>
      </div>

      {/* Right floating logo cards */}
      <div className="relative flex-1 hidden md:flex items-center justify-end pr-4">
        <div className="relative w-[300px] h-[180px]">
          {LOGOS.map((l, i) => {
            // Staggered floating chip positions
            const positions = [
              { top: 0, left: 0 },
              { top: 8, left: 110 },
              { top: 14, left: 215 },
              { top: 90, left: 30 },
              { top: 100, left: 150 },
            ];
            const pos = positions[i];
            return (
              <div
                key={l.name}
                className="absolute px-3 py-2 rounded-xl bg-white border border-line shadow-[0_10px_25px_-8px_rgba(15,23,42,0.18)] flex items-center gap-2"
                style={{ top: pos.top, left: pos.left }}
              >
                <span
                  className="size-2 rounded-full"
                  style={{ backgroundColor: l.color }}
                />
                <span className="text-[12px] font-semibold text-ink">
                  {l.name}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// Silence unused-import warnings for icons reserved for future variants
void Plug;
