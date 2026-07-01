export const metadata = { title: "AGB — VIDEOCOMET" };

/**
 * AGB fuer B2B-only SaaS mit monatlichem Abo + Credit-Verbrauch.
 * Diese Basis-Version ist als Template gedacht — vor Live-Rollout durch
 * einen Fachanwalt pruefen lassen (insb. §307 BGB Inhaltskontrolle bei
 * Klauseln zur Preisanpassung, Haftungsbegrenzung, Kuendigung).
 */

export default function AgbPage() {
  return (
    <main className="max-w-3xl mx-auto px-4 py-16 prose prose-sm">
      <h1>Allgemeine Geschäftsbedingungen</h1>
      <p className="text-ink-muted text-xs">Stand: Juli 2026</p>

      <h2>§ 1 Geltungsbereich</h2>
      <p>
        Diese Allgemeinen Geschäftsbedingungen (AGB) gelten für alle Verträge
        zwischen VIDEOCOMET (nachfolgend „Anbieter") und Unternehmern im Sinne
        des § 14 BGB (nachfolgend „Kunde") über die Nutzung der VIDEOCOMET-
        Plattform (nachfolgend „Dienst").
      </p>
      <p>
        Der Dienst richtet sich ausschließlich an Unternehmer. Ein Vertragsschluss
        mit Verbrauchern (§ 13 BGB) ist ausgeschlossen.
      </p>

      <h2>§ 2 Leistungsbeschreibung</h2>
      <p>
        Der Anbieter stellt eine cloudbasierte Software zur Verfügung, mit der
        Kunden personalisierte Outreach-Videos generieren und ihren Kontakten
        zusenden können. Der Funktionsumfang ergibt sich aus der Produkt-
        beschreibung auf der Website des Anbieters zum Zeitpunkt des
        Vertragsschlusses.
      </p>

      <h2>§ 3 Vertragsschluss</h2>
      <p>
        Die Darstellung des Dienstes stellt kein bindendes Angebot dar. Erst
        die kostenpflichtige Bestellung durch den Kunden über das Signup-
        Formular ist ein Angebot im Rechtssinne. Der Vertrag kommt mit der
        erfolgreichen Zahlungsabwicklung durch den Zahlungsdienstleister
        (Stripe Payments Europe, Ltd.) zustande.
      </p>

      <h2>§ 4 Vergütung und Zahlungsbedingungen</h2>
      <p>
        Die Vergütung beträgt für den Plattform-Zugang <strong>40,00 € netto pro
        Monat</strong> zzgl. der gesetzlichen Umsatzsteuer.
      </p>
      <p>
        Zusätzlich benötigt der Kunde für jede erzeugte Video-Generierung
        einen Credit. 1 Credit = 1,00 € netto. Credits werden als
        Vorauszahlungen erworben und verfallen nicht.
      </p>
      <p>
        Die monatliche Abrechnung erfolgt jeweils zum Beginn des Nutzungs-
        monats über Stripe. Credits werden bei Bestellung sofort in Rechnung
        gestellt.
      </p>

      <h2>§ 5 Vertragslaufzeit und Kündigung</h2>
      <p>
        Der Vertrag über den Plattform-Zugang läuft <strong>monatlich</strong>
        und verlängert sich automatisch um jeweils einen Monat, sofern er
        nicht mit einer Frist von einem Werktag zum Monatsende gekündigt wird.
      </p>
      <p>
        Die Kündigung erfolgt einfach über die Kontoeinstellungen oder das
        von Stripe bereitgestellte Kundenportal. Eine Kündigung per E-Mail ist
        ebenfalls möglich.
      </p>
      <p>
        Das Recht zur außerordentlichen fristlosen Kündigung bleibt unberührt.
      </p>

      <h2>§ 6 Zahlungsverzug und Sperre des Zugangs</h2>
      <p>
        Kommt der Kunde mit einer fälligen Zahlung in Verzug, ist der Anbieter
        berechtigt, den Zugang zur Plattform bis zur vollständigen Zahlung zu
        sperren. Die im Kundenkonto hinterlegten Daten bleiben davon
        unberührt und stehen dem Kunden nach Wiederherstellung des Zugangs
        wieder zur Verfügung.
      </p>

      <h2>§ 7 Rechtseinräumung; Beschränkte Nutzung</h2>
      <p>
        Der Kunde erhält für die Dauer des Vertrags ein einfaches, nicht
        übertragbares Nutzungsrecht an der Software. Eine Unterlizenzierung
        ist nicht gestattet.
      </p>

      <h2>§ 8 Verfügbarkeit</h2>
      <p>
        Der Anbieter bemüht sich um eine Verfügbarkeit von mindestens 98 %
        im Jahresmittel. Nicht in die Verfügbarkeitsberechnung eingerechnet
        werden geplante Wartungsarbeiten sowie Ausfälle, die auf höhere
        Gewalt oder Dritte zurückzuführen sind.
      </p>

      <h2>§ 9 Haftung</h2>
      <p>
        Der Anbieter haftet unbeschränkt bei Vorsatz und grober Fahrlässigkeit
        sowie bei Verletzung von Leben, Körper und Gesundheit. Für leicht
        fahrlässige Verletzung wesentlicher Vertragspflichten haftet der
        Anbieter nur begrenzt auf den vertragstypisch vorhersehbaren Schaden.
        Für sonstige leicht fahrlässige Pflichtverletzungen ist die Haftung
        ausgeschlossen.
      </p>

      <h2>§ 10 Datenschutz</h2>
      <p>
        Für die Verarbeitung personenbezogener Daten gilt die{" "}
        <a href="/datenschutz">Datenschutzerklärung</a>. Sofern der Kunde
        personenbezogene Daten Dritter (z. B. Empfänger seiner Outreach-Videos)
        über die Plattform verarbeitet, ist er hierfür datenschutzrechtlich
        allein verantwortlich. Auf Anfrage schließt der Anbieter einen
        Auftragsverarbeitungsvertrag (AVV) nach Art. 28 DSGVO ab.
      </p>

      <h2>§ 11 Schlussbestimmungen</h2>
      <p>
        Es gilt deutsches Recht unter Ausschluss des UN-Kaufrechts.
        Ausschließlicher Gerichtsstand ist der Sitz des Anbieters, sofern
        der Kunde Kaufmann, juristische Person des öffentlichen Rechts oder
        öffentlich-rechtliches Sondervermögen ist.
      </p>
      <p>
        Sollte eine Bestimmung dieser AGB unwirksam sein oder werden, so
        bleibt die Wirksamkeit der übrigen Bestimmungen davon unberührt.
      </p>
    </main>
  );
}
