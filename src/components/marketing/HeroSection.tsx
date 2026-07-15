import Image from "next/image";
import Link from "next/link";
import * as React from "react";
import { AtSign, Linkedin, Mail } from "lucide-react";

function ChannelChip({
  icon,
  label,
}: {
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/[0.08] border border-white/15 text-white/90 text-xs font-medium backdrop-blur-md">
      {icon}
      {label}
    </span>
  );
}

export function HeroSection() {
  return (
    <section
      aria-label="Einleitung"
      className="relative w-full h-screen overflow-hidden bg-black"
    >
      <Image
        src="/hero.webp"
        alt=""
        fill
        priority
        sizes="100vw"
        className="object-cover object-[70%_center]"
      />
      {/* Lesbarkeits-Veil: stark dunkel auf der linken Seite (wo Text sitzt),
          faded zum rechten Rand hin transparent → das Motiv rechts bleibt
          voll sichtbar. Plus dezenter Top- und Bottom-Fade. */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "linear-gradient(105deg, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0.65) 22%, rgba(0,0,0,0.30) 48%, rgba(0,0,0,0) 72%), linear-gradient(180deg, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0) 18%, rgba(0,0,0,0) 70%, rgba(0,0,0,0.75) 100%)",
        }}
      />

      {/* Hero content */}
      <div className="relative z-10 w-full h-full max-w-6xl mx-auto px-6 md:px-10 flex flex-col justify-center gap-5 pt-16">
        <div className="vc-hero-eyebrow inline-flex items-center gap-3 text-[10px] tracking-[0.22em] uppercase opacity-0">
          <span className="text-white/95">Die geheime Strategie der Marktführer</span>
          <span className="hidden sm:block w-3 h-px bg-white/30" />
          <span className="hidden sm:inline text-white/45">VIDEOCOMET</span>
        </div>

        <h1 className="vc-hero-title font-light tracking-[-0.04em] leading-[1.04] text-white text-[clamp(36px,4.8vw,68px)] max-w-[14ch] text-balance">
          <span className="block overflow-hidden">
            <span className="vc-hero-line block">Werde unvergesslich.</span>
          </span>
          <span className="block overflow-hidden">
            <span className="vc-hero-line vc-hero-accent-wrap block">
              <span
                className="vc-hero-accent block bg-clip-text text-transparent"
                style={{
                  backgroundImage:
                    "linear-gradient(96deg, #C7B6FE 0%, #AA8CF5 35%, #7C5CE8 70%, #5232C7 100%)",
                }}
              >
                Bei jedem Kontakt.
              </span>
            </span>
          </span>
        </h1>

        <p className="vc-hero-sub max-w-[480px] text-[16px] leading-[1.6] text-white/70 opacity-0">
          Einmal ein Video aufnehmen, danach{" "}
          <strong className="font-semibold text-white">
            tausendfach personalisiert an deine Zielgruppe verschicken
          </strong>
          . Persönlich, authentisch und überzeugend. So bleibst du{" "}
          <strong className="font-semibold text-white">in Erinnerung</strong>{" "}
          und wirst von{" "}
          <strong className="font-semibold text-white">
            neuen Kunden kontaktiert
          </strong>
          .
        </p>

        <div className="vc-hero-channels flex flex-wrap items-center gap-x-3 gap-y-2 opacity-0">
          <span className="text-[11px] tracking-[0.18em] uppercase text-white/55 mr-1">
            Verschicke Videos per:
          </span>
          <ChannelChip icon={<AtSign className="size-3.5" />} label="E-Mail" />
          <ChannelChip
            icon={<Linkedin className="size-3.5" />}
            label="LinkedIn"
          />
          <ChannelChip
            icon={<Mail className="size-3.5" />}
            label="Brief"
          />
        </div>

        <div className="vc-hero-cta flex flex-wrap items-center gap-4 mt-2 opacity-0">
          <Link
            href="#demo"
            className="inline-flex items-center gap-2 px-6 py-3 rounded-full bg-white text-black text-sm font-semibold hover:bg-white/90 transition-colors"
          >
            Live-Demo ansehen
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <path d="M5 12h14M13 5l7 7-7 7" />
            </svg>
          </Link>
          <Link
            href="/login"
            className="inline-flex items-center gap-1.5 px-2 py-3 text-white/80 text-sm font-medium hover:text-white transition-colors"
          >
            Anmelden
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <path d="M9 6l6 6-6 6" />
            </svg>
          </Link>
        </div>
      </div>

      {/* Scroll hint */}
      <div
        className="vc-hero-hint absolute bottom-8 left-1/2 -translate-x-1/2 text-white/45 text-[10px] tracking-[0.3em] uppercase flex flex-col items-center gap-2 opacity-0"
        aria-hidden
      >
        <span>Scroll</span>
        <span className="block w-px h-8 bg-gradient-to-b from-white/40 to-transparent" />
      </div>

      <style>{`
        @keyframes vc-hero-fade-up {
          0%   { opacity: 0; transform: translateY(20px); }
          100% { opacity: 1; transform: translateY(0); }
        }
        @keyframes vc-hero-line-rise {
          0%   { transform: translateY(110%); }
          100% { transform: translateY(0%); }
        }
        /* Akzent driftet leicht hoch/runter + atmender Glow */
        @keyframes vc-hero-accent-drift {
          0%, 100% {
            transform: translateY(0px) translateZ(0);
            filter: drop-shadow(0 0 18px rgba(170,140,245,0.22)) drop-shadow(0 0 4px rgba(170,140,245,0.14));
          }
          50% {
            transform: translateY(-4px) translateZ(0);
            filter: drop-shadow(0 0 42px rgba(170,140,245,0.55)) drop-shadow(0 0 10px rgba(199,182,254,0.30));
          }
        }
        .vc-hero-eyebrow { animation: vc-hero-fade-up 0.9s cubic-bezier(0.2,0.8,0.2,1) 0.15s forwards; }
        .vc-hero-line { transform: translateY(110%); will-change: transform; }
        .vc-hero-title .vc-hero-line:nth-child(1) { animation: vc-hero-line-rise 1.15s cubic-bezier(0.16,1,0.3,1) 0.3s forwards; }
        .vc-hero-title > span:nth-child(2) .vc-hero-line { animation: vc-hero-line-rise 1.15s cubic-bezier(0.16,1,0.3,1) 0.4s forwards; }
        .vc-hero-accent {
          display: block;
          will-change: transform, filter;
          animation: vc-hero-accent-drift 6.5s ease-in-out 1.7s infinite;
        }
        .vc-hero-sub { animation: vc-hero-fade-up 0.95s cubic-bezier(0.2,0.8,0.2,1) 0.85s forwards; }
        .vc-hero-channels { animation: vc-hero-fade-up 0.9s cubic-bezier(0.2,0.8,0.2,1) 1.05s forwards; }
        .vc-hero-cta { animation: vc-hero-fade-up 0.95s cubic-bezier(0.2,0.8,0.2,1) 1.25s forwards; }
        .vc-hero-hint { animation: vc-hero-fade-up 0.8s cubic-bezier(0.2,0.8,0.2,1) 1.6s forwards; }
      `}</style>
    </section>
  );
}
