/**
 * Zentrale Quelle für deutsche Labels + Beschreibungen aller Webhook-
 * Event-Kinds. Wird sowohl in der Endpoint-Liste (Badges), im Form-Dialog
 * (Checkbox-Gruppe) als auch im Deliveries-Log (Event-Spalte) verwendet,
 * damit Anpassungen nur an einer Stelle passieren.
 */

import type { WebhookEventKind } from "@/lib/webhooks/types";

export const WEBHOOK_EVENT_LABELS: Record<
  WebhookEventKind,
  { label: string; group: "lead" | "run"; description: string }
> = {
  "lead.opened": {
    label: "Landingpage geöffnet",
    group: "lead",
    description: "Lead hat die Landingpage besucht.",
  },
  "lead.video_played": {
    label: "Video gestartet",
    group: "lead",
    description: "Lead hat das Video gestartet.",
  },
  "lead.video_progress": {
    label: "Video-Fortschritt",
    group: "lead",
    description: "Lead hat 25/50/75/100 % erreicht.",
  },
  "lead.cta_clicked": {
    label: "CTA geklickt",
    group: "lead",
    description: "Lead hat den CTA-Button geklickt.",
  },
  "lead.created": {
    label: "Lead angelegt",
    group: "lead",
    description: "Neuer Lead beim Run-Start angelegt.",
  },
  "run.completed": {
    label: "Run abgeschlossen",
    group: "run",
    description: "Run-Generierung erfolgreich beendet.",
  },
  "run.failed": {
    label: "Run fehlgeschlagen",
    group: "run",
    description: "Run abgebrochen oder fehlgeschlagen.",
  },
};

export const WEBHOOK_EVENT_KIND_ORDER: WebhookEventKind[] = [
  "lead.opened",
  "lead.video_played",
  "lead.video_progress",
  "lead.cta_clicked",
  "lead.created",
  "run.completed",
  "run.failed",
];
