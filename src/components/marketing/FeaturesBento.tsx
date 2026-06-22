"use client";

import * as React from "react";
import {
  ArrowUpRight,
  Bell,
  CheckCircle2,
  Eye,
  FlaskConical,
  Globe,
  LineChart,
  Mail,
  MousePointerClick,
  PlayCircle,
  Plug,
  Sparkles,
  Video,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { RevealOnScroll } from "./RevealOnScroll";

/**
 * Features-Bento: Apple-Keynote-Style Grid mit unterschiedlich grossen
 * Cards. Jede Card hat ein eigenes Visual (Mock-UI, Animation, Illustration).
 * Layout: 12-col Grid, 4 Zeilen, 7 Cards.
 *
 *   [   Video (8x2)   ][ Push  (4x1) ]
 *                     [ Analytics (4x1) ]
 *   [Brief(4x1)][  Landingpage (8x1)  ]
 *   [ A/B (4x1)][  Anbindungen (8x1)  ]
 */
export function FeaturesBento() {
  return (
    <section
      id="features"
      className="relative z-[2] w-full bg-white py-24 md:py-32 overflow-hidden"
    >
      {/* Subtle background gradient for depth */}
      <div
        aria-hidden
        className="absolute inset-0 pointer-events-none opacity-50"
        style={{
          background:
            "radial-gradient(80% 50% at 50% 0%, rgba(243,238,255,0.6) 0%, rgba(255,255,255,0) 60%)",
        }}
      />

      <div className="relative max-w-6xl mx-auto px-6 md:px-10">
        {/* Header */}
        <div className="max-w-2xl mx-auto text-center mb-12 md:mb-16">
          <RevealOnScroll delay={0}>
            <div className="inline-flex items-center px-3.5 py-1.5 rounded-full bg-brand-soft text-brand-deep text-[11px] font-semibold tracking-[0.18em] uppercase mb-6">
              Die Features
            </div>
          </RevealOnScroll>
          <RevealOnScroll delay={150}>
            <h2 className="font-light tracking-[-0.035em] text-ink leading-[1.05] text-[clamp(32px,4.2vw,56px)] mb-5 text-balance">
              Alles drin.
              <br />
              <span className="font-semibold text-brand-deep">Nichts halb.</span>
            </h2>
          </RevealOnScroll>
          <RevealOnScroll delay={300}>
            <p className="text-ink-muted text-lg leading-relaxed text-balance max-w-xl mx-auto">
              Von der Webcam-Aufnahme bis zum CRM-Sync. Alles, was du
              brauchst, um Akquise wirklich persönlich zu machen.
            </p>
          </RevealOnScroll>
        </div>

        {/* Bento Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-12 auto-rows-[minmax(220px,_auto)] gap-3 md:gap-4">
          <RevealOnScroll delay={400} className="lg:col-span-8 lg:row-span-2">
            <BentoCard
              dark
              className="bg-gradient-to-br from-[#1a1d35] via-[#0F172A] to-black h-full"
            >
              <VideoBento />
            </BentoCard>
          </RevealOnScroll>

          <RevealOnScroll delay={520} className="lg:col-span-4 lg:row-span-1">
            <BentoCard
              dark
              className="bg-gradient-to-br from-[#059669] via-[#047857] to-[#064E3B] h-full"
            >
              <PushBento />
            </BentoCard>
          </RevealOnScroll>

          <RevealOnScroll delay={640} className="lg:col-span-4 lg:row-span-1">
            <BentoCard
              dark
              className="bg-gradient-to-br from-[#0284C7] via-[#0369A1] to-[#1E3A8A] h-full"
            >
              <AnalyticsBento />
            </BentoCard>
          </RevealOnScroll>

          <RevealOnScroll delay={760} className="lg:col-span-8 lg:row-span-1">
            <BentoCard className="bg-gradient-to-br from-[#F3EEFF] via-white to-[#E8DEFC] h-full">
              <LandingpageBento />
            </BentoCard>
          </RevealOnScroll>

          <RevealOnScroll delay={880} className="lg:col-span-4 lg:row-span-1">
            <BentoCard
              dark
              className="bg-gradient-to-br from-[#F97316] via-[#EA580C] to-[#9A3412] h-full"
            >
              <BriefBento />
            </BentoCard>
          </RevealOnScroll>

          <RevealOnScroll delay={1000} className="lg:col-span-4 lg:row-span-1">
            <BentoCard
              dark
              className="bg-gradient-to-br from-[#FBBF24] via-[#F59E0B] to-[#92400E] h-full"
            >
              <ABBento />
            </BentoCard>
          </RevealOnScroll>

          <RevealOnScroll delay={1120} className="lg:col-span-4 lg:row-span-1">
            <BentoCard className="bg-gradient-to-br from-[#FAFAFE] via-white to-[#EDE9FE] h-full">
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
        "relative overflow-hidden rounded-3xl border h-full group transition-shadow",
        dark
          ? "border-white/10 shadow-[0_24px_60px_-30px_rgba(15,23,42,0.5)] hover:shadow-[0_28px_70px_-25px_rgba(15,23,42,0.6)]"
          : "border-line shadow-[0_24px_60px_-30px_rgba(15,23,42,0.25)] hover:shadow-[0_28px_70px_-25px_rgba(15,23,42,0.32)]",
        className,
      )}
    >
      {/* Subtle inner highlight at top — apple "shine" */}
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

function CardLabel({
  children,
  dark = false,
}: {
  children: React.ReactNode;
  dark?: boolean;
}) {
  return (
    <div
      className={cn(
        "text-[10px] font-semibold tracking-[0.22em] uppercase mb-2",
        dark ? "text-white/55" : "text-brand-deep",
      )}
    >
      {children}
    </div>
  );
}

function CardTitle({
  children,
  dark = false,
  size = "md",
}: {
  children: React.ReactNode;
  dark?: boolean;
  size?: "md" | "lg";
}) {
  return (
    <h3
      className={cn(
        "font-semibold leading-[1.1] tracking-[-0.02em] text-balance",
        dark ? "text-white" : "text-ink",
        size === "lg" ? "text-3xl md:text-4xl" : "text-xl md:text-2xl",
      )}
    >
      {children}
    </h3>
  );
}

function CardSub({
  children,
  dark = false,
}: {
  children: React.ReactNode;
  dark?: boolean;
}) {
  return (
    <p
      className={cn(
        "text-sm leading-relaxed text-balance",
        dark ? "text-white/65" : "text-ink-muted",
      )}
    >
      {children}
    </p>
  );
}

// ---------------------------------------------------------------------------
// 1) Videogenerierung — large hero
// ---------------------------------------------------------------------------

function VideoBento() {
  const STACK = [
    { name: "Max Mustermann", company: "Mustermann Industrie", grad: "from-[#7C5CE8] to-[#5232C7]", rotation: -8, offset: 0 },
    { name: "Lisa Lust", company: "Lust Cosmetics", grad: "from-[#EC4899] to-[#BE185D]", rotation: -2, offset: 1 },
    { name: "Franz Friedrich", company: "Friedrich Manufaktur", grad: "from-[#F97316] to-[#C2410C]", rotation: 5, offset: 2 },
  ];
  return (
    <div className="absolute inset-0 flex flex-col">
      {/* Visual area — stacked video preview cards */}
      <div className="relative flex-1 overflow-hidden">
        {/* Glow */}
        <div
          aria-hidden
          className="absolute -top-20 right-0 size-[420px] rounded-full blur-3xl pointer-events-none"
          style={{
            background:
              "radial-gradient(circle, rgba(170,140,245,0.45), rgba(170,140,245,0) 60%)",
          }}
        />
        <div
          aria-hidden
          className="absolute bottom-0 left-0 size-[320px] rounded-full blur-3xl pointer-events-none opacity-50"
          style={{
            background:
              "radial-gradient(circle, rgba(236,72,153,0.30), transparent 60%)",
          }}
        />

        {/* Stacked video previews — Apple-style fanned-out cards */}
        <div className="absolute right-8 top-8 flex flex-col">
          {STACK.map((s, i) => (
            <div
              key={s.name}
              className="relative w-[280px] md:w-[320px] aspect-[16/10] rounded-2xl overflow-hidden border border-white/10 shadow-2xl"
              style={{
                transform: `translateY(${i * 24}px) translateX(${-i * 16}px) rotate(${s.rotation}deg)`,
                zIndex: STACK.length - i,
                backgroundColor: "#11131F",
              }}
            >
              <VideoPreviewMock {...s} />
            </div>
          ))}
        </div>
      </div>

      {/* Foreground text — bottom-left */}
      <div className="relative p-8 md:p-10 pt-0 max-w-md">
        <CardLabel dark>Videogenerierung</CardLabel>
        <CardTitle dark size="lg">
          743 Videos.{" "}
          <span className="text-brand-light">In 2 Minuten.</span>
        </CardTitle>
        <CardSub dark>
          Eine Aufnahme reicht. VIDEOCOMET rendert jedes Video individuell
          mit Name, Firma und Webseite des Empfängers.
        </CardSub>
      </div>
    </div>
  );
}

function VideoPreviewMock({
  name,
  company,
  grad,
}: {
  name: string;
  company: string;
  grad: string;
}) {
  return (
    <div className="absolute inset-0 flex flex-col">
      {/* Hero band with gradient */}
      <div
        className={cn("h-2/3 relative bg-gradient-to-br", grad)}
      >
        <div className="absolute top-2.5 left-3 right-3 flex items-center gap-1">
          <div className="size-1.5 rounded-full bg-white/40" />
          <div className="size-1.5 rounded-full bg-white/40" />
          <div className="size-1.5 rounded-full bg-white/40" />
          <div className="flex-1 ml-1.5 h-2.5 rounded bg-white/15" />
        </div>
        <div className="absolute bottom-3 left-3 right-3 text-white">
          <div className="text-[8px] font-bold tracking-widest uppercase opacity-80">
            Persönlich für dich
          </div>
          <div className="text-sm font-extrabold leading-tight mt-0.5">
            {name},<br />
            schau dir das an.
          </div>
        </div>
        {/* Webcam PiP */}
        <div className="absolute bottom-2 right-3 size-9 rounded-full border-2 border-white shadow-lg overflow-hidden">
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
      {/* Footer */}
      <div className="flex-1 bg-white p-2.5 flex items-center justify-between">
        <div className="min-w-0">
          <div className="text-[10px] font-bold text-ink truncate">
            {company}
          </div>
          <div className="text-[8px] text-ink-muted font-mono truncate">
            deine-domain.de/{name.split(" ")[0].toLowerCase()}
          </div>
        </div>
        <PlayCircle className="size-4 text-brand-deep shrink-0" />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 2) Push-Notifications
// ---------------------------------------------------------------------------

function PushBento() {
  const NOTIFS = [
    { icon: <Eye className="size-3" />, who: "Max", what: "öffnete deine Seite" },
    { icon: <PlayCircle className="size-3" />, who: "Lisa", what: "schaut gerade" },
    { icon: <MousePointerClick className="size-3" />, who: "Franz", what: "klickte Termin" },
  ];
  return (
    <div className="absolute inset-0 flex flex-col p-7 md:p-8">
      {/* Decorative bell with glow */}
      <div className="relative shrink-0">
        <div className="absolute inset-0 size-12 rounded-2xl bg-white/15 blur-xl" />
        <div className="relative size-12 rounded-2xl bg-white/15 backdrop-blur-md flex items-center justify-center text-white border border-white/20">
          <Bell className="size-5" />
        </div>
      </div>

      <div className="mt-auto">
        <CardLabel dark>Push-Notifications</CardLabel>
        <CardTitle dark>Sofort wissen, wer reagiert.</CardTitle>
        <CardSub dark>
          Jede Öffnung, jedes Klick, in Echtzeit auf deinem Bildschirm.
        </CardSub>
      </div>

      {/* Stacked notif previews top-right */}
      <div className="absolute top-6 right-6 flex flex-col gap-1.5 w-[170px]">
        {NOTIFS.map((n, i) => (
          <div
            key={i}
            className="rounded-xl bg-black/40 backdrop-blur-md border border-white/15 p-2 flex items-center gap-2"
            style={{
              transform: `translateX(${i * 8}px) translateY(${i * -2}px)`,
              opacity: 1 - i * 0.18,
            }}
          >
            <div
              className="size-6 shrink-0 rounded-md bg-white/20 flex items-center justify-center text-white"
            >
              {n.icon}
            </div>
            <div className="text-[9px] leading-tight text-white">
              <span className="font-bold">{n.who}</span>{" "}
              <span className="opacity-70">{n.what}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 3) Analytics
// ---------------------------------------------------------------------------

function AnalyticsBento() {
  return (
    <div className="absolute inset-0 flex flex-col p-7 md:p-8">
      <div className="relative shrink-0">
        <div className="absolute inset-0 size-12 rounded-2xl bg-white/15 blur-xl" />
        <div className="relative size-12 rounded-2xl bg-white/15 backdrop-blur-md flex items-center justify-center text-white border border-white/20">
          <LineChart className="size-5" />
        </div>
      </div>

      {/* Chart + KPIs */}
      <div className="absolute top-7 right-6 w-[170px]">
        {/* Mini KPI */}
        <div className="rounded-xl bg-white/10 backdrop-blur-md border border-white/15 p-2.5 mb-2">
          <div className="text-[8px] font-bold uppercase tracking-wider text-white/65">
            Watch-Time ø
          </div>
          <div className="text-lg font-extrabold text-white">83 %</div>
          <div className="text-[8px] text-emerald-200">+12 % vs. letzte Wo.</div>
        </div>
        {/* Mini chart */}
        <div className="rounded-xl bg-white/10 backdrop-blur-md border border-white/15 p-2.5">
          <svg viewBox="0 0 100 30" className="w-full h-8">
            <defs>
              <linearGradient id="vc-bento-chart" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="rgba(255,255,255,0.6)" />
                <stop offset="100%" stopColor="rgba(255,255,255,0)" />
              </linearGradient>
            </defs>
            <path
              d="M0,24 L15,22 L30,18 L45,16 L60,10 L75,12 L90,5 L100,3 L100,30 L0,30 Z"
              fill="url(#vc-bento-chart)"
            />
            <path
              d="M0,24 L15,22 L30,18 L45,16 L60,10 L75,12 L90,5 L100,3"
              fill="none"
              stroke="white"
              strokeWidth="1.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
      </div>

      <div className="mt-auto">
        <CardLabel dark>Analytics</CardLabel>
        <CardTitle dark>Zahlen, die wirklich zählen.</CardTitle>
        <CardSub dark>
          Öffnungen, Watch-Time und CTAs auf einen Blick.
        </CardSub>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 4) Landingpage-Generierung (light)
// ---------------------------------------------------------------------------

function LandingpageBento() {
  const LEADS = ["Max", "Lisa", "Franz", "Sofia"];
  return (
    <div className="absolute inset-0 flex">
      {/* Left text */}
      <div className="relative flex-1 flex flex-col justify-end p-8 md:p-10 max-w-sm">
        <CardLabel>Landingpage-Generierung</CardLabel>
        <CardTitle size="lg">
          Eigene Landingpage{" "}
          <span className="text-brand-deep">für jeden Lead</span>.
        </CardTitle>
        <CardSub>
          Automatisch personalisiert. Vorname, Firma, Branche und ihr
          Video, sauber im Hero platziert.
        </CardSub>
      </div>

      {/* Right mockup — stacked LPs */}
      <div className="hidden md:block relative w-[55%] overflow-hidden">
        <div className="absolute inset-0 flex items-center justify-center">
          {LEADS.map((name, i) => (
            <div
              key={name}
              className="absolute rounded-2xl bg-white shadow-xl border border-line overflow-hidden"
              style={{
                width: "260px",
                aspectRatio: "16/10",
                transform: `translate(${(i - 1.5) * 28}px, ${(i - 1.5) * 14}px) rotate(${(i - 1.5) * 3}deg)`,
                zIndex: i,
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
    <div className="w-full h-full bg-white flex flex-col">
      <div className="h-3 bg-surface-soft border-b border-line flex items-center px-2 gap-1">
        <div className="size-1 rounded-full bg-red-400" />
        <div className="size-1 rounded-full bg-yellow-400" />
        <div className="size-1 rounded-full bg-green-400" />
        <div className="flex-1 ml-1 h-1 rounded bg-line" />
      </div>
      <div className="h-4 bg-white border-b border-line flex items-center px-2 gap-1">
        <div className="size-2 rounded bg-brand" />
        <div className="text-[6px] font-bold text-ink">DEIN LOGO</div>
      </div>
      <div className="flex-1 flex items-center px-3 gap-2">
        <div className="flex-1 min-w-0">
          <div className="text-[5px] font-bold tracking-wider uppercase text-brand-deep mb-0.5">
            Persönlich für dich
          </div>
          <div className="text-[10px] font-extrabold text-ink leading-tight">
            {name},
            <br />
            schau dir das an.
          </div>
          <div className="text-[6px] text-ink-muted mt-1 line-clamp-1">
            Drei Punkte zu deiner Firma.
          </div>
          <div
            className="mt-1 inline-block text-[5px] font-bold text-white rounded px-1 py-0.5"
            style={{ backgroundColor: "#7C5CE8" }}
          >
            Termin sichern →
          </div>
        </div>
        <div className="shrink-0 w-12 h-9 rounded bg-gradient-to-br from-brand to-brand-deep border-2 border-white shadow flex items-center justify-center text-white text-[8px]">
          ▶
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
    <div className="absolute inset-0 flex flex-col p-7 md:p-8">
      {/* Icon */}
      <div className="relative shrink-0">
        <div className="absolute inset-0 size-12 rounded-2xl bg-white/15 blur-xl" />
        <div className="relative size-12 rounded-2xl bg-white/15 backdrop-blur-md flex items-center justify-center text-white border border-white/20">
          <Mail className="size-5" />
        </div>
      </div>

      {/* Letter peek top-right */}
      <div className="absolute top-6 right-2">
        <div
          className="bg-white rounded-md shadow-xl border border-black/5 p-1.5"
          style={{
            width: "92px",
            aspectRatio: "210/297",
            transform: "rotate(8deg)",
          }}
        >
          <div className="w-1.5 h-0.5 bg-ink/40 mb-1" />
          <div className="w-full h-px bg-ink/15 mb-1.5" />
          <div className="text-[4px] text-ink/80 leading-tight">
            Max Mustermann
          </div>
          <div className="text-[3.5px] text-ink/50 leading-tight mt-0.5">
            Industriestr. 42
            <br />
            85737 Ismaning
          </div>
          <div className="text-[4px] font-bold text-ink/80 mt-2">
            Sehr geehrter
          </div>
          <div className="space-y-0.5 mt-1">
            <div className="h-px bg-ink/12 w-full" />
            <div className="h-px bg-ink/12 w-5/6" />
            <div className="h-px bg-ink/12 w-3/4" />
          </div>
          <div className="text-[3.5px] text-brand-deep font-mono mt-1">
            deine-domain.de/max
          </div>
          <div className="absolute bottom-1.5 right-1.5 size-3 bg-ink"
            style={{ background: "repeating-conic-gradient(#0F172A 0deg 90deg, white 90deg 180deg)" }}
          />
        </div>
      </div>

      <div className="mt-auto">
        <CardLabel dark>Briefgenerierung</CardLabel>
        <CardTitle dark>PDF-Brief pro Lead.</CardTitle>
        <CardSub dark>
          Mit echtem QR-Code zur persönlichen Landingpage. DIN-5008.
        </CardSub>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 6) A/B Testing
// ---------------------------------------------------------------------------

function ABBento() {
  return (
    <div className="absolute inset-0 flex flex-col p-7 md:p-8">
      <div className="relative shrink-0">
        <div className="absolute inset-0 size-12 rounded-2xl bg-white/15 blur-xl" />
        <div className="relative size-12 rounded-2xl bg-white/20 backdrop-blur-md flex items-center justify-center text-amber-900 border border-white/30">
          <FlaskConical className="size-5" />
        </div>
      </div>

      {/* Split comparison top-right */}
      <div className="absolute top-7 right-6 w-[150px] flex gap-1.5">
        {[
          { label: "A", v: "12 %", win: false },
          { label: "B", v: "18 %", win: true },
        ].map((v) => (
          <div
            key={v.label}
            className={cn(
              "flex-1 rounded-lg p-2 border",
              v.win
                ? "bg-white border-white"
                : "bg-white/20 border-white/30",
            )}
          >
            <div className="flex items-center justify-between mb-1">
              <span
                className={cn(
                  "size-4 rounded-full flex items-center justify-center text-[8px] font-extrabold",
                  v.win ? "bg-amber-900 text-white" : "bg-white/40 text-amber-900",
                )}
              >
                {v.label}
              </span>
              {v.win ? <CheckCircle2 className="size-3 text-amber-900" /> : null}
            </div>
            <div
              className={cn(
                "text-base font-extrabold",
                v.win ? "text-amber-900" : "text-amber-900/60",
              )}
            >
              {v.v}
            </div>
            <div className="text-[7px] text-amber-900/60">Conversion</div>
          </div>
        ))}
      </div>

      <div className="mt-auto">
        <CardLabel>A/B-Testing</CardLabel>
        <CardTitle>Versionen gegeneinander testen.</CardTitle>
        <CardSub>
          Templates, Headlines und CTAs vergleichen. Was wirkt, wirkt.
        </CardSub>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 7) Anbindungen
// ---------------------------------------------------------------------------

function IntegrationsBento() {
  const LOGOS = ["HubSpot", "Salessuite", "Close", "Zapier", "Make"];
  return (
    <div className="absolute inset-0 flex flex-col p-7 md:p-8">
      <div className="relative shrink-0">
        <div className="absolute inset-0 size-12 rounded-2xl bg-brand-soft blur-xl" />
        <div className="relative size-12 rounded-2xl bg-brand-soft backdrop-blur-md flex items-center justify-center text-brand-deep border border-brand/20">
          <Plug className="size-5" />
        </div>
      </div>

      {/* Floating logo chips */}
      <div className="absolute top-7 right-6 flex flex-wrap gap-1.5 w-[170px] justify-end">
        {LOGOS.map((l, i) => (
          <div
            key={l}
            className="px-2 py-1 rounded-full bg-white border border-line shadow-sm text-[10px] font-semibold text-ink"
            style={{
              transform: `translateY(${(i % 2) * 6}px)`,
            }}
          >
            {l}
          </div>
        ))}
      </div>

      <div className="mt-auto">
        <CardLabel>Anbindungen</CardLabel>
        <CardTitle>In dein Setup eingebunden.</CardTitle>
        <CardSub>
          HubSpot, Salessuite, Close, Zapier oder Make. Webhook-Events
          pro Aktion.
        </CardSub>
      </div>
    </div>
  );
}

// keep unused imports happy (Sparkles + ArrowUpRight + Globe + Video reserved
// for future variants without warning)
void Sparkles;
void ArrowUpRight;
void Globe;
void Video;
