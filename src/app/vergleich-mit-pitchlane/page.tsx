import type { Metadata } from "next";
import Link from "next/link";
import {
  Check,
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
  title: "Pitchlane Vergleich: Was VIDEOCOMET besser macht | VIDEOCOMET",
  description:
    "Pitchlane Vergleich in 5 Punkten: echtes Scrolling mit Mauszeiger, Name wird gesprochen, Brief und E-Mail eingebaut, genaues Tracking, alles auf Deutsch.",
  keywords: [
    "Pitchlane Vergleich",
    "Pitchlane Alternative",
    "personalisierte Videos",
    "Video-Akquise",
    "VIDEOCOMET",
  ],
  alternates: { canonical: "/vergleich-mit-pitchlane" },
  openGraph: {
    title: "Pitchlane Vergleich: Was VIDEOCOMET besser macht",
    description:
      "5 Unterschiede, einfach erklärt: echtes Scrolling, gesprochener Name, Brief und E-Mail aus einem Tool, genaues Tracking, alles auf Deutsch.",
    url: "https://videocomet.de/vergleich-mit-pitchlane",
    type: "website",
  },
};

type ContrastTopic = {
  icon: React.ComponentType<{ className?: string }>;
  question: string;
  intro: string;
  videocomet: string[];
  pitchlane: string[];
  meaning: string;
};

const TOPICS: ContrastTopic[] = [
  {
    icon: MonitorPlay,
    question: "Scrollt das Video wirklich durch die Website?",
    intro:
      "Der Wow-Moment: Dein Video scrollt durch die Website deines Wunschkunden. Aber nur, wenn es echt aussieht. Sonst kippt der Effekt ins Gegenteil.",
    videocomet: [
      "VIDEOCOMET öffnet die Website in einem echten Browser und filmt sie ab. Alles sieht so aus, wie es dein Wunschkunde von seiner eigenen Website kennt.",
      "Sogar die Mausbewegung ist echt. Man sieht den Mauszeiger, wie bei einer echten Bildschirmaufnahme.",
      "Das funktioniert auch bei modernen und aufwendigen Websites. Du bestimmst, wie lange gescrollt wird.",
    ],
    pitchlane: [
      "Pitchlane bettet die Website in einen technischen Rahmen ein. Viele moderne Websites blockieren das.",
      "Dann zeigt das Video statt Scrolling nur ein Standbild. Das schreibt Pitchlane selbst in seiner Hilfe.¹",
      "Dein Wunschkunde bekommt dann ein Video, das nicht hält, was es verspricht.",
    ],
    meaning:
      "Ein Video, das nicht echt wirkt, ist schlimmer als gar keins. Merkt dein Wunschkunde ein Standbild oder ein unnatürliches Scrollen, denkt er: Das ist eine Masche. Dieses verlorene Vertrauen bekommst du nicht zurück, und es kostet dich langfristig viel mehr als jedes Tool.",
  },
  {
    icon: Volume2,
    question: "Sagt das Video den Namen des Empfängers?",
    intro:
      "Nichts wirkt persönlicher, als den eigenen Namen zu hören. Genau da liegt ein großer Unterschied.",
    videocomet: [
      "Die KI-Begrüßung spricht jeden Wunschkunden mit Namen an: „Hey Marcel …“. In deiner eigenen Stimme, mit passender Lippenbewegung.",
      "Du nimmst einmal auf. VIDEOCOMET erstellt daraus die persönliche Begrüßung für jeden einzelnen Lead.",
    ],
    pitchlane: [
      "Pitchlane zeigt den Namen nur im Bild, zum Beispiel auf der eingeblendeten Website.",
      "Ausgesprochen wird der Name nicht. Jeder Empfänger hört exakt dasselbe Video.",
    ],
    meaning:
      "Wer seinen Namen hört, hört zu. Dein Wunschkunde fühlt sich vom ersten Wort an persönlich gemeint, nicht wie Nummer 87 auf einer Liste. Genau dieses Gefühl entscheidet, ob er weiterschaut oder wegklickt.",
  },
  {
    icon: Presentation,
    question: "Was kann mitten im Video gezeigt werden?",
    intro:
      "Ein gutes Verkaufsvideo zeigt nicht nur dich. Es zeigt dem Empfänger etwas, das nur für ihn gemacht wurde.",
    videocomet: [
      "Website, Karriereseite oder Onlineshop des Wunschkunden: echt gescrollt, mitten im Video.",
      "Zusätzlich personalisierte Präsentationen: PowerPoint, Google Docs oder PDF, mit den Daten des Wunschkunden.",
      "Alles in einem Video, ohne Schnitt-Programm.",
    ],
    pitchlane: [
      "Pitchlane zeigt vor allem die Website oder das LinkedIn-Profil als Hintergrund.",
      "Personalisierte Präsentationen mitten im Video sind nicht das Konzept.",
    ],
    meaning:
      "Dein Wunschkunde denkt: Da hat sich jemand wirklich mit mir beschäftigt. Genau dieses Gefühl öffnet Türen und hebt dich von jeder Massen-Mail ab.",
  },
  {
    icon: Mail,
    question: "Wie kommt das Video zum Wunschkunden?",
    intro:
      "Das beste Video bringt nichts, wenn es niemand sieht. Der Weg zum Empfänger entscheidet.",
    videocomet: [
      "Unsere Spezialität ist der Brief: VIDEOCOMET erstellt einen fertigen Brief mit QR-Code samt Umschlag. Post landet nicht im Spam-Ordner und wird fast immer geöffnet.",
      "Du bist aber frei: E-Mail-Versand ist genauso eingebaut. Du wählst pro Kampagne, was zu dir passt.",
      "Du siehst genau, wer sein Video geöffnet und wie lange er geschaut hat. So machst du dein Follow-up schneller und beim richtigen Kontakt.",
    ],
    pitchlane: [
      "Pitchlane verschickt selbst keine E-Mails. Du brauchst ein zusätzliches Versand-Tool wie Smartlead oder Instantly.²",
      "Das zweite Tool kostet extra und muss eingerichtet werden.",
      "Einen Brief mit QR-Code gibt es nicht.",
    ],
    meaning:
      "Du erreichst deine Wunschkunden auf einem Weg, den kaum ein Wettbewerber nutzt. Und du weißt jederzeit, bei wem sich ein Anruf gerade wirklich lohnt. Kein Rätselraten, kein Hinterhertelefonieren ins Blaue.",
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
    meaning:
      "Du arbeitest in deiner Sprache und mit einem Anbieter, den du wirklich erreichst. Wenn etwas klemmt, hilft dir jemand auf Deutsch. Das spart Nerven und Zeit.",
  },
];

