import type { Metadata } from "next";
import { Building2, Mail, Phone, ScrollText, Scale, User } from "lucide-react";

export const metadata: Metadata = {
  title: "Impressum",
  description:
    "Impressum der VIDEOCOMET GmbH, Herrleinstr. 39, 97437 Haßfurt. Anbieterkennzeichnung gemäß § 5 DDG.",
  alternates: { canonical: "/impressum" },
};

function InfoCard({
  icon: Icon,
  title,
  children,
}: {
  icon: typeof Building2;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl bg-white border border-line shadow-[0_10px_30px_-18px_rgba(50,35,110,0.18)] p-6">
      <div className="flex items-center gap-2.5 mb-3">
        <div className="size-8 rounded-lg bg-brand-soft flex items-center justify-center">
          <Icon className="size-4 text-brand-deep" strokeWidth={2.2} />
        </div>
        <h2 className="text-[13px] font-semibold tracking-[0.14em] uppercase text-ink-muted">
          {title}
        </h2>
      </div>
      <div className="text-[15px] leading-relaxed text-ink">{children}</div>
    </div>
  );
}

export default function ImpressumPage() {
  return (
    <main className="max-w-3xl mx-auto px-4 py-14 md:py-20">
      <h1 className="text-3xl md:text-4xl font-light tracking-[-0.03em] text-ink mb-2">
        Impressum
      </h1>
      <p className="text-sm text-ink-muted mb-10">
        Anbieterkennzeichnung gemäß § 5 DDG
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <InfoCard icon={Building2} title="Anbieter">
          <p className="font-semibold">VIDEOCOMET GmbH</p>
          <p>
            Herrleinstr. 39
            <br />
            97437 Haßfurt
            <br />
            Deutschland
          </p>
        </InfoCard>

        <InfoCard icon={User} title="Vertreten durch">
          <p>
            Geschäftsführer:
            <br />
            <span className="font-semibold">Daniel Kurzeja</span>
          </p>
        </InfoCard>

        <InfoCard icon={Phone} title="Kontakt">
          <p>
            Telefon:{" "}
            <a
              href="tel:+4915151005561"
              className="text-brand-deep hover:underline"
            >
              +49 151 51005561
            </a>
          </p>
          <p>
            E-Mail:{" "}
            <a
              href="mailto:info@videocomet.de"
              className="text-brand-deep hover:underline"
            >
              info@videocomet.de
            </a>
          </p>
        </InfoCard>

        <InfoCard icon={ScrollText} title="Registereintrag">
          <p>
            Amtsgericht Schweinfurt
            <br />
            Registernummer: <span className="font-semibold">HRB 9217</span>
          </p>
        </InfoCard>

        <InfoCard icon={Mail} title="Umsatzsteuer">
          <p>
            USt-IdNr. gemäß § 27a UStG:
            <br />
            <span className="font-semibold">DE362734064</span>
          </p>
          <p className="text-ink-muted text-sm mt-1">
            Steuernummer: 249/141/40389
          </p>
        </InfoCard>

        <InfoCard icon={User} title="Inhaltlich verantwortlich">
          <p className="text-sm text-ink-muted mb-1">§ 18 Abs. 2 MStV</p>
          <p>
            <span className="font-semibold">Daniel Kurzeja</span>
            <br />
            Herrleinstr. 39, 97437 Haßfurt
          </p>
        </InfoCard>
      </div>

      <div className="mt-4 rounded-2xl bg-white border border-line shadow-[0_10px_30px_-18px_rgba(50,35,110,0.18)] p-6">
        <div className="flex items-center gap-2.5 mb-3">
          <div className="size-8 rounded-lg bg-brand-soft flex items-center justify-center">
            <Scale className="size-4 text-brand-deep" strokeWidth={2.2} />
          </div>
          <h2 className="text-[13px] font-semibold tracking-[0.14em] uppercase text-ink-muted">
            Streitbeilegung
          </h2>
        </div>
        <div className="text-[15px] leading-relaxed text-ink space-y-3">
          <p>
            Die Europäische Kommission stellt eine Plattform zur
            Online-Streitbeilegung (OS) bereit:{" "}
            <a
              href="https://ec.europa.eu/consumers/odr/"
              target="_blank"
              rel="noopener noreferrer"
              className="text-brand-deep hover:underline"
            >
              ec.europa.eu/consumers/odr
            </a>
          </p>
          <p className="text-ink-muted text-sm">
            Wir sind nicht bereit oder verpflichtet, an einem
            Streitbeilegungsverfahren vor einer
            Verbraucherschlichtungsstelle teilzunehmen.
          </p>
        </div>
      </div>

      <div className="mt-8 text-[13px] leading-relaxed text-ink-muted">
        <h2 className="text-[13px] font-semibold tracking-[0.14em] uppercase mb-2">
          Haftungsausschluss
        </h2>
        <p>
          Die Inhalte dieser Website wurden mit größtmöglicher Sorgfalt
          erstellt. Für die Richtigkeit, Vollständigkeit und Aktualität der
          Inhalte kann jedoch keine Gewähr übernommen werden. Externe Links
          wurden zum Zeitpunkt der Verlinkung auf mögliche Rechtsverstöße
          überprüft. Auf spätere Änderungen der verlinkten Inhalte haben wir
          keinen Einfluss.
        </p>
      </div>
    </main>
  );
}
