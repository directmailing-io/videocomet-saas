export const metadata = { title: "Impressum — VIDEOCOMET" };

/**
 * Impressum-Template gemäß § 5 TMG.
 *
 * WICHTIG: Vor Live-Rollout die Betreiber-Daten (Firma, Adresse, Telefon,
 * Handelsregister, USt-IdNr., Verantwortliche Person) ausfuellen. Ohne
 * ordnungsgemaesses Impressum drohen Abmahnungen (§ 5 TMG).
 */
export default function ImpressumPage() {
  return (
    <main className="max-w-3xl mx-auto px-4 py-16 prose prose-sm">
      <h1>Impressum</h1>

      <h2>Anbieter</h2>
      <p>
        <strong>[BETREIBER-VOLLNAME EINTRAGEN]</strong>
        <br />
        [STRASSE + HAUSNUMMER]
        <br />
        [PLZ + ORT]
        <br />
        Deutschland
      </p>

      <h2>Kontakt</h2>
      <p>
        Telefon: [TELEFON]
        <br />
        E-Mail:{" "}
        <a href="mailto:support@videocomet.de">support@videocomet.de</a>
      </p>

      <h2>Umsatzsteuer</h2>
      <p>
        Umsatzsteuer-Identifikationsnummer gemäß § 27a UStG:
        <br />
        <strong>[USt-IdNr. eintragen]</strong>
      </p>

      <h2>Handelsregister</h2>
      <p>
        Eingetragen im Handelsregister: [Amtsgericht + HRB-Nummer]
        <br />
        [nur bei Kapitalgesellschaften anzugeben]
      </p>

      <h2>Verantwortlich für den Inhalt nach § 18 Abs. 2 MStV</h2>
      <p>
        [VERANTWORTLICHE PERSON]
        <br />
        [Anschrift wie oben]
      </p>

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
        überprüft; auf spätere Änderungen der verlinkten Inhalte haben
        wir keinen Einfluss.
      </p>
    </main>
  );
}
