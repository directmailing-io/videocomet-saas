"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowRight, Check, ChevronDown, Plus } from "lucide-react";
import { RevealOnScroll } from "./RevealOnScroll";
import { Squircle } from "./Squircle";

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
  { count: 0, label: "0 Leads" },
  { count: 250, label: "250 Leads" },
  { count: 1000, label: "1.000 Leads" },
];

/** Was Credits kosten — eine Zeile pro Leistung, Chip rechts. */
const CREDIT_KOSTEN: ReadonlyArray<{ label: string; credits: string }> = [
  { label: "1 Lead komplett: Video, Landingpage, Brief + Umschlag", credits: "1 Credit" },
  { label: "Extra: KI-Begrüßung mit Vornamen, in deiner Stimme", credits: "+1 Credit" },
  { label: "10 E-Mails versenden", credits: "1 Credit" },
];

export function PricingSection() {
  const [showFeatures, setShowFeatures] = React.useState(false);
  return (
    <section
      id="pricing"
      className="relative z-[2] w-full bg-white py-16 md:py-32 overflow-hidden"
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
              40 € Grundgebühr im Monat. Alles andere zahlst du mit
              Credits — und{" "}
              <strong className="font-semibold text-ink">
                1 Credit kostet genau 1 €
              </strong>
              . Fertig.
            </p>
          </RevealOnScroll>
        </div>

        {/* Big Pricing Card */}
        <RevealOnScroll delay={400}>
          <Squircle radius={30} shadow="float" className="bg-brand p-[2px]">
            <Squircle radius={28} className="relative bg-white p-8 md:p-12">
            {/* Preis-Formel: zwei Karten im Ablauf-Stil, Preis als Glas-Karte auf Sky */}
            <div className="flex flex-col md:flex-row md:items-stretch gap-3 md:gap-0 pb-8 md:pb-10 border-b border-line">
              {/* Grundtarif */}
              <div className="flex-1 min-w-0">
                <Squircle
                  radius={28}
                  shadow="pretty"
                  wrapperClassName="h-full"
                  className="bg-[#f8f7fd] p-5 md:p-6 flex flex-col h-full"
                >
                  <Squircle
                    radius={18}
                    className="relative h-44 bg-cover"
                    style={{
                      backgroundImage: "url(/visual-sky.jpg)",
                      backgroundPosition: "50% 26%",
                    }}
                  >
                    <div className="absolute inset-0 flex items-center justify-center p-4">
                      <Squircle
                        radius={16}
                        shadow="float"
                        className="bg-white/95 backdrop-blur-md px-7 py-4 text-center"
                      >
                        <div className="flex items-baseline gap-1 justify-center">
                          <span className="font-light tracking-[-0.04em] leading-none text-[44px] bg-clip-text text-transparent bg-[linear-gradient(96deg,#9573EE_0%,#7C5CE8_45%,#5E44C2_75%,#3F2D8A_100%)]">
                            40 €
                          </span>
                        </div>
                        <div className="text-[12px] text-ink-muted mt-1.5">
                          netto / Monat
                          <span className="mx-1.5 text-ink-muted/50">·</span>
                          <span className="line-through decoration-[1.5px] tabular-nums">
                            375 €
                          </span>{" "}
                          <span className="font-semibold text-emerald-600">
                            −89 %
                          </span>
                        </div>
                      </Squircle>
                    </div>
                  </Squircle>
                  <h3 className="text-lg font-semibold text-ink leading-tight mt-5 mb-2">
                    Dein Zugang zur Plattform
                  </h3>
                  <p className="text-[14.5px] leading-relaxed text-ink-soft">
                    Alles offen: Editor, Landingpages, Briefe, Tracking,
                    Integrationen. Neue Features kommen automatisch dazu.
                  </p>
                </Squircle>
              </div>

              {/* Plus-Trenner */}
              <div className="flex items-center justify-center md:px-3 shrink-0 py-1 md:py-0">
                <div
                  className="size-11 rounded-full bg-white border border-line flex items-center justify-center"
                  style={{
                    boxShadow: "0 6px 16px -4px rgba(124,92,232,0.35)",
                  }}
                >
                  <Plus className="size-5 text-brand-deep" strokeWidth={2.5} />
                </div>
              </div>

              {/* Pro Lead */}
              <div className="flex-1 min-w-0">
                <Squircle
                  radius={28}
                  shadow="pretty"
                  wrapperClassName="h-full"
                  className="bg-[#f8f7fd] p-5 md:p-6 flex flex-col h-full"
                >
                  <Squircle
                    radius={18}
                    className="relative h-44 bg-cover"
                    style={{
                      backgroundImage: "url(/visual-sky.jpg)",
                      backgroundPosition: "50% 74%",
                    }}
                  >
                    <div className="absolute inset-0 flex items-center justify-center p-4">
                      <Squircle
                        radius={16}
                        shadow="float"
                        className="bg-white/95 backdrop-blur-md px-7 py-4 text-center"
                      >
                        <div className="flex items-baseline gap-2 justify-center">
                          <span className="font-light tracking-[-0.04em] leading-none text-[38px] bg-clip-text text-transparent bg-[linear-gradient(96deg,#9573EE_0%,#7C5CE8_45%,#5E44C2_75%,#3F2D8A_100%)]">
                            1 Credit
                          </span>
                          <span className="font-light tracking-[-0.04em] leading-none text-[38px] text-ink/70">
                            =
                          </span>
                          <span className="font-light tracking-[-0.04em] leading-none text-[38px] bg-clip-text text-transparent bg-[linear-gradient(96deg,#9573EE_0%,#7C5CE8_45%,#5E44C2_75%,#3F2D8A_100%)]">
                            1 €
                          </span>
                        </div>
                        <div className="text-[12px] text-ink-muted mt-1.5">
                          dein Guthaben, ohne Kleingedrucktes
                        </div>
                      </Squircle>
                    </div>
                  </Squircle>
                  <h3 className="text-lg font-semibold text-ink leading-tight mt-5 mb-2">
                    Und so viel kosten die Dinge
                  </h3>
                  <ul className="flex flex-col gap-2">
                    {CREDIT_KOSTEN.map((k) => (
                      <li
                        key={k.label}
                        className="flex items-center justify-between gap-3 rounded-xl bg-white border border-line/70 px-3.5 py-2.5"
                      >
                        <span className="text-[13.5px] text-ink-soft leading-snug">
                          {k.label}
                        </span>
                        <span className="shrink-0 rounded-full bg-brand-soft text-brand-deep text-[12px] font-bold px-3 py-1 whitespace-nowrap tabular-nums">
                          {k.credits}
                        </span>
                      </li>
                    ))}
                  </ul>
                </Squircle>
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
              <p className="mt-4 text-center text-[13px] text-ink-muted">
                Gerechnet: 40 € Grundgebühr + 1 Credit pro Lead. Mit
                KI-Begrüßung wären es 2 Credits pro Lead.
              </p>
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

            {/* FEATURES — aufklappbar */}
            <div className="mt-10 pt-8 border-t border-line">
              <button
                type="button"
                onClick={() => setShowFeatures((v) => !v)}
                aria-expanded={showFeatures}
                className="mx-auto flex items-center gap-2 rounded-full border border-line bg-surface-soft px-5 py-2.5 text-[13px] font-semibold text-ink hover:bg-brand-soft/60 transition-colors"
              >
                Alle {FEATURES.length} Plattform-Features ansehen
                <ChevronDown
                  className={`size-4 text-brand-deep transition-transform ${showFeatures ? "rotate-180" : ""}`}
                  strokeWidth={2.5}
                />
              </button>
              {showFeatures && (
                <ul className="mt-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-5 gap-y-2">
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
              )}
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
                3 Monate Mindestlaufzeit · nur für Unternehmen (B2B)
              </div>
            </div>
            </Squircle>
          </Squircle>
        </RevealOnScroll>

        {/* Footer note */}
        <RevealOnScroll delay={500}>
          <p className="text-center text-sm text-ink-muted mt-10">
            Alle Preise netto, zzgl. MwSt. Keine Mindestabnahme. Deine
            Credits bleiben dir die gesamte Laufzeit erhalten.
          </p>
        </RevealOnScroll>
      </div>
    </section>
  );
}
