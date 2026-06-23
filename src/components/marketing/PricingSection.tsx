"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowRight, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { RevealOnScroll } from "./RevealOnScroll";

type Tier = {
  name: string;
  tagline: string;
  price: string;
  priceCurrency?: string;
  priceSub: string;
  videosLine: string;
  perVideo?: string;
  features: string[];
  cta: { label: string; href: string };
  highlighted?: boolean;
};

const TIERS: ReadonlyArray<Tier> = [
  {
    name: "Standard",
    tagline: "Für den Einstieg",
    price: "224",
    priceCurrency: "€",
    priceSub: "netto / Monat",
    videosLine: "300 Videos pro Monat",
    perVideo: "≈ 0,75 € pro Video",
    features: [
      "Landingpage-Builder und ZIP-Upload",
      "Scroll-Animationen im Video",
      "A/B-Testing",
      "Slack-Push in Echtzeit",
      "Alle CRM-Anbindungen",
      "Brief-Generierung mit QR-Code",
      "Eigene Domain anbindbar",
      "E-Mail-Support",
    ],
    cta: { label: "Jetzt starten", href: "/login" },
  },
  {
    name: "Pro",
    tagline: "Für ernsthafte Akquise",
    price: "379",
    priceCurrency: "€",
    priceSub: "netto / Monat",
    videosLine: "1.000 Videos pro Monat",
    perVideo: "≈ 0,38 € pro Video",
    features: [
      "Landingpage-Builder und ZIP-Upload",
      "Scroll-Animationen im Video",
      "A/B-Testing",
      "Slack-Push in Echtzeit",
      "Alle CRM-Anbindungen",
      "Brief-Generierung mit QR-Code",
      "Eigene Domain anbindbar",
      "Prioritäts-Support",
    ],
    cta: { label: "Pro starten", href: "/login" },
    highlighted: true,
  },
  {
    name: "Enterprise",
    tagline: "Für Skalierung",
    price: "Individuell",
    priceSub: "auf Anfrage",
    videosLine: "Unbegrenzte Videos",
    features: [
      "Eigene Domain und White-Label",
      "Dedicated Account-Manager",
      "SSO und Custom-Integrationen",
      "SLA mit Premium-Support",
      "Eigenes Reporting",
      "Höhere API-Limits",
    ],
    cta: { label: "Termin vereinbaren", href: "/kontakt" },
  },
];

export function PricingSection() {
  return (
    <section
      id="pricing"
      className="relative z-[2] w-full bg-white py-24 md:py-32 overflow-hidden"
    >
      <div
        aria-hidden
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "radial-gradient(80% 50% at 50% 0%, rgba(243,238,255,0.6) 0%, rgba(255,255,255,0) 55%)",
        }}
      />

      <div className="relative max-w-6xl mx-auto px-6 md:px-10">
        {/* Header */}
        <div className="max-w-2xl mx-auto text-center mb-14 md:mb-20">
          <RevealOnScroll delay={0}>
            <div className="inline-flex items-center px-3.5 py-1.5 rounded-full bg-brand-soft text-brand-deep text-[11px] font-semibold tracking-[0.18em] uppercase mb-6">
              Preise
            </div>
          </RevealOnScroll>
          <RevealOnScroll delay={150}>
            <h2 className="font-light tracking-[-0.035em] text-ink leading-[1.05] text-[clamp(32px,4.2vw,56px)] mb-5 text-balance">
              Einfach starten.
              <br />
              <span className="font-semibold text-brand-deep">
                Mitwachsen, wenn es läuft.
              </span>
            </h2>
          </RevealOnScroll>
          <RevealOnScroll delay={300}>
            <p className="text-ink-muted text-lg leading-relaxed text-balance max-w-xl mx-auto">
              Drei Tarife, transparent. Nur 3 Monate Mindestlaufzeit
              statt 12. Wir wollen nicht binden, sondern überzeugen.
            </p>
          </RevealOnScroll>
        </div>

        {/* Tier-Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5 md:gap-4 lg:gap-6 items-stretch">
          {TIERS.map((t, i) => (
            <RevealOnScroll key={t.name} delay={400 + i * 100}>
              <TierCard tier={t} />
            </RevealOnScroll>
          ))}
        </div>

        {/* Footer-Note */}
        <RevealOnScroll delay={750}>
          <p className="text-center text-sm text-ink-muted mt-10">
            Alle Preise netto, zzgl. MwSt. Nach 3 Monaten monatlich kündbar.
          </p>
        </RevealOnScroll>
      </div>
    </section>
  );
}

