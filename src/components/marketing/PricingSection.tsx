"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowRight, Check, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { RevealOnScroll } from "./RevealOnScroll";

type Tier = {
  name: string;
  tagline: string;
  price: string;
  priceSub: string;
  features: string[];
  cta: { label: string; href: string };
  highlighted?: boolean;
};

const TIERS: ReadonlyArray<Tier> = [
  {
    name: "Starter",
    tagline: "Für den Einstieg",
    price: "49 €",
    priceSub: "/ Monat",
    features: [
      "50 personalisierte Videos / Monat",
      "1 Landingpage-Template",
      "Brief-Generierung als PDF",
      "Watch-Time und Klick-Tracking",
      "E-Mail-Support",
    ],
    cta: { label: "Jetzt starten", href: "/login" },
  },
  {
    name: "Pro",
    tagline: "Für ernsthafte Akquise",
    price: "149 €",
    priceSub: "/ Monat",
    features: [
      "500 personalisierte Videos / Monat",
      "Alle Landingpage-Templates",
      "Eigene Webseite als ZIP hochladen",
      "Scroll-Animationen im Video",
      "A/B-Testing für Videos und Briefe",
      "Slack-Push in Echtzeit",
      "Alle CRM-Anbindungen",
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
    features: [
      "Unbegrenzte Videos",
      "Eigene Domain und White-Label",
      "Dedicated Account-Manager",
      "SSO und Custom-Integrationen",
      "SLA mit Premium-Support",
      "Eigenes Reporting",
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
              Drei Tarife, transparent. Keine versteckten Kosten,
              jederzeit kündbar.
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
            Alle Preise zzgl. MwSt. Monatlich kündbar.
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
      {/* Empfohlen Badge */}
      {highlighted ? (
        <div
          className="absolute -top-3 left-1/2 -translate-x-1/2 inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10.5px] font-bold tracking-wider uppercase text-white whitespace-nowrap shadow-md"
          style={{
            background:
              "linear-gradient(135deg, #7C5CE8 0%, #5232C7 100%)",
          }}
        >
          <Sparkles className="size-3" />
          Empfohlen
        </div>
      ) : null}

      {/* Name + Tagline */}
      <div className="mb-6">
        <div className="text-[11px] font-semibold tracking-[0.18em] uppercase text-brand-deep mb-2">
          {tier.name}
        </div>
        <p className="text-sm text-ink-muted">{tier.tagline}</p>
      </div>

      {/* Price */}
      <div className="mb-7 pb-7 border-b border-line">
        <div className="flex items-baseline gap-1.5">
          <span
            className="font-light tracking-[-0.04em] leading-none text-ink"
            style={{ fontSize: "clamp(40px, 4.4vw, 56px)" }}
          >
            {tier.price}
          </span>
          <span className="text-sm text-ink-muted">{tier.priceSub}</span>
        </div>
      </div>

      {/* Features */}
      <ul className="flex-1 space-y-3 mb-8">
        {tier.features.map((f) => (
          <li key={f} className="flex items-start gap-2.5 text-[14.5px] text-ink leading-snug">
            <div
              className={cn(
                "size-5 shrink-0 rounded-full flex items-center justify-center mt-0.5",
                highlighted ? "bg-brand-soft" : "bg-surface-soft",
              )}
            >
              <Check
                className={cn(
                  "size-3",
                  highlighted ? "text-brand-deep" : "text-ink-muted",
                )}
                strokeWidth={3}
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
    </div>
  );
}
