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
    <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/55 border border-white/70 text-ink text-xs font-medium backdrop-blur-md shadow-[0_2px_10px_-4px_rgba(80,60,150,0.25)]">
      {icon}
      {label}
    </span>
  );
}

export function HeroSection() {
  return (
    <section
      aria-label="Einleitung"
      className="relative w-full h-screen overflow-hidden bg-[#cfc2f2]"
    >
      <Image
        src="/hero-sky.webp"
        alt=""
        fill
        priority
        sizes="100vw"
        className="object-cover object-[center_35%]"
      />
      {/* Lesbarkeits-Veil: heller Schleier links (wo der Text sitzt), faded
          nach rechts transparent → Himmel + Komet bleiben voll sichtbar.
          Per Maske nach unten ausgeblendet, damit er den Bottom-Fade nicht
          aufhellt und der Übergang zur Folge-Sektion nahtlos bleibt. */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "linear-gradient(105deg, rgba(250,248,255,0.88) 0%, rgba(250,248,255,0.68) 24%, rgba(250,248,255,0.32) 50%, rgba(250,248,255,0) 72%), linear-gradient(180deg, rgba(250,248,255,0.45) 0%, rgba(250,248,255,0) 18%)",
          WebkitMaskImage:
            "linear-gradient(180deg, black 0%, black 55%, transparent 88%)",
          maskImage:
            "linear-gradient(180deg, black 0%, black 55%, transparent 88%)",
        }}
      />
      {/* Bottom-Fade: verläuft durchgehend in die Farbe der Demo-Sektion */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "linear-gradient(180deg, rgba(247,245,253,0) 55%, rgba(247,245,253,0.45) 75%, rgba(247,245,253,0.85) 88%, #f7f5fd 100%)",
        }}
      />

      {/* Hero content */}
      <div className="relative z-10 w-full h-full max-w-6xl mx-auto px-6 md:px-10 flex flex-col justify-center gap-5 pt-16">
        <div className="vc-hero-eyebrow inline-flex items-center gap-3 text-[10px] tracking-[0.22em] uppercase opacity-0">
          <span className="text-ink/80">Personalisierte Video-Akquise</span>
          <span className="hidden sm:block w-3 h-px bg-ink/25" />
          <span className="hidden sm:inline text-ink/40">VIDEOCOMET</span>
        </div>

        <h1 className="vc-hero-title font-light tracking-[-0.04em] leading-[1.04] text-ink text-[clamp(36px,4.8vw,68px)] max-w-[14ch] text-balance">
          <span className="block overflow-hidden">
            <span className="vc-hero-line block">Werde unvergesslich.</span>
          </span>
          <span className="block overflow-hidden">
            <span className="vc-hero-line vc-hero-accent-wrap block">
              <span
                className="vc-hero-accent block bg-clip-text text-transparent"
                style={{
                  backgroundImage:
                    "linear-gradient(96deg, #9573EE 0%, #7C5CE8 45%, #5E44C2 75%, #3F2D8A 100%)",
                }}
              >
                Bei jedem Kontakt.
              </span>
            </span>
          </span>
        </h1>

        <p className="vc-hero-sub max-w-[480px] text-[16px] leading-[1.6] text-ink-soft opacity-0">
          Du nimmst <strong className="font-semibold text-ink">ein einziges Video</strong>{" "}
          auf. VIDEOCOMET macht daraus{" "}
          <strong className="font-semibold text-ink">
            für jeden Lead eine persönliche Version
          </strong>
          . So bleibst du im Kopf, und neue Kunden{" "}
          <strong className="font-semibold text-ink">melden sich von selbst</strong>.
        </p>

        <div className="vc-hero-channels flex flex-wrap items-center gap-x-3 gap-y-2 opacity-0">
          <span className="text-[11px] tracking-[0.18em] uppercase text-ink/50 mr-1">
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
            href="/signup"
            className="inline-flex items-center gap-2 px-6 py-3 rounded-full bg-ink text-white text-sm font-semibold hover:bg-ink/90 transition-colors shadow-ink"
          >
            Jetzt direkt loslegen
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
            href="#features"
            className="inline-flex items-center gap-1.5 px-2 py-3 text-ink/75 text-sm font-medium hover:text-ink transition-colors"
          >
            Features entdecken
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
        className="vc-hero-hint absolute bottom-8 left-1/2 -translate-x-1/2 text-ink/40 text-[10px] tracking-[0.3em] uppercase flex flex-col items-center gap-2 opacity-0"
        aria-hidden
      >
        <span>Scroll</span>
        <span className="block w-px h-8 bg-gradient-to-b from-ink/35 to-transparent" />
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
            filter: drop-shadow(0 0 14px rgba(124,92,232,0.16)) drop-shadow(0 0 4px rgba(124,92,232,0.10));
          }
          50% {
            transform: translateY(-4px) translateZ(0);
            filter: drop-shadow(0 0 30px rgba(124,92,232,0.35)) drop-shadow(0 0 8px rgba(149,115,238,0.22));
          }
        }
        .vc-hero-eyebrow { animation: vc-hero-fade-up 0.9s cubic-bezier(0.2,0.8,0.2,1) 0.15s forwards; }
        .vc-hero-line { transform: translateY(110%); will-change: transform; }
        .vc-hero-title .vc-hero-line:nth-child(1) { animation: vc-hero-line-rise 1.15s cubic-bezier(0.16,1,0.3,1) 0.3s forwards; }
        .vc-hero-title .vc-hero-line.vc-hero-accent-wrap { animation: vc-hero-line-rise 1.15s cubic-bezier(0.16,1,0.3,1) 0.4s forwards; }
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
