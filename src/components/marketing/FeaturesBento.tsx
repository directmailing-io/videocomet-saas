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
  TrendingUp,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { RevealOnScroll } from "./RevealOnScroll";

/**
 * Features-Bento — Apple-Style Grid mit glas-morphismus, transparenten
 * Gradients und sophistizierten Visuals. Echte Brand-Logos. Fokussierte
 * Mockups statt generischer Visuals.
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
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 md:gap-4 auto-rows-[minmax(260px,_auto)]">
          <RevealOnScroll
            delay={400}
            className="lg:col-span-7 lg:row-span-2"
          >
            <BentoCard dark className="bg-[#08090F]">
              <VideoBento />
            </BentoCard>
          </RevealOnScroll>

          <RevealOnScroll delay={520} className="lg:col-span-5">
            <BentoCard dark className="bg-[#0A2922]">
              <PushBento />
            </BentoCard>
          </RevealOnScroll>

          <RevealOnScroll delay={640} className="lg:col-span-5">
            <BentoCard dark className="bg-[#072138]">
              <AnalyticsBento />
            </BentoCard>
          </RevealOnScroll>

          <RevealOnScroll delay={760} className="lg:col-span-7">
            <BentoCard className="bg-[#FAFAFE]">
              <LandingpageBento />
            </BentoCard>
          </RevealOnScroll>

          <RevealOnScroll delay={880} className="lg:col-span-5">
            <BentoCard dark className="bg-[#1F0F03]">
              <BriefBento />
            </BentoCard>
          </RevealOnScroll>

          <RevealOnScroll delay={1000} className="lg:col-span-4">
            <BentoCard className="bg-[#FEF3C7]">
              <ABBento />
            </BentoCard>
          </RevealOnScroll>

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
// Card-Shell
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
}: {
  children: React.ReactNode;
  tint?: "white" | "brand";
}) {
  return (
    <div className="relative inline-flex shrink-0">
      <div
        aria-hidden
        className={cn(
          "absolute inset-0 rounded-2xl blur-2xl scale-125",
          tint === "white" ? "bg-white/25" : "bg-brand/30",
        )}
      />
      <div
        className={cn(
          "relative size-12 rounded-2xl flex items-center justify-center border backdrop-blur-xl",
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
// Brand-Logos — vereinfachte SVGs in den jeweils echten Brand-Farben
// ---------------------------------------------------------------------------

function HubSpotLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden>
      <g fill="#FF7A59">
        <circle cx="22.5" cy="20.5" r="6.5" />
        <rect x="21" y="6" width="3" height="11" rx="1.5" />
        <circle cx="22.5" cy="5.5" r="3.5" />
        <rect x="2" y="19" width="14" height="3" rx="1.5" />
        <circle cx="2.5" cy="20.5" r="3.5" />
      </g>
      <circle cx="22.5" cy="20.5" r="2.6" fill="white" />
    </svg>
  );
}

function ZapierLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden>
      <circle cx="16" cy="16" r="15" fill="#FF4F00" />
      <g
        stroke="white"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      >
        <line x1="16" y1="7" x2="16" y2="25" />
        <line x1="7" y1="16" x2="25" y2="16" />
        <line x1="9.5" y1="9.5" x2="22.5" y2="22.5" />
        <line x1="22.5" y1="9.5" x2="9.5" y2="22.5" />
      </g>
      <circle cx="16" cy="16" r="3.6" fill="white" />
    </svg>
  );
}

function MakeLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden>
      <rect width="32" height="32" rx="8" fill="#6D00CC" />
      <g fill="white">
        <rect x="9" y="9" width="3" height="14" rx="1.5" />
        <rect x="14.5" y="9" width="3" height="14" rx="1.5" />
        <rect
          x="20"
          y="9"
          width="3"
          height="14"
          rx="1.5"
          transform="rotate(20 21.5 16)"
        />
      </g>
    </svg>
  );
}

function SalessuiteLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden>
      <rect width="32" height="32" rx="8" fill="#1E40AF" />
      <path
        d="M22 12.5c0-1.5-1.5-2.5-3.5-2.5h-2c-2 0-3.5 1-3.5 2.5s1.5 2.5 3.5 2.5h2c2 0 3.5 1 3.5 2.5s-1.5 2.5-3.5 2.5h-2c-2 0-3.5-1-3.5-2.5"
        stroke="white"
        strokeWidth="2.4"
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  );
}

function CloseLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden>
      <rect width="32" height="32" rx="8" fill="#10B981" />
      <path
        d="M22 11.5c-1.6-1.4-3.6-2-5.5-1.7-2.7.4-5 2.9-5 6.2s2.3 5.8 5 6.2c1.9.3 3.9-.3 5.5-1.7"
        stroke="white"
        strokeWidth="2.6"
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// 1) Videogenerierung — large hero
// ---------------------------------------------------------------------------

function VideoBento() {
  const STACK = [
    {
      name: "Franz Friedrich",
      company: "Friedrich Manufaktur",
      bg: "linear-gradient(135deg, #92400E, #451A03)",
      accent: "#FBBF24",
      offsetX: -40,
      offsetY: 40,
      rotation: -10,
      opacity: 0.5,
      blur: 1,
      live: false,
    },
    {
      name: "Lisa Lust",
      company: "Lust Cosmetics",
      bg: "linear-gradient(135deg, #EC4899, #BE185D)",
      accent: "#FCE7F3",
      offsetX: -20,
      offsetY: 20,
      rotation: -5,
      opacity: 0.75,
      blur: 0,
      live: false,
    },
    {
      name: "Max Mustermann",
      company: "Mustermann Industrie",
      bg: "linear-gradient(135deg, #7C5CE8, #5232C7)",
      accent: "#FFFFFF",
      offsetX: 0,
      offsetY: 0,
      rotation: 2,
      opacity: 1,
      blur: 0,
      live: true,
    },
  ];

  return (
    <div className="relative w-full h-full flex flex-col p-8 md:p-10">
      {/* Glows */}
      <div
        aria-hidden
        className="absolute -top-40 -right-32 size-[640px] rounded-full pointer-events-none"
        style={{
          background:
            "radial-gradient(closest-side, rgba(170,140,245,0.5), rgba(170,140,245,0) 70%)",
        }}
      />
      <div
        aria-hidden
        className="absolute -bottom-12 -left-12 size-[380px] rounded-full pointer-events-none opacity-60"
        style={{
          background:
            "radial-gradient(closest-side, rgba(236,72,153,0.35), transparent 75%)",
        }}
      />

      {/* Visual area */}
      <div className="relative flex-1 min-h-[260px]">
        <div className="absolute top-2 right-0 md:right-4">
          {STACK.map((s, i) => (
            <div
              key={s.name}
              className="absolute right-0 top-0 rounded-2xl border border-white/15 overflow-hidden"
              style={{
                width: 360,
                aspectRatio: "16/10",
                transform: `translate(${s.offsetX}px, ${s.offsetY}px) rotate(${s.rotation}deg)`,
                opacity: s.opacity,
                filter: s.blur > 0 ? `blur(${s.blur}px)` : "none",
                zIndex: i,
                boxShadow: s.live
                  ? "0 30px 70px -20px rgba(0,0,0,0.65), 0 0 40px rgba(124,92,232,0.4)"
                  : "0 20px 50px -20px rgba(0,0,0,0.5)",
              }}
            >
              <VideoPreviewMock
                name={s.name}
                company={s.company}
                bg={s.bg}
                accent={s.accent}
                live={s.live}
              />
            </div>
          ))}
        </div>
      </div>

      {/* Text */}
      <div className="relative mt-6 max-w-[340px]">
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

