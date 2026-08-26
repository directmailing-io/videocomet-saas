import type { Metadata } from "next";
import Link from "next/link";
import {
  AtSign,
  Check,
  FileText,
  Mail,
  Minus,
  MonitorPlay,
  Presentation,
  ShieldCheck,
  Volume2,
} from "lucide-react";
import { MarketingNav } from "@/components/marketing/MarketingNav";
import { MarketingFooter } from "@/components/marketing/MarketingFooter";
import { FinalCtaSection } from "@/components/marketing/FinalCtaSection";
import { RevealOnScroll } from "@/components/marketing/RevealOnScroll";
import { Squircle } from "@/components/marketing/Squircle";

export const metadata: Metadata = {
  title: "VIDEOCOMET oder Pitchlane? Der ehrliche Vergleich | VIDEOCOMET",
  description:
    "Beide machen persönliche Videos für deine Kundengewinnung. Aber die Ergebnisse unterscheiden sich deutlich. Hier siehst du, wo und warum.",
  alternates: { canonical: "/vergleich-mit-pitchlane" },
};

type ContrastTopic = {
  icon: React.ComponentType<{ className?: string }>;
  question: string;
  intro: string;
  videocomet: string[];
  pitchlane: string[];
  footnote?: string;
};

const TOPICS: ContrastTopic[] = [
  {
    icon: MonitorPlay,
    question: "Scrollt das Video wirklich durch die Website?",
    intro:
      "Der große Wow-Moment: Dein Video scrollt durch die Website des Empfängers. Aber nur, wenn es auch wirklich funktioniert.",
    videocomet: [
      "VIDEOCOMET öffnet die Website in einem echten Browser und nimmt sie auf. So wie du sie selbst am Bildschirm siehst.",
      "Das funktioniert auch bei modernen und aufwendigen Websites.",
      "Du bestimmst, wie lange gescrollt wird: 5 Sekunden, 20 Sekunden oder länger.",
    ],
    pitchlane: [
      "Pitchlane bettet die Website in einen technischen Rahmen ein. Viele moderne Websites blockieren das.",
      "Dann zeigt das Video statt Scrolling nur ein Standbild. Das schreibt Pitchlane selbst in seiner Hilfe.¹",
      "Dein Empfänger sieht dann ein Video, das nicht hält, was es verspricht.",
    ],
  },
  {
    icon: Volume2,
    question: "Sagt das Video den Namen des Empfängers?",
    intro:
      "Nichts wirkt persönlicher, als den eigenen Namen zu hören. Genau da liegt ein großer Unterschied.",
    videocomet: [
      "Die KI-Begrüßung spricht jeden Empfänger mit Namen an: „Hey Marcel …“. In deiner eigenen Stimme, mit passender Lippenbewegung.",
      "Du nimmst einmal auf. VIDEOCOMET erstellt daraus die persönliche Begrüßung für jeden einzelnen Lead.",
    ],
    pitchlane: [
      "Pitchlane zeigt den Namen nur im Bild, zum Beispiel auf der eingeblendeten Website.",
      "Ausgesprochen wird der Name nicht. Jeder Empfänger hört exakt dasselbe Video.",
    ],
  },
  {
    icon: Presentation,
    question: "Was kann mitten im Video gezeigt werden?",
    intro:
      "Ein gutes Verkaufsvideo zeigt nicht nur dich. Es zeigt dem Empfänger etwas, das nur für ihn gemacht wurde.",
    videocomet: [
      "Website, Karriereseite oder Onlineshop des Empfängers: echt gescrollt, mitten im Video.",
      "Zusätzlich personalisierte Präsentationen: PowerPoint, Google Docs oder PDF, mit den Daten des Empfängers.",
      "Alles in einem Video, ohne Schnitt-Programm.",
    ],
    pitchlane: [
      "Pitchlane zeigt vor allem die Website oder das LinkedIn-Profil als Hintergrund.",
      "Personalisierte Präsentationen mitten im Video sind nicht das Konzept.",
    ],
  },
  {
    icon: Mail,
    question: "Wie kommt das Video zum Empfänger?",
    intro:
      "Ein Video bringt nichts, wenn es niemand sieht. Der Versand entscheidet.",
    videocomet: [
      "E-Mail-Versand ist eingebaut. Du brauchst kein zweites Tool.",
      "Jeder Lead bekommt automatisch eine eigene Landingpage mit seinem Video.",
      "Dazu gibt es einen fertigen Brief mit QR-Code als PDF samt Umschlag. Drucken, verschicken, fertig. Post öffnet fast jeder.",
    ],
    pitchlane: [
      "Pitchlane verschickt selbst keine E-Mails. Du brauchst ein zusätzliches Versand-Tool wie Smartlead oder Instantly.²",
      "Das zweite Tool kostet extra und muss eingerichtet werden.",
      "Einen Brief mit QR-Code gibt es nicht.",
    ],
  },
  {
    icon: ShieldCheck,
    question: "Passt es zum deutschen Markt?",
    intro:
      "Deine Empfänger sind deutsche Firmen. Dein Werkzeug sollte das auch können.",
    videocomet: [
      "VIDEOCOMET ist ein deutsches Produkt. Bedienung, Vorlagen und Support auf Deutsch.",
      "Verträge und Rechnungen von einer deutschen GmbH, Abrechnung in Euro.",
    ],
    pitchlane: [
      "Pitchlane ist ein englischsprachiges Tool. Bedienung, Hilfe und Support auf Englisch.",
      "Abgerechnet wird in US-Dollar.",
    ],
  },
];

