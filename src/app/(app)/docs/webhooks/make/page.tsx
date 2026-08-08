import Link from "next/link";
import { ArrowLeft, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";

export const metadata = { title: "Make.com einrichten — Doku · VIDEOCOMET" };

export default function MakeDocsPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-10 flex flex-col gap-8">
      <header>
        <Button asChild variant="ghost" size="sm" iconLeft={<ArrowLeft className="size-3.5" />} className="mb-3">
          <Link href="/docs/webhooks">Zurück zur Übersicht</Link>
        </Button>
        <p className="text-xs font-semibold uppercase tracking-wider text-brand-deep">Make.com-Setup</p>
        <h1 className="text-3xl font-bold text-ink mt-1">VIDEOCOMET mit Make.com verbinden</h1>
        <p className="text-ink-muted mt-2">
          Ergebnis: Sobald in VIDEOCOMET etwas passiert (Lead öffnet
          Landingpage, klickt CTA, …), startet automatisch dein Make-Szenario
          und macht damit, was du willst.
        </p>
      </header>

      <Step n={1} title="Neues Szenario in Make anlegen">
        <p>
          Logge dich bei{" "}
          <a
            href="https://make.com"
            target="_blank"
            rel="noopener noreferrer"
            className="text-brand-deep underline"
          >
            make.com
          </a>{" "}
          ein und klicke <strong>„Create a new scenario"</strong>.
        </p>
      </Step>

      <Step n={2} title="Erstes Modul: Custom webhook">
        <p>
          Großen <strong>„+"</strong>-Button anklicken → such nach{" "}
          <strong>„Webhooks"</strong> → wähle <strong>„Custom webhook"</strong>.
        </p>
        <p className="mt-2">
          Im Pop-up: <strong>„Add"</strong> → vergib einen Namen (z.&nbsp;B.
          „VIDEOCOMET"). Make erzeugt jetzt deine eindeutige URL — ähnlich:
        </p>
        <pre className="rounded-squircle-sm bg-surface shadow-card p-3 text-xs font-mono mt-2 overflow-x-auto">
          https://hook.eu2.make.com/abc123def456ghi789
        </pre>
        <p className="mt-2 text-ink-muted text-sm">
          Klick auf <strong>„Copy address to clipboard"</strong>.
        </p>
      </Step>

      <Step n={3} title="In VIDEOCOMET einfügen">
        <p>
          Wechsle in den VIDEOCOMET-Tab → <strong>Einstellungen → Webhooks</strong> →{" "}
          <strong>„Neuer Webhook"</strong>.
        </p>
        <ul className="list-disc list-inside mt-2 space-y-1 text-sm">
          <li>
            <strong>Name:</strong> z.&nbsp;B. „Make — Sheets-Sync"
          </li>
          <li>
            <strong>Ziel-URL:</strong> die kopierte Make-URL einfügen
          </li>
          <li>
            <strong>Wofür?</strong> „Für alle meine Kampagnen" oder eine
            spezifische
          </li>
          <li>
            <strong>Events:</strong> die gewünschten Events anhaken (typisch:{" "}
            <em>Landingpage geöffnet</em>, <em>CTA geklickt</em>)
          </li>
        </ul>
        <p className="mt-3">
          → <strong>„Webhook anlegen"</strong>. Du bekommst ein{" "}
          <strong>Secret</strong> — Copy + speichern (optional für
          Signatur-Verifikation).
        </p>
      </Step>

      <Step n={4} title="Datenstruktur in Make erfassen">
        <p>
          Im Make-Szenario: das Custom-Webhook-Modul wartet jetzt auf den
          ersten Aufruf. Status zeigt:{" "}
          <em>„Successfully determined."</em> oder eine wartende Animation.
        </p>
        <p className="mt-2">
          Zurück bei VIDEOCOMET → in deinem Webhook auf <strong>„Test"</strong>{" "}
          klicken.
        </p>
        <p className="mt-2">
          Bei Make siehst du jetzt:{" "}
          <em>„Successfully determined."</em> ✓ — Make hat unsere Datenstruktur
          gelernt (lead.firstName, lead.email, event.kind, …).
        </p>
      </Step>

      <Step n={5} title="Action-Module hinzufügen">
        <p>
          Klick rechts neben dem Webhook auf den <strong>„+"</strong>-Kreis und
          such dein Ziel-Tool. Beispiele:
        </p>
        <ul className="list-disc list-inside mt-2 space-y-1 text-sm">
          <li>
            <strong>Google Sheets</strong> → „Add a row" → Sheet auswählen →
            Felder von Webhook-Daten mappen (Drag {`{1.data.lead.firstName}`}{" "}
            auf „Vorname"-Spalte, etc.)
          </li>
          <li>
            <strong>Email</strong> → „Send an email" mit dem CTA-Klick als
            Trigger
          </li>
          <li>
            <strong>HubSpot / Pipedrive / Notion / Slack / Telegram / …</strong>{" "}
            — Make hat über 1&nbsp;000 fertige Integrationen
          </li>
        </ul>
      </Step>

      <Step n={6} title="Szenario aktivieren" last>
        <p>
          Unten links das Szenario auf <strong>„ON"</strong> stellen
          („Scheduling" → „Immediately" auswählen für Echtzeit).
        </p>
      </Step>

      <div className="rounded-squircle-md bg-ok-soft/60 p-5">
        <p className="text-sm font-semibold text-ink mb-1 flex items-center gap-2">
          <CheckCircle2 className="size-4 text-ok" /> Fertig!
        </p>
        <p className="text-xs text-ink-muted">
          Ab jetzt landen alle ausgewählten Events live in Make und werden
          automatisch durchverarbeitet.
        </p>
      </div>

      <div className="rounded-squircle-md bg-surface shadow-card p-5">
        <p className="text-sm font-semibold text-ink mb-2">Troubleshooting</p>
        <ul className="text-xs text-ink-muted space-y-1.5">
          <li>
            <strong>Make „Determining data structure" hängt?</strong> →
            VIDEOCOMET → Webhook → „Test" nochmal drücken. Make wartet auf den
            ersten echten Aufruf.
          </li>
          <li>
            <strong>Neue Felder kommen nicht in Mapping an?</strong> →
            Webhook-Modul in Make → „Redetermine data structure" klicken,
            dann nochmal Test feuern.
          </li>
          <li>
            <strong>Webhook deaktiviert?</strong> → Nach 5 fehlgeschlagenen
            Auslieferungen schalten wir ab. Make-Szenario prüfen → bei uns
            „Aktivieren".
          </li>
          <li>
            <strong>Auslieferungs-Logs einsehen:</strong> Webhook → „Mehr" →
            „Auslieferungen ansehen". Hier siehst du jeden Aufruf inkl. HTTP-
            Status, Payload und Response.
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
