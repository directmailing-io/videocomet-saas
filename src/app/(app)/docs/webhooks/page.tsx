import Link from "next/link";
import { ArrowRight, Globe, Lock, Repeat2, Zap } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export const metadata = { title: "Webhooks — Doku · VIDEOCOMET" };

export default function WebhooksDocsPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-10 flex flex-col gap-8">
      <header>
        <p className="text-xs font-semibold uppercase tracking-wider text-brand-deep">
          Doku
        </p>
        <h1 className="text-3xl font-bold text-ink mt-1">Webhooks</h1>
        <p className="text-ink-muted mt-2">
          Schicke jedes Lead- und Run-Event aus VIDEOCOMET automatisch an
          dein eigenes Tool — egal ob Zapier, Make.com, n8n oder eine
          eigene API.
        </p>
      </header>

      <section>
        <h2 className="text-lg font-semibold text-ink mb-3">In 3 Minuten startklar</h2>
        <div className="grid sm:grid-cols-2 gap-4">
          <Card hover>
            <CardContent className="p-5">
              <p className="font-semibold text-ink">Zapier</p>
              <p className="text-xs text-ink-muted mt-1">
                Verbinde mit 7&nbsp;000+ Tools über Zapier.
              </p>
              <Button asChild variant="ghost" size="sm" className="mt-3" iconRight={<ArrowRight className="size-3.5" />}>
                <Link href="/docs/webhooks/zapier">Anleitung öffnen</Link>
              </Button>
            </CardContent>
          </Card>
          <Card hover>
            <CardContent className="p-5">
              <p className="font-semibold text-ink">Make.com</p>
              <p className="text-xs text-ink-muted mt-1">
                Visual-Workflow-Builder mit Tausenden Integrationen.
              </p>
              <Button asChild variant="ghost" size="sm" className="mt-3" iconRight={<ArrowRight className="size-3.5" />}>
                <Link href="/docs/webhooks/make">Anleitung öffnen</Link>
              </Button>
            </CardContent>
          </Card>
        </div>
      </section>

      <section>
        <h2 className="text-lg font-semibold text-ink mb-3">Was sind Webhooks?</h2>
        <p className="text-ink leading-relaxed">
          Ein Webhook ist eine URL, die <strong>du irgendwo erstellst</strong>{" "}
          (z.&nbsp;B. in Zapier oder Make). Sobald in VIDEOCOMET etwas
          passiert — ein Lead öffnet seine Landingpage, klickt auf den CTA
          oder startet das Video — schicken wir{" "}
          <strong>sofort eine kleine Nachricht (JSON) an deine URL</strong>.
          Dein Tool reagiert dann und macht damit, was du willst: Eintrag in
          Google Sheets, Nachricht in Slack, neuer Datensatz in deinem CRM,
          E-Mail an dich, …
        </p>
      </section>

      <section>
        <h2 className="text-lg font-semibold text-ink mb-3">Welche Events gibt es?</h2>
        <ul className="space-y-2.5">
          {[
            ["Landingpage geöffnet", "lead.opened", "Jemand hat die personalisierte Landingpage aufgerufen."],
            ["Video gestartet", "lead.video_played", "Jemand drückt auf Play."],
            ["Video-Fortschritt", "lead.video_progress", "25 / 50 / 75 / 100 % erreicht (du bekommst jeden Meilenstein einmal)."],
            ["CTA geklickt", "lead.cta_clicked", "Jemand klickt deinen Call-to-Action-Button."],
            ["Lead angelegt", "lead.created", "Beim Run-Start: jeder neue Lead bekommt eine Nachricht."],
            ["Run abgeschlossen", "run.completed", "Die ganze Versandrunde ist fertig generiert."],
            ["Run fehlgeschlagen", "run.failed", "Run wurde abgebrochen oder lief auf einen Fehler."],
          ].map(([title, key, desc]) => (
            <li key={key} className="flex items-start gap-3 rounded-squircle-sm bg-surface shadow-card p-3">
              <Zap className="size-4 text-brand mt-0.5 shrink-0" />
              <div className="min-w-0">
                <p className="text-sm font-medium text-ink">{title}</p>
                <p className="text-xs text-ink-muted mt-0.5">{desc}</p>
                <p className="text-[10px] font-mono text-ink-muted/70 mt-1">{key}</p>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2 className="text-lg font-semibold text-ink mb-3">Was schicken wir mit?</h2>
        <p className="text-ink-muted text-sm mb-3">
          Jede Nachricht ist ein JSON-Objekt mit Lead-Daten (Name, E-Mail,
          Telefon), Run- und Kampagnen-Info plus Event-Details. Beispiel:
        </p>
        <pre className="rounded-squircle-sm bg-surface shadow-card p-4 text-xs font-mono overflow-x-auto leading-relaxed">{`{
  "id": "evt_06FE8BVWG5Y6QC9RDY1KPE6SZW",
  "kind": "lead.opened",
  "ts": "2026-06-20T08:39:17.482Z",
  "version": "1",
  "data": {
    "lead": {
      "id": "5d…",
      "slug": "franz-mustermann",
      "firstName": "Franz",
      "lastName": "Mustermann",
      "email": "franz@example.com",
      "phone": "+4915112345678",
      "address": "Hauptstraße 12, 80331 München",
      "pageUrl": "https://video.digispace.at/franz-mustermann",
      "data": { /* alle CSV-Spalten */ }
    },
    "run": { "id": "…", "name": "Mai-Mailing-2026" },
    "campaign": { "id": "…", "name": "Hauseigentümer" },
    "event": { "occurredAt": "2026-06-20T08:39:17.482Z" }
  }
}`}</pre>
      </section>

      <section className="grid sm:grid-cols-3 gap-4">
        <FeatureTile
          icon={<Lock className="size-4" />}
          title="Sicher"
          text="Jeder Aufruf ist mit HMAC-SHA256 signiert. So kannst du prüfen, dass die Nachricht wirklich von uns kommt."
        />
        <FeatureTile
          icon={<Repeat2 className="size-4" />}
          title="Zuverlässig"
          text="Wenn dein Server gerade offline ist, versuchen wir es nach 30 s, 2 min, 10 min, 1 h und 6 h erneut."
        />
        <FeatureTile
          icon={<Globe className="size-4" />}
          title="Universal"
          text="Funktioniert mit Zapier, Make.com, n8n und jedem HTTPS-Endpunkt."
        />
      </section>

      <section>
        <h2 className="text-lg font-semibold text-ink mb-3">Signatur prüfen (optional, empfohlen)</h2>
        <p className="text-ink-muted text-sm mb-3">
          Wenn du echte Sicherheit willst (Production), prüfe den{" "}
          <span className="font-mono text-ink">X-VideoComet-Signature</span>
          -Header. Hier ein Beispiel in Node.js:
        </p>
        <pre className="rounded-squircle-sm bg-surface shadow-card p-4 text-xs font-mono overflow-x-auto leading-relaxed">{`const crypto = require("crypto");

function verify(secret, rawBody, headerValue) {
  // header z.B. "t=1718372537,v1=abc123..."
  const parts = Object.fromEntries(
    headerValue.split(",").map((kv) => kv.split("=")),
  );
  const t = parts.t;
  const v1 = parts.v1;
  const expected = crypto
    .createHmac("sha256", secret)
    .update(\`\${t}.\${rawBody}\`)
    .digest("hex");
  return crypto.timingSafeEqual(
    Buffer.from(v1, "hex"),
    Buffer.from(expected, "hex"),
  );
}`}</pre>
      </section>

      <section className="rounded-squircle-md bg-warn-soft/60 p-5">
        <p className="text-sm font-semibold text-ink mb-1">⚠️ Daten-Hinweis (DSGVO)</p>
        <p className="text-xs text-ink-muted">
          Wir senden Lead-Daten (E-Mail, Telefon, Adresse, alle CSV-Felder)
          an deine angegebene URL. Du bist Auftragsverarbeiter. Lieferungs-
          Logs werden 30 Tage aufbewahrt und danach gelöscht.
        </p>
      </section>
    </div>
  );
}

function FeatureTile({
  icon,
  title,
  text,
}: {
  icon: React.ReactNode;
  title: string;
  text: string;
}) {
  return (
    <div className="rounded-squircle-sm bg-surface shadow-card p-4">
      <div className="flex size-7 items-center justify-center rounded-full bg-brand-soft text-brand-deep mb-2">
        {icon}
      </div>
      <p className="text-sm font-semibold text-ink">{title}</p>
      <p className="text-xs text-ink-muted mt-1 leading-relaxed">{text}</p>
    </div>
  );
}