function ContrastCard({ topic, index }: { topic: ContrastTopic; index: number }) {
  const Icon = topic.icon;
  return (
    <RevealOnScroll delay={index % 2 === 0 ? 0 : 120}>
      <Squircle radius={28} shadow="pretty" className="bg-white">
        <div className="p-6 sm:p-8">
          <div className="flex items-start gap-4">
            <div
              className="shrink-0 size-11 rounded-2xl flex items-center justify-center text-white"
              style={{
                background:
                  "linear-gradient(135deg, #9573EE 0%, #5E44C2 100%)",
                boxShadow: "0 6px 16px -4px rgba(94,68,194,0.4)",
              }}
            >
              <Icon className="size-5" aria-hidden />
            </div>
            <div className="min-w-0">
              <h3 className="text-xl sm:text-2xl font-light tracking-[-0.02em] text-ink">
                {topic.question}
              </h3>
              <p className="mt-1.5 text-sm text-ink-muted leading-relaxed">
                {topic.intro}
              </p>
            </div>
          </div>

          <div className="mt-6 grid gap-4 md:grid-cols-2">
            <div className="rounded-2xl bg-brand-soft/60 p-5">
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-brand-deep">
                VIDEOCOMET
              </div>
              <ul className="mt-3 flex flex-col gap-2.5">
                {topic.videocomet.map((line) => (
                  <li key={line} className="flex items-start gap-2.5 text-sm text-ink leading-relaxed">
                    <Check className="size-4 shrink-0 mt-0.5 text-brand-deep" aria-hidden />
                    <span>{line}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="rounded-2xl bg-surface-soft p-5">
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-ink-muted">
                Pitchlane
              </div>
              <ul className="mt-3 flex flex-col gap-2.5">
                {topic.pitchlane.map((line) => (
                  <li key={line} className="flex items-start gap-2.5 text-sm text-ink-soft leading-relaxed">
                    <Minus className="size-4 shrink-0 mt-0.5 text-ink-muted" aria-hidden />
                    <span>{line}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </Squircle>
    </RevealOnScroll>
  );
}

export default function VergleichMitPitchlanePage() {
  return (
    <div className="bg-[#f7f5fd] text-ink">
      <MarketingNav />

      {/* Sub-Hero */}
      <section
        aria-label="Einleitung"
        className="relative overflow-hidden pt-32 pb-16 sm:pt-40 sm:pb-20"
        style={{
          background:
            "linear-gradient(180deg, #cfc2f2 0%, #e3dbf8 55%, #f7f5fd 100%)",
        }}
      >
        <div className="relative z-10 max-w-6xl mx-auto px-6 md:px-10">
          <RevealOnScroll>
            <span className="inline-flex items-center px-3.5 py-1.5 rounded-full bg-white/60 backdrop-blur text-brand-deep text-[11px] font-semibold uppercase tracking-[0.18em]">
              Der ehrliche Vergleich
            </span>
            <h1 className="mt-5 max-w-3xl text-[clamp(2.2rem,5.5vw,3.6rem)] font-light leading-[1.08] tracking-[-0.035em]">
              VIDEOCOMET oder Pitchlane?{" "}
              <span className="font-semibold text-brand-deep">
                Der Unterschied liegt im Ergebnis.
              </span>
            </h1>
            <p className="mt-5 max-w-2xl text-base sm:text-lg text-ink-soft leading-relaxed">
              Beide Tools machen persönliche Videos für deine Kundengewinnung.
              Trotzdem bekommen deine Empfänger sehr unterschiedliche Videos zu
              sehen. Hier zeigen wir dir die fünf wichtigsten Unterschiede.
              Ohne Fachchinesisch.
            </p>
            <div className="mt-7">
              <Link
                href="/signup"
                className="inline-flex items-center gap-2 px-6 py-3 rounded-full bg-ink text-white text-sm font-semibold hover:bg-ink/90 transition-colors shadow-ink"
              >
                Jetzt direkt loslegen
                <svg
                  className="size-4"
                  viewBox="0 0 16 16"
                  fill="none"
                  aria-hidden
                >
                  <path
                    d="M3 8h10m0 0L9 4m4 4-4 4"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </Link>
            </div>
          </RevealOnScroll>
        </div>
      </section>

      {/* Kurz gesagt */}
      <section aria-label="Kurzfassung" className="max-w-6xl mx-auto px-6 md:px-10">
        <RevealOnScroll>
          <Squircle radius={28} shadow="pretty" className="bg-white">
            <div className="p-6 sm:p-8">
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-brand-deep">
                Kurz gesagt
              </div>
              <p className="mt-3 max-w-3xl text-base sm:text-lg text-ink leading-relaxed">
                Pitchlane macht Videos, die persönlich aussehen. VIDEOCOMET
                macht Videos, die persönlich <em>sind</em>: Das Video spricht
                deinen Empfänger mit Namen an, scrollt echt durch seine Website
                und kommt per E-Mail, Landingpage und Brief bei ihm an. Alles
                aus einem Tool, alles auf Deutsch.
              </p>
            </div>
          </Squircle>
        </RevealOnScroll>
      </section>

      {/* Themen-Karten */}
      <section
        aria-label="Die fünf Unterschiede"
        className="max-w-6xl mx-auto px-6 md:px-10 mt-14 sm:mt-20"
      >
        <RevealOnScroll>
          <span className="inline-flex items-center px-3.5 py-1.5 rounded-full bg-brand-soft text-brand-deep text-[11px] font-semibold uppercase tracking-[0.18em]">
            5 Unterschiede
          </span>
          <h2 className="mt-4 max-w-2xl text-[clamp(1.8rem,4vw,2.6rem)] font-light leading-[1.1] tracking-[-0.035em]">
            Was dein Empfänger{" "}
            <span className="font-semibold text-brand-deep">
              wirklich zu sehen bekommt
            </span>
          </h2>
        </RevealOnScroll>

        <div className="mt-8 flex flex-col gap-6">
          {TOPICS.map((topic, i) => (
            <ContrastCard key={topic.question} topic={topic} index={i} />
          ))}
        </div>
      </section>

      {/* Preis, ehrlich */}
      <section
        aria-label="Preisvergleich"
        className="max-w-6xl mx-auto px-6 md:px-10 mt-14 sm:mt-20"
      >
        <RevealOnScroll>
          <Squircle radius={28} shadow="float" className="bg-white">
            <div className="p-6 sm:p-10">
              <span className="inline-flex items-center px-3.5 py-1.5 rounded-full bg-brand-soft text-brand-deep text-[11px] font-semibold uppercase tracking-[0.18em]">
                Und der Preis?
              </span>
              <h2 className="mt-4 max-w-2xl text-[clamp(1.8rem,4vw,2.6rem)] font-light leading-[1.1] tracking-[-0.035em]">
                Pitchlane wirkt günstiger.{" "}
                <span className="font-semibold text-brand-deep">
                  Der Vergleich hinkt aber.
                </span>
              </h2>
              <div className="mt-5 max-w-3xl flex flex-col gap-3 text-base text-ink-soft leading-relaxed">
                <p>
                  Ja, Pitchlane kostet auf dem Papier weniger: ab 37 US-Dollar
                  im Monat für 250 Video-Credits.³ Aber damit hast du nur
                  Videos. Für den Versand brauchst du ein zweites Tool, das
                  extra kostet. Und wenn das Scrolling auf einer Website nicht
                  funktioniert, bekommt dein Empfänger ein Standbild.
                </p>
                <p>
                  Bei VIDEOCOMET zahlst du 40 Euro Grundgebühr im Monat und
                  dann 1 Euro pro Lead. Dafür ist ein Lead komplett versorgt:
                  persönliches Video, eigene Landingpage, fertiger Brief mit
                  QR-Code und E-Mail-Versand. Kein zweites Tool, keine
                  versteckten Kosten.
                </p>
                <p className="text-ink font-medium">
                  Du zahlst also nicht für ein Video. Du zahlst 1 Euro dafür,
                  dass ein Wunschkunde komplett angesprochen wird. Auf allen
                  Wegen, in bester Qualität.
                </p>
              </div>
            </div>
          </Squircle>
        </RevealOnScroll>
      </section>

      <div className="mt-6" />
      <FinalCtaSection />

      {/* Quellen + Rechtliches */}
      <section
        aria-label="Quellen und Hinweise"
        className="max-w-6xl mx-auto px-6 md:px-10 pb-12"
      >
        <div className="border-t border-line pt-6 text-xs text-ink-muted leading-relaxed max-w-3xl flex flex-col gap-2">
          <p>
            Stand: 26. August 2026. Alle Angaben zu Pitchlane nach bestem
            Wissen, recherchiert auf den öffentlichen Seiten des Anbieters.
          </p>
          <p>
            ¹ Quelle: helpdesk.pitchlane.com, Artikel „Why can&apos;t scrolling
            appear on all my videos?“. ² Quelle: helpdesk.pitchlane.com,
            Bereich Software-Guides (Versand über Drittanbieter wie Smartlead
            oder Instantly). ³ Quelle: pitchlane.com/pricing.
          </p>
          <p>
            Pitchlane ist eine Marke des jeweiligen Inhabers. VIDEOCOMET steht
            in keiner Verbindung zu Pitchlane. Dieser Vergleich dient der
            sachlichen Information.
          </p>
        </div>
      </section>

      <MarketingFooter />
    </div>
  );
}
