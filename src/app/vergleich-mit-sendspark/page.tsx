import type { Metadata } from "next";
import Link from "next/link";
import {
  Check,
  Coins,
  Mail,
  Minus,
  MonitorPlay,
  ShieldCheck,
  Volume2,
} from "lucide-react";
import { MarketingNav } from "@/components/marketing/MarketingNav";
import { MarketingFooter } from "@/components/marketing/MarketingFooter";
import { FinalCtaSection } from "@/components/marketing/FinalCtaSection";
import { RevealOnScroll } from "@/components/marketing/RevealOnScroll";
import { Squircle } from "@/components/marketing/Squircle";

export const metadata: Metadata = {
  title: "Sendspark Vergleich: Was VIDEOCOMET anders macht | VIDEOCOMET",
  description:
    "Sendspark Vergleich in 5 Punkten: echtes Scrolling statt Kulisse, Name mit Lippenbewegung gesprochen, feste Credits statt Minuten-Abrechnung, Brief und E-Mail eingebaut, alles auf Deutsch.",
  keywords: [
    "Sendspark Vergleich",
    "Sendspark Alternative",
    "Sendspark deutsch",
    "personalisierte Videos",
    "Video-Akquise",
    "VIDEOCOMET",
  ],
  alternates: { canonical: "/vergleich-mit-sendspark" },
  openGraph: {
    title: "Sendspark Vergleich: Was VIDEOCOMET anders macht",
    description:
      "5 Unterschiede, einfach erklärt: echtes Scrolling, gesprochener Name mit Lippenbewegung, feste Credits statt Minuten, Brief und E-Mail aus einem Tool, alles auf Deutsch.",
    url: "https://videocomet.de/vergleich-mit-sendspark",
    type: "website",
  },
};

type ContrastTopic = {
  icon: React.ComponentType<{ className?: string }>;
  question: string;
  intro: string;
  videocomet: string[];
  competitor: string[];
  meaning: string;
};

