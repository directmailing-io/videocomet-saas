import type { Metadata } from "next";
import Link from "next/link";
import {
  Check,
  Clock,
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
  title: "Loom Alternative für die Kundengewinnung | VIDEOCOMET",
  description:
    "Loom Vergleich für Vertrieb und Akquise: Loom nimmt jedes Video einzeln auf. VIDEOCOMET macht aus einer Aufnahme persönliche Videos für jeden Wunschkunden, mit Brief, Landingpage und Tracking.",
  keywords: [
    "Loom Alternative",
    "Loom Vergleich",
    "Loom Vertrieb",
    "personalisierte Videos",
    "Video-Akquise",
    "VIDEOCOMET",
  ],
  alternates: { canonical: "/vergleich-mit-loom" },
  openGraph: {
    title: "Loom Alternative für die Kundengewinnung",
    description:
      "Loom ist super für Team-Videos. Für Akquise in Serie ist es nicht gebaut: Jedes Video muss einzeln aufgenommen werden. VIDEOCOMET personalisiert aus einer Aufnahme, mit Brief, Landingpage und Tracking.",
    url: "https://videocomet.de/vergleich-mit-loom",
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
    question: "Wofür ist das Tool eigentlich gebaut?",
    intro:
      "Das ist die wichtigste Frage. Denn Loom und VIDEOCOMET lösen zwei verschiedene Aufgaben.",
    videocomet: [
      "VIDEOCOMET ist für die Kundengewinnung gebaut: Du nimmst einmal auf, und jeder Wunschkunde bekommt sein persönliches Video.",
      "Dazu gehört alles, was Akquise braucht: Begrüßung mit Namen, seine Website im Video, eigene Landingpage, Brief mit QR-Code oder E-Mail, genaues Tracking.",
    ],
    competitor: [
      "Loom ist ein Bildschirm-Rekorder für die Arbeit im Team: schnelle Erklärvideos, Updates, Feedback.¹",
      "Dafür ist Loom richtig gut. Aber es personalisiert nichts: Jedes Video zeigt genau das, was du einmal aufgenommen hast.",
    ],
    meaning:
      "Mit einem Werkzeug, das für etwas anderes gebaut wurde, wird Akquise zäh. Du merkst es spätestens, wenn aus 5 Wunschkunden 50 werden. Nimm das Werkzeug, das für deine Aufgabe gemacht ist.",
  },
  {
    icon: Clock,
    question: "Wie viele persönliche Videos schaffst du damit?",
    intro:
      "Persönlich wirkt nur, was wirklich für den Empfänger gemacht ist. Die Frage ist, was dich das an Zeit kostet.",
    videocomet: [
      "Du nimmst ein einziges Video auf. VIDEOCOMET macht daraus für jeden Wunschkunden eine persönliche Version.",
      "100 Wunschkunden? 1.000? Der Aufwand für dich bleibt gleich: eine Aufnahme.",
      "Deine beste Aufnahme geht an alle. Kein müder Take Nummer 40 am Nachmittag.",
    ],
    competitor: [
      "Bei Loom heißt persönlich: selbst aufnehmen. Für jeden Wunschkunden ein eigenes Video, eins nach dem anderen.",
      "Bei 100 Wunschkunden sind das 100 einzelne Aufnahmen. Das kostet Tage, nicht Minuten.",
      "Oder du schickst allen dasselbe Video. Dann ist es nicht mehr persönlich, und man merkt es.",
    ],
    meaning:
      "Deine Zeit ist das Teuerste an deiner Akquise. Entweder du verbringst sie mit Aufnehmen, oder mit dem, was Geld bringt: Gespräche führen und Angebote schreiben. VIDEOCOMET nimmt dir den Aufnahme-Marathon ab.",
  },
  {
    icon: Volume2,
    question: "Ist jedes Video wirklich persönlich?",
    intro:
      "Der Name und die eigene Website: Das sind die zwei Momente, in denen dein Wunschkunde merkt, dass es um ihn geht.",
    videocomet: [
      "Die KI-Begrüßung spricht jeden Wunschkunden mit Namen an: „Hey Marcel …“. In deiner eigenen Stimme, mit passender Lippenbewegung.",
      "Die Website deines Wunschkunden wird echt im Browser gescrollt, mit sichtbarem Mauszeiger. Mitten im Video, so lange du willst.",
      "Auch personalisierte Präsentationen sind möglich: PowerPoint, Google Docs oder PDF mit seinen Daten.",
    ],
    competitor: [
      "Loom kann Namen nicht automatisch einsetzen. Der Name fällt nur, wenn du ihn in jeder einzelnen Aufnahme selbst sagst.",
      "Die Website des Empfängers erscheint nur, wenn du sie bei jeder Aufnahme selbst öffnest und durchscrollst.",
      "Automatisch personalisieren kann Loom nicht.",
    ],
    meaning:
      "Wer seinen Namen hört und seine eigene Website sieht, denkt: Da hat sich jemand wirklich mit mir beschäftigt. Bei VIDEOCOMET bekommt jeder Wunschkunde dieses Gefühl, ohne dass du jedes Video einzeln aufnimmst.",
  },
  {
    icon: Mail,
    question: "Wie kommt das Video zum Wunschkunden?",
    intro:
      "Aufnehmen ist die halbe Arbeit. Die andere Hälfte: das Video so zustellen, dass es gesehen wird.",
    videocomet: [
      "Unsere Spezialität ist der Brief: VIDEOCOMET erstellt einen fertigen Brief mit QR-Code samt Umschlag. Post landet nicht im Spam-Ordner und wird fast immer geöffnet.",
      "Du bist aber frei: E-Mail-Versand ist genauso eingebaut. Du wählst pro Kampagne, was zu dir passt.",
      "Jeder Wunschkunde bekommt eine eigene Landingpage in deinem Design. Und du siehst genau, wer geschaut hat und wie lange.",
    ],
    competitor: [
      "Bei Loom kopierst du einen Link und verschickst ihn selbst. Für den Versand in Serie brauchst du zusätzliche Tools.",
      "Einen Brief mit QR-Code gibt es nicht. Eine eigene Landingpage pro Wunschkunde auch nicht.",
      "Wer kalt angeschrieben wird, klickt einen nackten Video-Link nur selten an.",
    ],
    meaning:
      "Ein starkes Video, das im Spam-Ordner liegt, ist ein verlorenes Video. Mit dem Brief erreichst du deine Wunschkunden auf einem Weg, den kaum ein Wettbewerber nutzt. Und du weißt jederzeit, bei wem sich ein Anruf gerade wirklich lohnt.",
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
      "Loom gehört zum US-Konzern Atlassian. Bedienung, Hilfe und Support auf Englisch.",
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
                Loom
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

export default function VergleichMitLoomPage() {
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
              Die Loom Alternative für die Kundengewinnung.{" "}
              <span className="font-semibold text-brand-deep">
                Zwei Tools, zwei Aufgaben.
              </span>
            </h1>
            <p className="mt-5 max-w-2xl text-base sm:text-lg text-ink-soft leading-relaxed">
              Fast jeder kennt Loom. Viele unserer Kunden haben damit ihre
              ersten Verkaufsvideos aufgenommen. Und dabei gemerkt: Für 5
              Videos ist Loom super. Für 50 oder 500 Wunschkunden nicht, denn
              jedes Video muss einzeln aufgenommen werden. Was das genau
              bedeutet und wo der Unterschied zu VIDEOCOMET liegt, zeigen wir
              dir hier. Ohne Fachchinesisch.
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
                Loom ist ein Bildschirm-Rekorder: gut für schnelle Videos im
                Team, aber jedes Video zeigt für alle dasselbe. VIDEOCOMET ist
                für die Kundengewinnung gebaut: Du nimmst einmal auf, und jeder
                Wunschkunde bekommt sein eigenes Video. Mit seinem Namen, mit
                seiner Website, mit eigener Landingpage. Zugestellt als Brief
                mit QR-Code, unsere Spezialität, denn Post wird fast immer
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
            Stand: 26. August 2026. Alle Angaben zu Loom nach bestem Wissen,
            recherchiert auf den öffentlichen Seiten des Anbieters.
          </p>
          <p>
            ¹ Quelle: loom.com und atlassian.com (Produktbeschreibung als
            Screen-Recording-Tool für Team-Kommunikation, Preise in
            US-Dollar).
          </p>
          <p>
            Loom ist eine Marke des jeweiligen Inhabers (Atlassian).
            VIDEOCOMET steht in keiner Verbindung zu Loom oder Atlassian.
            Dieser Vergleich dient der sachlichen Information.
          </p>
        </div>
      </section>

      <MarketingFooter />
    </div>
  );
}