const FAQ_JSON_LD = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: TOPICS.map((t) => ({
    "@type": "Question",
    name: t.question,
    acceptedAnswer: {
      "@type": "Answer",
      text: `${t.videocomet.join(" ")} ${t.meaning}`,
    },
  })),
};

function ContrastCard({ topic, index }: { topic: ContrastTopic; index: number }) {
  const Icon = topic.icon;
  return (
    <RevealOnScroll delay={index % 2 === 0 ? 0 : 120}>
      <Squircle radius={28} shadow="pretty" className="bg-white">
        <div className="p-5 sm:p-8">
          <div className="flex items-start gap-3.5 sm:gap-4">
            <div
              className="shrink-0 size-10 sm:size-11 rounded-2xl flex items-center justify-center text-white"
              style={{
                background:
                  "linear-gradient(135deg, #9573EE 0%, #5E44C2 100%)",
                boxShadow: "0 6px 16px -4px rgba(94,68,194,0.4)",
              }}
            >
              <Icon className="size-5" aria-hidden />
            </div>
            <div className="min-w-0">
              <h3 className="text-lg sm:text-2xl font-light leading-snug tracking-[-0.02em] text-ink">
                {topic.question}
              </h3>
              <p className="mt-1.5 text-sm text-ink-muted leading-relaxed">
                {topic.intro}
              </p>
            </div>
          </div>

          <div className="mt-5 sm:mt-6 grid gap-4 md:grid-cols-2">
            <div className="rounded-2xl bg-brand-soft/60 p-4 sm:p-5">
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
            <div className="rounded-2xl bg-surface-soft p-4 sm:p-5">
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

          <div className="mt-4 rounded-2xl border border-brand-soft bg-white px-4 py-3.5 sm:px-5 sm:py-4">
            <p className="text-sm leading-relaxed text-ink">
              <span className="font-semibold text-brand-deep">
                Was das für dich heißt:{" "}
              </span>
              {topic.meaning}
            </p>
          </div>
        </div>
      </Squircle>
    </RevealOnScroll>
  );
}

