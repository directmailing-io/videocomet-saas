"use client";

import Link from "next/link";
import * as React from "react";
import { AtSign, Linkedin, Mail } from "lucide-react";

const FRAME_COUNT = 97;
const FRAME_BASE = "/hero-frames/frame_";
const FRAME_PAD = 3;

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

/**
 * Scroll-Pinned Video-Frame-Scrubber für die Marketing-Startseite.
 * 97 WebP-Frames (24fps, 4s), Canvas-driven, vanilla scroll-rAF (kein GSAP).
 * Apple-Style: Sticky-Hero mit 320vh-Hülle, Content fadet bei 60–82 % aus,
 * Background-Crossfade zu Schwarz bei 78–100 %.
 */
export function HeroScrollVideo() {
  const heroRef = React.useRef<HTMLDivElement>(null);
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const fadeRef = React.useRef<HTMLDivElement>(null);
  const contentRef = React.useRef<HTMLDivElement>(null);
  const hintRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const canvas = canvasRef.current;
    const hero = heroRef.current;
    if (!canvas || !hero) return;

    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const frames: HTMLImageElement[] = new Array(FRAME_COUNT);
    let loadedCount = 0;

    function sizeCanvas() {
      if (!canvas) return;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }

    function drawFrame(idx: number) {
      const img = frames[Math.max(0, Math.min(FRAME_COUNT - 1, idx))];
      if (!img || !img.complete || img.naturalWidth === 0) return;
      if (!canvas || !ctx) return;
      const cw = canvas.width;
      const ch = canvas.height;
      const iw = img.naturalWidth;
      const ih = img.naturalHeight;
      const scale = Math.max(cw / iw, ch / ih);
      const dw = iw * scale;
      const dh = ih * scale;
      const dx = (cw - dw) / 2;
      const dy = (ch - dh) / 2;
      ctx.drawImage(img, dx, dy, dw, dh);
    }

    // Preload all frames
    for (let i = 0; i < FRAME_COUNT; i++) {
      const img = new window.Image();
      const n = String(i + 1).padStart(FRAME_PAD, "0");
      img.src = `${FRAME_BASE}${n}.webp`;
      img.onload = () => {
        loadedCount++;
        if (loadedCount === 1) {
          sizeCanvas();
          drawFrame(0);
        }
      };
      frames[i] = img;
    }

    let rafId: number | null = null;
    let lastProgress = -1;

    function update() {
      if (!hero) return;
      const rect = hero.getBoundingClientRect();
      const total = rect.height - window.innerHeight;
      const scrolled = -rect.top;
      const progress = total > 0 ? Math.max(0, Math.min(1, scrolled / total)) : 0;

      if (Math.abs(progress - lastProgress) < 0.0005) return;
      lastProgress = progress;

      const idx = Math.round(progress * (FRAME_COUNT - 1));
      drawFrame(idx);

      // Background-Fade: voll schwarz am Start (0–6 %) UND am Ende (78–100 %).
      // Dazwischen ist das Video sichtbar, der Inhalt liegt darueber.
      if (fadeRef.current) {
        const startFade = progress < 0.06 ? 1 - progress / 0.06 : 0;
        const endFade =
          progress < 0.78 ? 0 : Math.min(1, (progress - 0.78) / 0.22);
        const fade = Math.max(startFade, endFade);
        fadeRef.current.style.opacity = fade.toFixed(3);
      }
      // Content fades earlier (60–82 %)
      if (contentRef.current) {
        const cFade =
          progress < 0.6 ? 0 : Math.min(1, (progress - 0.6) / 0.22);
        contentRef.current.style.opacity = (1 - cFade).toFixed(3);
      }
      // Scroll-hint vanishes very early
      if (hintRef.current) {
        const hFade = progress < 0.05 ? 0 : Math.min(1, (progress - 0.05) / 0.1);
        hintRef.current.style.opacity = (1 - hFade).toFixed(3);
      }
    }

    function onScroll() {
      if (rafId !== null) return;
      rafId = window.requestAnimationFrame(() => {
        rafId = null;
        update();
      });
    }

    function onResize() {
      sizeCanvas();
      lastProgress = -1;
      update();
    }

    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onResize);
    sizeCanvas();
    update();

    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onResize);
      if (rafId !== null) window.cancelAnimationFrame(rafId);
    };
  }, []);

  return (
    <section
      ref={heroRef}
      aria-label="Einleitung"
      className="relative w-full bg-black"
      style={{ height: "320vh" }}
    >
      <div className="sticky top-0 w-full h-screen overflow-hidden">
        <canvas
          ref={canvasRef}
          className="absolute inset-0 w-full h-full block"
          aria-hidden
        />
        {/* Vignette + top/bottom legibility gradient (static) */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background:
              "radial-gradient(120% 80% at 50% 50%, transparent 0%, rgba(0,0,0,0.40) 65%, rgba(0,0,0,0.88) 100%), linear-gradient(180deg, rgba(0,0,0,0.65) 0%, rgba(0,0,0,0) 22%, rgba(0,0,0,0) 60%, rgba(0,0,0,0.88) 100%)",
          }}
        />
        {/* Solid Black-Overlay (Scroll-getrieben): am Start opaque, fadet bis
            6 % aus, am Ende ab 78 % wieder rein. Initialer Render = schwarz. */}
        <div
          ref={fadeRef}
          className="absolute inset-0 bg-black pointer-events-none"
          style={{ opacity: 1, willChange: "opacity" }}
          aria-hidden
        />

        {/* Hero content */}
        <div
          ref={contentRef}
          className="relative z-10 w-full h-full max-w-6xl mx-auto px-6 md:px-10 grid grid-rows-[1fr_auto_auto_auto_auto_auto] gap-5 content-end pb-[clamp(72px,9vh,128px)]"
        >
          <div />

          <div className="vc-hero-eyebrow inline-flex items-center gap-3 text-[10px] tracking-[0.22em] uppercase opacity-0">
            <span className="text-white/95">Die geheime Strategie der Marktführer</span>
            <span className="block w-3 h-px bg-white/30" />
            <span className="text-white/45">VIDEOCOMET</span>
          </div>

          <h1 className="vc-hero-title font-light tracking-[-0.025em] leading-[1.04] text-white text-[clamp(40px,6.4vw,88px)] max-w-[22ch] text-balance">
            <span className="block overflow-hidden">
              <span className="vc-hero-line block">Werde unvergesslich.</span>
            </span>
            <span className="block overflow-hidden">
              <span
                className="vc-hero-line vc-hero-accent block bg-clip-text text-transparent"
                style={{
                  backgroundImage:
                    "linear-gradient(96deg, #C7B6FE 0%, #AA8CF5 35%, #7C5CE8 70%, #5232C7 100%)",
                }}
              >
                Bei jedem Kontakt.
              </span>
            </span>
          </h1>

          <p className="vc-hero-sub max-w-2xl text-[17px] leading-[1.6] text-white/75 opacity-0">
            Einmal ein Video aufnehmen, danach tausendfach personalisiert an
            deine Zielgruppe verschicken. Persönlich, authentisch und
            überzeugend. So bleibst du in Erinnerung und wirst von neuen
            Kunden kontaktiert.
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
          ref={hintRef}
          className="vc-hero-hint absolute bottom-8 left-1/2 -translate-x-1/2 text-white/45 text-[10px] tracking-[0.3em] uppercase flex flex-col items-center gap-2 opacity-0"
          aria-hidden
        >
          <span>Scroll</span>
          <span className="block w-px h-8 bg-gradient-to-b from-white/40 to-transparent" />
        </div>
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
        .vc-hero-eyebrow { animation: vc-hero-fade-up 0.9s cubic-bezier(0.2,0.8,0.2,1) 0.15s forwards; }
        .vc-hero-line { transform: translateY(110%); will-change: transform; }
        .vc-hero-title .vc-hero-line:nth-child(1) { animation: vc-hero-line-rise 1.15s cubic-bezier(0.16,1,0.3,1) 0.3s forwards; }
        .vc-hero-title > span:nth-child(2) .vc-hero-line { animation: vc-hero-line-rise 1.15s cubic-bezier(0.16,1,0.3,1) 0.4s forwards; }
        .vc-hero-sub { animation: vc-hero-fade-up 0.95s cubic-bezier(0.2,0.8,0.2,1) 0.85s forwards; }
        .vc-hero-channels { animation: vc-hero-fade-up 0.9s cubic-bezier(0.2,0.8,0.2,1) 1.05s forwards; }
        .vc-hero-cta { animation: vc-hero-fade-up 0.95s cubic-bezier(0.2,0.8,0.2,1) 1.25s forwards; }
        .vc-hero-hint { animation: vc-hero-fade-up 0.8s cubic-bezier(0.2,0.8,0.2,1) 1.6s forwards; }
      `}</style>
    </section>
  );
}
