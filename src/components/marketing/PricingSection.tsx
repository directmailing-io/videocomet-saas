"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowRight, Check, Plus } from "lucide-react";
import { RevealOnScroll } from "./RevealOnScroll";

const NUTZEN: ReadonlyArray<{ title: string; body: string }> = [
  {
    title: "Du überzeugst neue Kunden mit einem persönlichen Video.",
    body: "Dein Gesicht, deine Stimme, deine Botschaft. Direkt bei dem, der gerade zählt.",
  },
  {
    title: "Du bleibst bei deiner Zielgruppe besser in Erinnerung.",
    body: "Was persönlich war, vergisst niemand schnell. Auch dann nicht, wenn die Entscheidung erst Wochen später fällt.",
  },
  {
    title: "Du erhältst proaktiv Anfragen von überzeugten Kunden.",
    body: "Wer dich einmal gesehen hat, meldet sich von selbst, sobald der Moment kommt.",
  },
];

const FEATURES: ReadonlyArray<string> = [
  "Du kannst beliebig viele Aufnahmen ins System laden.",
  "Du nutzt unseren integrierten Landingpage-Builder.",
  "Du kannst deine eigene Webseite als ZIP hochladen.",
  "Du kannst eine eigene Domain anbinden, auch mit Subdomains.",
  "Du bekommst SSL-Zertifikate automatisch erneuert.",
  "Du baust Scroll-Animationen direkt ins Video ein.",
  "Du zeigst Webseiten, Google-Docs oder Karriere-Seiten live im Video.",
  "Du generierst persönliche Briefe mit QR-Code zum Video.",
  "Du wählst zwischen DIN Lang und DIN C4 als Briefformat.",
  "Du lädst Druckdaten als PDF direkt herunter.",
  "Du trackst Watch-Time, Klicks und Conversions live.",
  "Du bekommst Slack-Push für jede Lead-Aktivität in Echtzeit.",
  "Du bindest HubSpot, Salessuite, Close, Zapier, Make oder n8n an.",
  "Du setzt eigene Webhooks für deine Workflows auf.",
  "Du fährst A/B-Tests mit Videos und Briefen gegeneinander.",
  "Du importierst und exportierst Leadlisten als CSV.",
  "Du bekommst alle neuen Features automatisch dazu.",
  "Du erhältst E-Mail-Support innerhalb von 24 Stunden.",
];

const BASE_FEE = 40;
const PER_VIDEO = 1;

