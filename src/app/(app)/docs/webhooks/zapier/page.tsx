import Link from "next/link";
import { ArrowLeft, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";

export const metadata = { title: "Zapier einrichten — Doku · VideoComet" };

export default function ZapierDocsPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-10 flex flex-col gap-8">
      <header>
        <Button asChild variant="ghost" size="sm" iconLeft={<ArrowLeft className="size-3.5" />} className="mb-3">
          <Link href="/docs/webhooks">Zurück zur Übersicht</Link>
        </Button>
        <p className="text-xs font-semibold uppercase tracking-wider text-brand-deep">Zapier-Setup</p>
        <h1 className="text-3xl font-bold text-ink mt-1">VideoComet mit Zapier verbinden</h1>
        <p className="text-ink-muted mt-2">
          Ergebnis: Sobald ein Lead deine Landingpage öffnet oder den CTA
          klickt, kannst du es in Zapier weiterverarbeiten — z.&nbsp;B.
          Slack-Nachricht senden, Google-Sheet befüllen, beliebigen CRM-
          Eintrag anlegen.
        </p>
      </header>

      <Step n={1} title="Zap in Zapier anlegen">
        <p>
          Logge dich bei{" "}
          <a
            href="https://zapier.com"
            target="_blank"
            rel="noopener noreferrer"
            className="text-brand-deep underline"
          >
            zapier.com
          </a>{" "}
          ein und klicke auf <strong>„Create Zap"</strong>.
        </p>
      </Step>

      <Step n={2} title="Trigger auswählen: Webhooks by Zapier">
        <p>
          Im Trigger-Schritt suche nach <strong>„Webhooks by Zapier"</strong>{" "}
          und wähle es aus.
        </p>
        <p className="mt-2">
          Event: <strong>„Catch Hook"</strong> → „Continue".
        </p>
      </Step>

      <Step n={3} title="Webhook-URL kopieren">
        <p>
          Zapier zeigt dir jetzt eine URL ähnlich wie:
        </p>
        <pre className="rounded-squircle-sm border border-line bg-surface-soft p-3 text-xs font-mono mt-2 overflow-x-auto">
          https://hooks.zapier.com/hooks/catch/12345678/abcdefg/
        </pre>
        <p className="mt-2 text-ink-muted text-sm">
          Klick auf <strong>„Copy"</strong> daneben. Diese URL ist gleich
          wichtig.
        </p>
      </Step>

      <Step n={4} title="In VideoComet einfügen">
        <p>
          Wechsle in den VideoComet-Tab → <strong>Einstellungen → Webhooks</strong> →{" "}
          <strong>„Neuer Webhook"</strong>.
        </p>
        <ul className="list-disc list-inside mt-2 space-y-1 text-sm">
          <li>
            <strong>Name:</strong> z.&nbsp;B. „Zapier — Slack-Benachrichtigung"
          </li>
          <li>
            <strong>Ziel-URL:</strong> die kopierte Zapier-URL einfügen
          </li>
          <li>
            <strong>Wofür?</strong> „Für alle meine Kampagnen" oder eine
            spezifische auswählen
          </li>
          <li>
            <strong>Events:</strong> haken die Events ab, die du in Zapier
            verarbeiten willst (typisch:{" "}
            <em>Landingpage geöffnet</em> + <em>CTA geklickt</em>)
          </li>
        </ul>
        <p className="mt-3">
          → <strong>„Webhook anlegen"</strong>. Du bekommst ein{" "}
          <strong>Secret</strong> angezeigt — Copy + speichern (optional, nur
          für Production-Signatur-Verifikation).
        </p>
      </Step>

      <Step n={5} title="Test-Daten an Zapier schicken">
        <p>
          Im VideoComet-Webhook → <strong>„Test"</strong> klicken. Du siehst
          „Erfolgreich (HTTP 200)".
        </p>
        <p className="mt-2">
          Zurück bei Zapier: klick auf <strong>„Test trigger"</strong> →
          Zapier zeigt jetzt die Beispiel-Daten von uns (firstName, email,
          pageUrl, …).
        </p>
      </Step>

      <Step n={6} title="Action in Zapier konfigurieren">
        <p>
          Das ist der „Was-soll-passieren"-Schritt — komplett bei dir.
          Beispiele:
        </p>
        <ul className="list-disc list-inside mt-2 space-y-1 text-sm">
          <li>
            <strong>Slack</strong>: Neue Nachricht in Channel #leads:
            „{`{{firstName}} {{lastName}}`} hat die Landingpage geöffnet."
          </li>
          <li>
            <strong>Google Sheets</strong>: Neue Zeile mit E-Mail, Zeitpunkt,
            URL.
          </li>
          <li>
            <strong>Pipedrive / Salesforce / Notion / …</strong>: Datensatz
            anlegen oder aktualisieren.
          </li>
        </ul>
      </Step>

      <Step n={7} title="Zap einschalten" last>
        <p>
          Oben rechts den Schalter umlegen → <strong>„Publish Zap"</strong>.
          Ab jetzt fließen alle echten Lead-Events live in dein Tool.
        </p>
      </Step>

      <div className="rounded-squircle-md border border-ok/30 bg-ok-soft/40 p-5">
        <p className="text-sm font-semibold text-ink mb-1 flex items-center gap-2">
          <CheckCircle2 className="size-4 text-ok" /> Fertig!
        </p>
        <p className="text-xs text-ink-muted">
          Wenn jemand jetzt deine Landingpage öffnet, sieht Zapier das
          innerhalb von Sekunden und löst deine Action aus.
        </p>
      </div>

      <div className="rounded-squircle-md border border-line bg-surface p-5">
        <p className="text-sm font-semibold text-ink mb-2">Troubleshooting</p>
        <ul className="text-xs text-ink-muted space-y-1.5">
          <li>
            <strong>Zapier sieht keine Daten?</strong> → VideoComet-Webhook
            öffnen → „Auslieferungen ansehen" → prüfen ob unsere Calls 200
            zurückbekommen.
          </li>
          <li>
            <strong>Webhook auto-deaktiviert?</strong> → Nach 5 fehlgeschlagenen
            Auslieferungen schalten wir den Endpoint ab. Zapier-Zap wieder
            aktivieren + bei uns „Aktivieren".
          </li>
          <li>
            <strong>Daten falsch?</strong> → Ein neuer Trigger-Test in Zapier
            holt die aktuellen Felder neu („Re-test trigger").
          </li>
        </ul>
      </div>
    </div>
  );
}

function Step({
  n,
  title,
  children,
  last,
}: {
  n: number;
  title: string;
  children: React.ReactNode;
  last?: boolean;
}) {
  return (
    <div className="flex gap-4">
      <div className="flex flex-col items-center shrink-0">
        <div className="flex size-8 items-center justify-center rounded-full bg-brand text-white text-sm font-semibold shadow-brand">
          {n}
        </div>
        {!last && <div className="w-px flex-1 bg-line mt-2" />}
      </div>
      <div className="flex-1 pb-2">
        <p className="text-base font-semibold text-ink mb-2">{title}</p>
        <div className="text-sm text-ink leading-relaxed">{children}</div>
      </div>
    </div>
  );
}