function VideoPreviewMock({
  name,
  company,
  bg,
  accent,
  live,
}: {
  name: string;
  company: string;
  bg: string;
  accent: string;
  live: boolean;
}) {
  return (
    <div className="absolute inset-0 flex flex-col bg-[#11131F]">
      <div className="h-6 bg-white/95 flex items-center px-3 gap-1.5">
        <div className="size-1.5 rounded-full bg-red-400" />
        <div className="size-1.5 rounded-full bg-yellow-400" />
        <div className="size-1.5 rounded-full bg-green-400" />
        <div className="flex-1 ml-2 h-2 rounded-full bg-surface-soft" />
      </div>
      <div
        className="flex-1 relative p-4 flex items-center gap-3"
        style={{ background: bg }}
      >
        <div className="flex-1 min-w-0">
          <div
            className="text-[7px] font-bold tracking-[0.2em] uppercase mb-1.5"
            style={{ color: accent, opacity: 0.85 }}
          >
            Persönlich für dich
          </div>
          <div className="text-[14px] font-extrabold text-white leading-[1.05]">
            {name},
            <br />
            schau dir das an.
          </div>
          <div className="mt-2 inline-flex text-[8px] font-bold text-ink bg-white rounded px-2 py-1 shadow-sm">
            Termin sichern →
          </div>
        </div>
        <div className="shrink-0 size-14 rounded-full overflow-hidden border-2 border-white shadow-xl">
          {live ? (
            <video
              src="/demo-assets/webcam.mp4"
              muted
              autoPlay
              loop
              playsInline
              preload="metadata"
              className="w-full h-full object-cover"
            />
          ) : (
            <div
              className="w-full h-full flex items-center justify-center text-white text-[10px] font-extrabold"
              style={{
                background: `linear-gradient(135deg, ${accent}40, ${accent}90)`,
              }}
            >
              {name
                .split(" ")
                .map((n) => n[0])
                .join("")}
            </div>
          )}
        </div>
      </div>
      {/* Bottom strip with company */}
      <div className="h-6 bg-white border-t border-line flex items-center px-3 gap-2">
        <div className="size-2 rounded-sm bg-brand" />
        <span className="text-[8px] font-bold text-ink truncate">{company}</span>
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

      <div className="absolute top-6 right-4 w-[170px] flex flex-col gap-2">
        <div
          className="rounded-xl backdrop-blur-md border border-white/15 p-2.5"
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
        <div
          className="rounded-xl backdrop-blur-md border border-white/15 p-2"
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
// 4) Landingpage — 3 unterschiedliche Templates
// ---------------------------------------------------------------------------

function LandingpageBento() {
  const TEMPLATES = [
    {
      name: "Franz",
      template: "classic" as const,
    },
    {
      name: "Lisa",
      template: "bold" as const,
    },
    {
      name: "Max",
      template: "soft" as const,
    },
  ];

  return (
    <div className="relative w-full h-full flex p-8 md:p-10 gap-6">
      <div
        aria-hidden
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "radial-gradient(60% 80% at 0% 50%, rgba(243,238,255,0.6), rgba(243,238,255,0) 70%)",
        }}
      />

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

      {/* Right — 3 distinct LP designs fanned out */}
      <div className="relative flex-1 hidden md:flex items-center justify-end pr-2">
        <div className="relative w-[300px] h-[200px]">
          {TEMPLATES.map((t, i) => (
            <div
              key={t.name}
              className="absolute top-0 right-0 rounded-xl overflow-hidden"
              style={{
                width: 250,
                aspectRatio: "16/10",
                transform: `translate(${-i * 22}px, ${i * 16}px) rotate(${(i - 1) * -3}deg)`,
                zIndex: TEMPLATES.length - i,
                boxShadow: "0 18px 40px -16px rgba(15,23,42,0.4)",
                border: "1px solid rgba(15,23,42,0.08)",
              }}
            >
              <LpThumbMock name={t.name} template={t.template} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function LpThumbMock({
  name,
  template,
}: {
  name: string;
  template: "soft" | "bold" | "classic";
}) {
  const styles = {
    soft: {
      bg: "#FFFFFF",
      heroBg: "linear-gradient(135deg, #F3EEFF, #FFFFFF)",
      eyebrowColor: "#7C5CE8",
      titleColor: "#0F172A",
      ctaBg: "#7C5CE8",
      ctaColor: "#FFFFFF",
      logoColor: "#7C5CE8",
    },
    bold: {
      bg: "#0F172A",
      heroBg: "linear-gradient(135deg, #1E293B, #0F172A)",
      eyebrowColor: "#FBBF24",
      titleColor: "#FFFFFF",
      ctaBg: "#FBBF24",
      ctaColor: "#0F172A",
      logoColor: "#FBBF24",
    },
    classic: {
      bg: "#FAF5EB",
      heroBg: "linear-gradient(135deg, #F5E6D3, #FAF5EB)",
      eyebrowColor: "#92400E",
      titleColor: "#1C1917",
      ctaBg: "#1C1917",
      ctaColor: "#FAF5EB",
      logoColor: "#92400E",
    },
  }[template];

  return (
    <div className="w-full h-full flex flex-col" style={{ backgroundColor: styles.bg }}>
      {/* Browser chrome */}
      <div className="h-3.5 bg-white border-b border-line/40 flex items-center px-2 gap-1">
        <div className="size-1 rounded-full bg-red-400" />
        <div className="size-1 rounded-full bg-yellow-400" />
        <div className="size-1 rounded-full bg-green-400" />
        <div className="flex-1 ml-1.5 h-1 rounded-full bg-surface-soft" />
      </div>
      {/* Header */}
      <div
        className="h-4 flex items-center px-2 gap-1.5"
        style={{ backgroundColor: styles.bg }}
      >
        <div className="size-2 rounded" style={{ backgroundColor: styles.logoColor }} />
        <div
          className="text-[6px] font-bold tracking-wider uppercase"
          style={{ color: styles.titleColor }}
        >
          Dein Logo
        </div>
      </div>
      {/* Hero */}
      <div className="flex-1 relative" style={{ background: styles.heroBg }}>
        <div className="flex items-center h-full p-2.5 gap-2">
          <div className="flex-1 min-w-0">
            <div
              className="text-[5px] font-bold tracking-wider uppercase mb-0.5"
              style={{ color: styles.eyebrowColor }}
            >
              Persönlich für dich
            </div>
            <div
              className="text-[11px] font-extrabold leading-[1.05]"
              style={{ color: styles.titleColor }}
            >
              {name},
              <br />
              schau dir das an.
            </div>
            <div
              className="mt-1 inline-block text-[5px] font-bold rounded px-1 py-0.5"
              style={{ backgroundColor: styles.ctaBg, color: styles.ctaColor }}
            >
              Termin sichern →
            </div>
          </div>
          <div
            className="shrink-0 w-14 aspect-video rounded overflow-hidden border-2 border-white shadow"
            style={{
              background: `linear-gradient(135deg, ${styles.eyebrowColor}AA, ${styles.eyebrowColor})`,
            }}
          >
            {template === "soft" ? (
              <video
                src="/demo-assets/webcam.mp4"
                muted
                autoPlay
                loop
                playsInline
                preload="metadata"
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-white text-[8px]">
                ▶
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 5) Brief — komplett ueberarbeitet, grosser fokussierter Letter + Envelope
// ---------------------------------------------------------------------------

function BriefBento() {
  return (
    <div className="relative w-full h-full flex flex-col p-7">
      {/* Glow */}
      <div
        aria-hidden
        className="absolute -top-20 -right-16 size-80 rounded-full pointer-events-none"
        style={{
          background:
            "radial-gradient(closest-side, rgba(249,115,22,0.45), transparent 70%)",
        }}
      />
      <div
        aria-hidden
        className="absolute bottom-0 left-0 size-72 rounded-full pointer-events-none opacity-60"
        style={{
          background:
            "radial-gradient(closest-side, rgba(180,83,9,0.35), transparent 75%)",
        }}
      />

      <GlassIcon>
        <Mail className="size-5" />
      </GlassIcon>

      {/* Letter + Envelope stack — center-right floating */}
      <div className="absolute top-4 right-4 w-[200px] h-[190px]">
        {/* Envelope behind */}
        <div
          className="absolute top-12 right-0 rounded-md shadow-2xl"
          style={{
            width: 170,
            height: 110,
            transform: "rotate(-8deg)",
            background: "linear-gradient(135deg, #FED7AA, #FB923C)",
            border: "1px solid rgba(0,0,0,0.08)",
            zIndex: 1,
          }}
        >
          {/* Envelope flap */}
          <div
            className="absolute inset-x-0 top-0 h-12"
            style={{
              background:
                "linear-gradient(180deg, #FB923C 0%, #EA580C 50%, #FB923C 51%, #FED7AA 100%)",
              clipPath: "polygon(0 0, 100% 0, 50% 100%)",
            }}
          />
          {/* Stamp */}
          <div
            className="absolute top-2 right-2 size-7 rounded-sm bg-white/80 border border-amber-900/20 flex items-center justify-center text-[5px] font-bold text-amber-900"
          >
            PORTO
          </div>
        </div>

        {/* Letter in front */}
        <div
          className="absolute top-0 right-4 rounded-md bg-white shadow-2xl"
          style={{
            width: 140,
            aspectRatio: "210/297",
            transform: "rotate(6deg)",
            padding: "10px 12px",
            border: "1px solid rgba(0,0,0,0.06)",
            zIndex: 2,
          }}
        >
          {/* Letterhead band */}
          <div className="w-3 h-0.5 mb-1.5 bg-amber-700 rounded" />
          {/* Adresse */}
          <div className="text-[4px] text-ink/70 leading-[1.4]">
            Max Mustermann
            <br />
            Industriestr. 42
            <br />
            85737 Ismaning
          </div>
          {/* Anrede */}
          <div className="text-[4.5px] font-bold text-ink/85 mt-2">
            Sehr geehrter
          </div>
          {/* Lines */}
          <div className="space-y-0.5 mt-1.5">
            <div className="h-px bg-ink/12 w-full" />
            <div className="h-px bg-ink/12 w-5/6" />
            <div className="h-px bg-ink/12 w-3/4" />
            <div className="h-px bg-ink/12 w-full" />
          </div>
          {/* URL */}
          <div
            className="text-[4px] font-mono font-bold mt-1.5 px-1 py-0.5 rounded inline-block"
            style={{ backgroundColor: "#F3EEFF", color: "#5232C7" }}
          >
            deine-domain.de/max
          </div>
          {/* QR code mock */}
          <div
            className="absolute bottom-1.5 right-1.5 size-5 rounded-sm overflow-hidden"
            style={{
              background:
                "repeating-conic-gradient(#0F172A 0deg 90deg, white 90deg 180deg)",
              backgroundSize: "2.5px 2.5px",
            }}
          />
        </div>
      </div>

      <div className="mt-auto pt-12 relative">
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
// 6) A/B Testing
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
// 7) Anbindungen — echte Brand-Logos
// ---------------------------------------------------------------------------

function IntegrationsBento() {
  const LOGOS = [
    { name: "HubSpot", Logo: HubSpotLogo, top: 0, left: 10 },
    { name: "Salessuite", Logo: SalessuiteLogo, top: 16, left: 140 },
    { name: "Close", Logo: CloseLogo, top: 6, left: 240 },
    { name: "Zapier", Logo: ZapierLogo, top: 100, left: 50 },
    { name: "Make", Logo: MakeLogo, top: 110, left: 180 },
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

      {/* Right — floating Logo-Pills with REAL brand marks */}
      <div className="relative flex-1 hidden md:flex items-center justify-end pr-2">
        <div className="relative w-[330px] h-[200px]">
          {LOGOS.map(({ name, Logo, top, left }) => (
            <div
              key={name}
              className="absolute px-3 py-2 rounded-2xl bg-white border border-line shadow-[0_10px_28px_-8px_rgba(15,23,42,0.18)] flex items-center gap-2.5"
              style={{ top, left }}
            >
              <Logo className="size-6 shrink-0" />
              <span className="text-[13px] font-semibold text-ink">
                {name}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