const EXAMPLES: ReadonlyArray<{ count: number; label: string }> = [
  { count: 0, label: "0 Videos" },
  { count: 250, label: "250 Videos" },
  { count: 1000, label: "1.000 Videos" },
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

      <div className="relative max-w-5xl mx-auto px-6 md:px-10">
        {/* Header */}
        <div className="max-w-2xl mx-auto text-center mb-14 md:mb-20">
          <RevealOnScroll delay={0}>
            <div className="inline-flex items-center px-3.5 py-1.5 rounded-full bg-brand-soft text-brand-deep text-[11px] font-semibold tracking-[0.18em] uppercase mb-6">
              Preise
            </div>
          </RevealOnScroll>
          <RevealOnScroll delay={150}>
            <h2 className="font-light tracking-[-0.035em] text-ink leading-[1.05] text-[clamp(32px,4.2vw,56px)] mb-5 text-balance">
              Zahl nur,
              <br />
              <span className="font-semibold text-brand-deep">
                was du wirklich brauchst.
              </span>
            </h2>
          </RevealOnScroll>
          <RevealOnScroll delay={300}>
            <p className="text-ink-muted text-lg leading-relaxed text-balance max-w-xl mx-auto">
              40 € Grundgebühr im Monat. 1 € pro Video, das du
              versendest. Egal ob mit Brief, mit Landingpage oder
              ohne. Mehr nicht.
            </p>
          </RevealOnScroll>
        </div>

        {/* Big Pricing Card */}
        <RevealOnScroll delay={400}>
          <div
            className="relative rounded-3xl bg-white border-2 border-brand p-8 md:p-12"
            style={{
              boxShadow:
                "0 30px 60px -20px rgba(124,92,232,0.4), 0 8px 22px -8px rgba(15,23,42,0.18)",
            }}
          >
            {/* Preis-Formel: Grundtarif + Per-Versand */}
            <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_1fr] gap-6 md:gap-8 items-center pb-8 md:pb-10 border-b border-line">
              {/* Grundtarif */}
              <div className="text-center md:text-right">
                <div className="text-[11px] font-semibold tracking-[0.18em] uppercase text-ink-muted mb-3">
                  Grundtarif
                </div>
                <div className="flex items-baseline gap-1 justify-center md:justify-end">
                  <span
                    className="font-light tracking-[-0.04em] leading-none text-ink"
                    style={{ fontSize: "clamp(52px, 6.5vw, 88px)" }}
                  >
                    40
                  </span>
                  <span
                    className="font-light tracking-[-0.04em] leading-none text-ink"
                    style={{ fontSize: "clamp(28px, 3.4vw, 44px)" }}
                  >
                    €
                  </span>
                </div>
                <div className="text-sm text-ink-muted mt-2">
                  netto / Monat
                </div>
              </div>

              {/* Plus-Trenner */}
              <div className="hidden md:flex items-center justify-center">
                <div
                  className="size-12 rounded-full bg-brand-soft flex items-center justify-center"
                  style={{
                    boxShadow:
                      "0 6px 16px -4px rgba(124,92,232,0.35)",
                  }}
                >
                  <Plus
                    className="size-5 text-brand-deep"
                    strokeWidth={2.5}
                  />
                </div>
              </div>
              <div className="md:hidden flex items-center justify-center">
                <Plus
                  className="size-6 text-brand-deep"
                  strokeWidth={2.5}
                />
              </div>

              {/* Pro Video */}
              <div className="text-center md:text-left">
                <div className="text-[11px] font-semibold tracking-[0.18em] uppercase text-ink-muted mb-3">
                  Pro Video
                </div>
                <div className="flex items-baseline gap-1 justify-center md:justify-start">
                  <span
                    className="font-light tracking-[-0.04em] leading-none text-ink"
                    style={{ fontSize: "clamp(52px, 6.5vw, 88px)" }}
                  >
                    1
                  </span>
                  <span
                    className="font-light tracking-[-0.04em] leading-none text-ink"
                    style={{ fontSize: "clamp(28px, 3.4vw, 44px)" }}
                  >
                    €
                  </span>
                </div>
                <div className="text-sm text-ink-muted mt-2">
                  egal ob mit Brief oder ohne
                </div>
              </div>
            </div>

            {/* Beispiele */}
            <div className="py-8 md:py-10 border-b border-line">
              <div className="text-[11px] font-semibold tracking-[0.18em] uppercase text-ink-muted text-center mb-5">
                Was du im Monat zahlst
              </div>
              <div className="grid grid-cols-3 gap-2 md:gap-4 max-w-xl mx-auto">
                {EXAMPLES.map((ex) => (
                  <div
                    key={ex.count}
                    className="text-center rounded-xl bg-surface-soft border border-line/60 px-2 py-3"
                  >
                    <div className="text-[11px] text-ink-muted mb-1">
                      {ex.label}
                    </div>
                    <div className="text-lg md:text-xl font-bold text-ink tabular-nums">
                      {(BASE_FEE + ex.count * PER_VIDEO).toLocaleString(
                        "de-DE",
                      )} €
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* NUTZEN */}
            <div className="pt-8 md:pt-10">
              <div className="text-[11px] font-semibold tracking-[0.18em] uppercase text-ink-muted text-center mb-6">
                Was du davon hast
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-5 md:gap-6">
                {NUTZEN.map((n) => (
                  <div key={n.title} className="flex items-start gap-3.5">
                    <div className="size-7 shrink-0 rounded-full bg-brand flex items-center justify-center mt-0.5 shadow-sm">
                      <Check
                        className="size-4 text-white"
                        strokeWidth={3}
                      />
                    </div>
                    <div>
                      <h4 className="text-[15.5px] font-bold text-ink leading-snug mb-1">
                        {n.title}
                      </h4>
                      <p className="text-[13.5px] text-ink-muted leading-relaxed">
                        {n.body}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* FEATURES — viele, dezent */}
            <div className="mt-10 pt-8 border-t border-line">
              <div className="text-[11px] font-semibold tracking-[0.18em] uppercase text-ink-muted text-center mb-5">
                Und das ist alles drin
              </div>
              <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-5 gap-y-2">
                {FEATURES.map((f) => (
                  <li
                    key={f}
                    className="flex items-start gap-2 text-[12.5px] text-ink-soft leading-snug"
                  >
                    <Check
                      className="size-3 text-brand-deep mt-[3px] shrink-0"
                      strokeWidth={3}
                    />
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
            </div>

            {/* CTA */}
            <div className="mt-10 text-center">
              <Link
                href="/signup"
                className="inline-flex items-center justify-center gap-1.5 rounded-full px-7 py-3.5 text-sm font-semibold bg-ink text-white hover:bg-ink/90 transition-all shadow-[0_10px_28px_-8px_rgba(15,23,42,0.45)]"
              >
                Jetzt starten
                <ArrowRight className="size-4" />
              </Link>
              <div className="text-[12px] text-ink-muted mt-4">
                3 Monate Mindestlaufzeit · nur für Unternehmen (B2B) · Videos
                erfordern zusätzlich Credits
              </div>
            </div>
          </div>
        </RevealOnScroll>

        {/* Footer note */}
        <RevealOnScroll delay={500}>
          <p className="text-center text-sm text-ink-muted mt-10">
            Alle Preise netto, zzgl. MwSt. Videos werden taggenau
            abgerechnet. Keine Mindestabnahme.
          </p>
        </RevealOnScroll>
      </div>
    </section>
  );
}
