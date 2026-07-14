export const metadata = { title: "Datenschutz — VIDEOCOMET" };

/**
 * Datenschutz-Erklaerung Basis-Template.
 * Muss vor Live-Rollout durch einen Datenschutzbeauftragten geprueft
 * werden (v.a. Auftragsverarbeiter-Liste + internationale Uebermittlung).
 */
export default function DatenschutzPage() {
  return (
    <main className="max-w-3xl mx-auto px-4 py-16 prose prose-sm">
      <h1>Datenschutzerklärung</h1>
      <p className="text-ink-muted text-xs">Stand: Juli 2026</p>

      <h2>1. Verantwortlicher</h2>
      <p>
        Verantwortlicher im Sinne der Datenschutz-Grundverordnung (DSGVO) ist:
      </p>
      <p>
        VIDEOCOMET GmbH
        <br />
        Herrleinstr. 39
        <br />
        97437 Haßfurt
        <br />
        Deutschland
        <br />
        Vertreten durch den Geschäftsführer Daniel Kurzeja
        <br />
        E-Mail: <a href="mailto:info@videocomet.de">info@videocomet.de</a>
      </p>
      <p>
        Weitere Angaben finden Sie im <a href="/impressum">Impressum</a>.
      </p>

      <h2>2. Verarbeitete Daten</h2>
      <p>
        Wir verarbeiten die folgenden Kategorien personenbezogener Daten:
      </p>
      <ul>
        <li>Registrierungsdaten (E-Mail, Passwort-Hash, Vor- und Nachname,
          Firmenname, USt-IdNr.)</li>
        <li>Rechnungsdaten (Firmenanschrift, USt-IdNr., Zahlungsmethode
          — verarbeitet ausschließlich durch Stripe Payments Europe Ltd.)</li>
        <li>Nutzungsdaten (Login-Zeitpunkte, IP-Adressen — Speicherung
          für Sicherheits-Audit-Zwecke, 30 Tage)</li>
        <li>Vom Kunden hochgeladene Inhalte (CSV-Empfängerlisten,
          Video-Aufnahmen, Templates) — Verarbeitung im Auftrag des Kunden
          gemäß § 11 AGB</li>
      </ul>

      <h2>3. Rechtsgrundlagen</h2>
      <p>
        Die Verarbeitung erfolgt auf Grundlage von Art. 6 Abs. 1 lit. b DSGVO
        (Vertragserfüllung) sowie Art. 6 Abs. 1 lit. f DSGVO (berechtigte
        Interessen an sicherem Betrieb der Plattform).
      </p>

      <h2>4. Auftragsverarbeiter</h2>
      <p>
        Wir setzen die folgenden Dienstleister ein, die im Auftrag des
        Verantwortlichen personenbezogene Daten verarbeiten:
      </p>
      <ul>
        <li><strong>Stripe Payments Europe, Ltd.</strong> (Irland) — Zahlungsabwicklung + Rechnungserstellung</li>
        <li><strong>Hetzner Online GmbH</strong> (Deutschland) — Server-Hosting</li>
        <li><strong>Bunny.net</strong> (Slowenien) — CDN + Media-Streaming</li>
        <li><strong>Google LLC</strong> (USA) — Google Docs API für Brief-Rendering (nur bei aktiviertem Feature; EU-Standardvertragsklauseln)</li>
        <li><strong>Resend, Inc.</strong> (USA) — Transaktions-E-Mail-Versand (Login-Links, Rechnungen)</li>
      </ul>
      <p>
        Mit allen Auftragsverarbeitern bestehen Verträge gemäß Art. 28 DSGVO.
        Bei US-Anbietern erfolgt die Übermittlung auf Basis von
        EU-Standardvertragsklauseln + Zusatzmaßnahmen.
      </p>

      <h2>5. Speicherdauer</h2>
      <p>
        Wir speichern personenbezogene Daten nur so lange, wie es für den
        Zweck der Verarbeitung erforderlich ist oder gesetzliche
        Aufbewahrungspflichten (§ 147 AO — 10 Jahre für Rechnungen)
        bestehen. Kontoinhaber-Daten werden nach Vertragsende und Ablauf
        aller Aufbewahrungsfristen gelöscht.
      </p>

      <h2>6. Rechte der betroffenen Personen</h2>
      <p>
        Sie haben das Recht auf Auskunft (Art. 15), Berichtigung (Art. 16),
        Löschung (Art. 17), Einschränkung der Verarbeitung (Art. 18),
        Datenübertragbarkeit (Art. 20) sowie Widerspruch (Art. 21) und
        Beschwerde bei einer Aufsichtsbehörde (Art. 77 DSGVO).
      </p>
      <p>
        Für Anfragen wenden Sie sich bitte an{" "}
        <a href="mailto:info@videocomet.de">info@videocomet.de</a>.
      </p>

      <h2>7. Cookies</h2>
      <p>
        Wir setzen ausschließlich technisch notwendige Cookies ein
        (Login-Session-Cookie, Sicherheits-Cookies). Diese Cookies sind
        für den Betrieb der Plattform erforderlich und benötigen nach
        § 25 Abs. 2 Nr. 2 TTDSG keine Einwilligung.
      </p>

      <h2>8. Sicherheit</h2>
      <p>
        Wir treffen technische und organisatorische Maßnahmen nach
        Art. 32 DSGVO. Passwörter werden ausschließlich als Argon2id-Hash
        gespeichert. Der Zugriff auf produktive Datenbanken ist auf einen
        begrenzten Personenkreis beschränkt und protokolliert.
      </p>
    </main>
  );
}