const TOPICS: ContrastTopic[] = [
  {
    icon: MonitorPlay,
    question: "Wie zeigt das Video die Website des Wunschkunden?",
    intro:
      "Beide Tools blenden die Website deines Wunschkunden ein. Der Unterschied ist, wie glaubwürdig das aussieht.",
    videocomet: [
      "VIDEOCOMET öffnet die Website in einem echten Browser und filmt sie ab. Sie füllt das Bild, mitten im Video, so lange du willst.",
      "Sogar die Mausbewegung ist echt. Man sieht den Mauszeiger, wie bei einer echten Bildschirmaufnahme.",
      "Zusätzlich kannst du personalisierte Präsentationen zeigen: PowerPoint, Google Docs oder PDF mit den Daten des Wunschkunden.",
    ],
    competitor: [
      "Bei Sendspark ist die Website vor allem eine Kulisse: Sie läuft als Hintergrund hinter deinem Kamerabild.¹",
      "Du kannst nicht mitten im Video in die Website hineingehen, in Ruhe eine Stelle zeigen und mit dem Mauszeiger darauf deuten.",
      "Personalisierte Präsentationen mitten im Video sind nicht das Konzept.",
    ],
    meaning:
      "Dein Wunschkunde soll denken: Der hat sich meine Website wirklich angeschaut. Eine Kulisse im Hintergrund wirkt nett. Eine echte Bildschirmaufnahme mit Mauszeiger wirkt, als hättest du dir persönlich Zeit genommen. Genau das öffnet Türen.",
  },
  {
    icon: Volume2,
    question: "Wie persönlich ist die Begrüßung mit Namen?",
    intro:
      "Sendspark kann den Namen sprechen lassen, das können wir auch. Der Unterschied steckt im Bild.",
    videocomet: [
      "Die KI-Begrüßung spricht jeden Wunschkunden mit Namen an: „Hey Marcel …“. In deiner eigenen Stimme, mit passender Lippenbewegung.",
      "Dein Mund bewegt sich also genau zu dem, was gesagt wird. Es gibt keinen Moment, der komisch aussieht.",
      "Du nimmst einmal auf. VIDEOCOMET erstellt daraus die persönliche Begrüßung für jeden einzelnen Lead.",
    ],
    competitor: [
      "Sendspark klont deine Stimme und setzt den Namen in die Tonspur ein. Das klingt erst mal gut.",
      "Aber die Lippenbewegung wird dabei nicht angepasst.² Die Stimme sagt „Marcel“, der Mund im Bild sagt etwas anderes.",
      "Genau auf diesen Moment schaut dein Wunschkunde aber am genauesten hin.",
    ],
    meaning:
      "Die Begrüßung ist die erste Sekunde deines Videos. Wenn Ton und Bild dort nicht zusammenpassen, merkt dein Wunschkunde: Da stimmt was nicht. Und ab dann schaut er skeptisch statt neugierig. Diese erste Sekunde muss sitzen.",
  },
  {
    icon: Coins,
    question: "Wie wird abgerechnet?",
    intro:
      "Klingt nach einem Randthema, entscheidet aber darüber, wie frei du arbeiten kannst.",
    videocomet: [
      "Bei VIDEOCOMET zahlst du feste Credits pro Wunschkunde, nicht pro Minute. Egal, ob dein Video 1 Minute oder 7 Minuten lang ist.",
      "Du kannst also in Ruhe erklären, zeigen und überzeugen, ohne auf die Uhr zu schauen.",
    ],
    competitor: [
      "Sendspark rechnet in Video-Minuten ab. Der Einstiegs-Plan kostet 49 US-Dollar im Monat und enthält 100 Minuten.³",
      "Jede erstellte Video-Minute zählt: Ein 2-Minuten-Video für 100 Wunschkunden sind schon 200 Minuten.",
      "Jede zusätzliche Minute kostet extra. Je länger dein Video, desto teurer wird jeder einzelne Wunschkunde.",
    ],
    meaning:
      "Ein Minuten-Modell erzieht dich dazu, kurze Videos zu machen, damit es nicht teuer wird. Bei uns entscheidet der Inhalt über die Länge, nicht die Abrechnung. Dein bestes Video darf so lang sein, wie es sein muss.",
  },
  {
    icon: Mail,
    question: "Wie kommt das Video zum Wunschkunden?",
    intro:
      "Das beste Video bringt nichts, wenn es niemand sieht. Der Weg zum Empfänger entscheidet.",
    videocomet: [
      "Unsere Spezialität ist der Brief: VIDEOCOMET erstellt einen fertigen Brief mit QR-Code samt Umschlag. Post landet nicht im Spam-Ordner und wird fast immer geöffnet.",
      "Du bist aber frei: E-Mail-Versand ist genauso eingebaut. Du wählst pro Kampagne, was zu dir passt.",
      "Jeder Wunschkunde bekommt eine eigene Landingpage in deinem Design. Und du siehst genau, wer geschaut hat und wie lange.",
    ],
    competitor: [
      "Sendspark ist ein reines E-Mail- und Online-Werkzeug. Einen Brief mit QR-Code gibt es nicht.",
      "Für den Versand in Serie verbindest du Sendspark mit Zusatz-Tools wie HubSpot, Outreach oder Smartlead.³",
      "Die automatischen Abläufe dafür gibt es erst ab dem Growth-Plan für 99 US-Dollar im Monat.³",
    ],
    meaning:
      "Im E-Mail-Postfach deines Wunschkunden kämpfen täglich dutzende Anbieter um Aufmerksamkeit. Auf seinem Schreibtisch liegt fast nie ein persönlicher Brief mit Video. Du erreichst ihn auf einem Weg, den kaum ein Wettbewerber nutzt. Und alles kommt aus einem Tool.",
  },
  {
    icon: ShieldCheck,
    question: "Passt es zum deutschen Markt?",
    intro:
      "Deine Empfänger sind deutsche Firmen. Dein Werkzeug sollte das auch können.",
    videocomet: [
      "VIDEOCOMET ist ein deutsches Produkt. Bedienung, Vorlagen und Support auf Deutsch.",
      "Verträge und Rechnungen von einer deutschen GmbH, Abrechnung in Euro. Server und Datenbank stehen in Deutschland.",
    ],
    competitor: [
      "Sendspark ist ein US-Anbieter. Bedienung, Hilfe und Support auf Englisch.",
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
                Sendspark
              </div>
              <ul className="mt-3 flex flex-col gap-2.5">
                {topic.competitor.map((line) => (
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

export default function VergleichMitSendsparkPage() {
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
              Die Sendspark Alternative aus Deutschland.{" "}
              <span className="font-semibold text-brand-deep">
                Ähnliche Idee, anderes Ergebnis.
              </span>
            </h1>
            <p className="mt-5 max-w-2xl text-base sm:text-lg text-ink-soft leading-relaxed">
              Sendspark ist einer der bekanntesten US-Anbieter für persönliche
              Verkaufsvideos. Die Grundidee ähnelt unserer: einmal aufnehmen,
              für viele Wunschkunden persönlich machen. Trotzdem entscheiden
              sich Kunden aus Deutschland immer wieder für VIDEOCOMET. Die
              fünf wichtigsten Gründe zeigen wir dir hier. Und was jeder davon
              für dich bedeutet. Ohne Fachchinesisch.
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
                Sendspark kann viel. VIDEOCOMET geht bei den entscheidenden
                Momenten einen Schritt weiter: Die Begrüßung spricht den Namen
                mit passender Lippenbewegung. Die Website wird echt gescrollt,
                mit Mauszeiger, statt nur als Kulisse zu laufen. Und ankommen
                tut das Video so, wie du willst: als Brief mit QR-Code, unsere
                Spezialität, denn Post wird fast immer geöffnet. Oder ganz
                einfach per E-Mail. Alles aus einem Tool, in festen Credits
                statt Minuten, alles auf Deutsch.
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
                Feste Credits pro Wunschkunde.{" "}
                <span className="font-semibold text-brand-deep">
                  Du weißt vorher genau, was es kostet.
                </span>
              </h2>
              <div className="mt-5 max-w-3xl flex flex-col gap-3 text-base text-ink-soft leading-relaxed">
                <p>
                  Ein Credit, und dein Wunschkunde bekommt das Paket:
                  persönliches Video, eigene Landingpage, fertiger Brief mit
                  QR-Code samt Umschlag. Möchtest du zusätzlich die
                  KI-Begrüßung, die deinen Wunschkunden mit Namen anspricht,
                  kommt ein Credit dazu. Das war die ganze Rechnung. Alles aus
                  einem Tool, ohne etwas zusammenzustückeln.
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
            Stand: 26. August 2026. Alle Angaben zu Sendspark nach bestem
            Wissen, recherchiert auf den öffentlichen Seiten des Anbieters und
            in öffentlichen Vergleichsberichten.
          </p>
          <p>
            ¹ Quelle: sendspark.com, Produktbeschreibung „Dynamic Video
            Backgrounds“. ² Quelle: öffentliche Vergleichsberichte zu
            Sendspark, u. a. custom.one/blog und 11x.ai (kein Lip-Sync bei
            personalisierter Tonspur). ³ Quelle: sendspark.com/pricing
            (Solo-Plan 49 USD/Monat mit 100 Dynamic-Video-Minuten,
            Zusatzminuten kostenpflichtig, Agentic Workflows und Versand über
            Tools wie HubSpot, Outreach oder Smartlead ab Growth-Plan 99
            USD/Monat).
          </p>
          <p>
            Sendspark ist eine Marke des jeweiligen Inhabers. VIDEOCOMET steht
            in keiner Verbindung zu Sendspark. Dieser Vergleich dient der
            sachlichen Information.
          </p>
        </div>
      </section>

      <MarketingFooter />
    </div>
  );
}
