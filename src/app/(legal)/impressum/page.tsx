export const metadata = { title: "Impressum — VIDEOCOMET" };

/**
 * Impressum gemäß § 5 TMG.
 *
 * Placeholder für Adresse + Kontaktdaten. User (Daniel Kurzeja) muss noch
 * seine echten Angaben liefern. Wir zeigen aktuell nur den Namen. Für
 * einen Live-Launch fehlen noch: postalische Adresse, Telefon, USt-IdNr.
 * (falls vorhanden).
 */
export default function ImpressumPage() {
  return (
    <main className="max-w-3xl mx-auto px-4 py-16 prose prose-sm">
      <h1>Impressum</h1>

      <h2>Anbieter</h2>
      <p>
        <strong>Daniel Kurzeja</strong>
      </p>

      <h2>Kontakt</h2>
      <p>
        E-Mail:{" "}
        <a href="mailto:support@videocomet.de">support@videocomet.de</a>
      </p>

      <h2>Verantwortlich für den Inhalt nach § 18 Abs. 2 MStV</h2>
      <p>Daniel Kurzeja, Anschrift wie oben.</p>

      <h2>Streitbeilegung</h2>
      <p>
        Die Europäische Kommission stellt eine Plattform zur
        Online-Streitbeilegung (OS) bereit:{" "}
        <a
          href="https://ec.europa.eu/consumers/odr/"
          target="_blank"
          rel="noopener noreferrer"
        >
          ec.europa.eu/consumers/odr
        </a>
      </p>
      <p>
        Wir sind nicht bereit oder verpflichtet, an einem
        Streitbeilegungsverfahren vor einer Verbraucherschlichtungsstelle
        teilzunehmen.
      </p>

      <h2>Haftungsausschluss</h2>
      <p>
        Die Inhalte dieser Website wurden mit größtmöglicher Sorgfalt
        erstellt. Für die Richtigkeit, Vollständigkeit und Aktualität der
        Inhalte kann jedoch keine Gewähr übernommen werden. Externe Links
        wurden zum Zeitpunkt der Verlinkung auf mögliche Rechtsverstöße
        überprüft. Auf spätere Änderungen der verlinkten Inhalte haben
        wir keinen Einfluss.
      </p>
    </main>
  );
}