export default function VergleichMitPitchlanePage() {
  return (
    <div className="bg-[#f7f5fd] text-ink">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(FAQ_JSON_LD) }}
      />
      <MarketingNav />

      {/* Sub-Hero */}
      <section
        aria-label="Einleitung"
        className="relative overflow-hidden pt-28 pb-14 sm:pt-40 sm:pb-20"
        style={{
          background:
            "linear-gradient(180deg, #cfc2f2 0%, #e3dbf8 55%, #f7f5fd 100%)",
        }}
      >
        <div className="relative z-10 max-w-6xl mx-auto px-5 sm:px-6 md:px-10">
          <RevealOnScroll>
            <span className="inline-flex items-center px-3.5 py-1.5 rounded-full bg-white/60 backdrop-blur text-brand-deep text-[11px] font-semibold uppercase tracking-[0.18em]">
              Der ehrliche Vergleich
            </span>
            <h1 className="mt-5 max-w-3xl text-[clamp(1.9rem,5.5vw,3.6rem)] font-light leading-[1.12] tracking-[-0.035em]">
              VIDEOCOMET und Pitchlane im Vergleich.{" "}
              <span className="font-semibold text-brand-deep">
                Der Unterschied liegt im Ergebnis.
              </span>
            </h1>
            <p className="mt-5 max-w-2xl text-base sm:text-lg text-ink-soft leading-relaxed">
              Beide Tools machen persönliche Videos für deine Kundengewinnung.
              Nicht wenige unserer Kunden sind vorher auf Pitchlane gestoßen
              und haben es ausprobiert. Langfristig dabei geblieben ist dort
              kaum jemand. Das hat nachvollziehbare Gründe. Die fünf
              wichtigsten zeigen wir dir hier. Und was jeder davon für dich
              bedeutet. Ohne Fachchinesisch.
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
      <section aria-label="Kurzfassung" className="max-w-6xl mx-auto px-5 sm:px-6 md:px-10">
        <RevealOnScroll>
          <Squircle radius={28} shadow="pretty" className="bg-white">
            <div className="p-5 sm:p-8">
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-brand-deep">
                Kurz gesagt
              </div>
              <p className="mt-3 max-w-3xl text-base sm:text-lg text-ink leading-relaxed">
                Pitchlane macht Videos, die persönlich aussehen. VIDEOCOMET
                macht Videos, die persönlich <em>sind</em>: Das Video spricht
                deinen Wunschkunden mit Namen an und scrollt echt durch seine
                Website. Ankommen tut es so, wie du willst: als Brief mit
                QR-Code, unsere Spezialität, denn Post wird fast immer
                geöffnet. Oder ganz einfach per E-Mail. Du siehst danach genau,
                wer geschaut hat. Alles aus einem Tool, alles auf Deutsch.
              </p>
            </div>
          </Squircle>
        </RevealOnScroll>
      </section>

      {/* Themen-Karten */}
      <section
        aria-label="Die fünf Unterschiede"
        className="max-w-6xl mx-auto px-5 sm:px-6 md:px-10 mt-12 sm:mt-20"
      >
        <RevealOnScroll>
          <span className="inline-flex items-center px-3.5 py-1.5 rounded-full bg-brand-soft text-brand-deep text-[11px] font-semibold uppercase tracking-[0.18em]">
            5 Unterschiede
          </span>
          <h2 className="mt-4 max-w-2xl text-[clamp(1.6rem,4vw,2.6rem)] font-light leading-[1.15] tracking-[-0.035em]">
            Was dein Wunschkunde{" "}
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

      {/* Credits */}
      <section
        aria-label="Kosten"
        className="max-w-6xl mx-auto px-5 sm:px-6 md:px-10 mt-12 sm:mt-20"
      >
        <RevealOnScroll>
          <Squircle radius={28} shadow="float" className="bg-white">
            <div className="p-5 sm:p-10">
              <span className="inline-flex items-center px-3.5 py-1.5 rounded-full bg-brand-soft text-brand-deep text-[11px] font-semibold uppercase tracking-[0.18em]">
                Eine einfache Rechnung
              </span>
              <h2 className="mt-4 max-w-2xl text-[clamp(1.6rem,4vw,2.6rem)] font-light leading-[1.15] tracking-[-0.035em]">
                1 Wunschkunde = 1 Credit.{" "}
                <span className="font-semibold text-brand-deep">
                  Mehr musst du dir nicht merken.
                </span>
              </h2>
              <div className="mt-5 max-w-3xl flex flex-col gap-3 text-base text-ink-soft leading-relaxed">
                <p>
                  Ein Credit, und dein Wunschkunde bekommt das volle Paket:
                  persönliches Video, eigene Landingpage, fertiger Brief mit
                  QR-Code samt Umschlag. Aus einem Tool, ohne etwas
                  zusammenzustückeln.
                </p>
                <p className="text-ink font-medium">
                  Und jetzt rechne kurz selbst: Was bringt dir ein einziger
                  neuer Kunde? Eben. Hier geht es nicht um den Preis eines
                  Videos. Es geht um den Wert eines Auftrags.
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
        className="max-w-6xl mx-auto px-5 sm:px-6 md:px-10 pb-12"
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
            oder Instantly).
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