function TierCard({ tier }: { tier: Tier }) {
  const { highlighted } = tier;
  return (
    <div
      className={cn(
        "relative h-full rounded-3xl flex flex-col p-7 md:p-8 transition-shadow",
        highlighted
          ? "bg-white border-2 border-brand"
          : "bg-white border border-line",
      )}
      style={
        highlighted
          ? {
              boxShadow:
                "0 24px 50px -16px rgba(124,92,232,0.35), 0 6px 18px -6px rgba(15,23,42,0.18)",
            }
          : {
              boxShadow:
                "0 4px 20px -10px rgba(15,23,42,0.12), 0 1px 4px -2px rgba(15,23,42,0.06)",
            }
      }
    >
      {/* Beliebt-Pille */}
      {highlighted ? (
        <div
          className="absolute -top-3 left-1/2 -translate-x-1/2 px-3.5 py-1 rounded-full text-[10.5px] font-bold tracking-[0.18em] uppercase text-white whitespace-nowrap shadow-md"
          style={{
            background:
              "linear-gradient(135deg, #7C5CE8 0%, #5232C7 100%)",
          }}
        >
          Beliebt
        </div>
      ) : null}

      {/* Name + Tagline */}
      <div className="mb-6">
        <div className="text-[11px] font-semibold tracking-[0.18em] uppercase text-brand-deep mb-2">
          {tier.name}
        </div>
        <p className="text-sm text-ink-muted">{tier.tagline}</p>
      </div>

      {/* Price block */}
      <div className="mb-6 pb-6 border-b border-line">
        <div className="flex items-baseline gap-1">
          <span
            className="font-light tracking-[-0.04em] leading-none text-ink"
            style={{ fontSize: "clamp(40px, 4.4vw, 56px)" }}
          >
            {tier.price}
          </span>
          {tier.priceCurrency ? (
            <span
              className="font-light tracking-[-0.04em] leading-none text-ink"
              style={{ fontSize: "clamp(24px, 2.6vw, 32px)" }}
            >
              {tier.priceCurrency}
            </span>
          ) : null}
        </div>
        <div className="text-xs text-ink-muted mt-2">{tier.priceSub}</div>
      </div>

      {/* Volumen-Headline */}
      <div className="mb-5">
        <div className="text-[15px] font-bold text-ink leading-tight">
          {tier.videosLine}
        </div>
        {tier.perVideo ? (
          <div className="text-[12.5px] text-brand-deep font-semibold mt-1">
            {tier.perVideo}
          </div>
        ) : null}
      </div>

      {/* Features */}
      <ul className="flex-1 space-y-2.5 mb-7">
        {tier.features.map((f) => (
          <li
            key={f}
            className="flex items-start gap-2.5 text-[14px] text-ink leading-snug"
          >
            <div
              className={cn(
                "size-4 shrink-0 rounded-full flex items-center justify-center mt-0.5",
                highlighted ? "bg-brand" : "bg-ink",
              )}
            >
              <Check
                className="size-2.5 text-white"
                strokeWidth={3.5}
              />
            </div>
            <span>{f}</span>
          </li>
        ))}
      </ul>

      {/* CTA */}
      <Link
        href={tier.cta.href}
        className={cn(
          "inline-flex items-center justify-center gap-1.5 rounded-full px-5 py-3 text-sm font-semibold transition-all",
          highlighted
            ? "bg-ink text-white hover:bg-ink/90 shadow-[0_8px_22px_-6px_rgba(15,23,42,0.45)]"
            : "bg-surface-soft text-ink hover:bg-line border border-line",
        )}
      >
        {tier.cta.label}
        <ArrowRight className="size-3.5" />
      </Link>

      {/* Footer: Mindestlaufzeit */}
      <div className="mt-4 text-center text-[11px] text-ink-muted">
        3 Monate Mindestlaufzeit
      </div>
    </div>
  );
}
