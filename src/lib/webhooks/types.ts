/**
 * Frozen contracts für Outgoing-Webhooks.
 *
 * Diese Datei ist die Single-Source-of-Truth für:
 *   - Welche Event-Kinds wir nach extern pushen können
 *   - Welche Payload-Form die Empfänger erwarten dürfen
 *   - Welche Felder das Webhook-System aus einem Lead extrahiert
 *
 * Andere Agents (Backend-Worker, UI) lesen *NUR* diese Datei. Änderungen
 * sind Vertragsbrüche und brauchen Coordination.
 */

export type WebhookEventKind =
  | "lead.opened"
  | "lead.video_played"
  | "lead.video_progress"
  | "lead.cta_clicked"
  | "lead.created"
  | "run.completed"
  | "run.failed";

export const ALL_WEBHOOK_EVENT_KINDS: WebhookEventKind[] = [
  "lead.opened",
  "lead.video_played",
  "lead.video_progress",
  "lead.cta_clicked",
  "lead.created",
  "run.completed",
  "run.failed",
];

/**
 * Hülle für jeden Webhook-Push. `id` ist global eindeutig
 * (`evt_<base32-uuidv7>`), `ts` ist ISO-8601 UTC mit Millisekunden-
 * Präzision, `version` ist die Vertrags-Version dieser Datei. Bei
 * Breaking-Changes ziehen wir `version` hoch und der Worker hängt das
 * sichtbar an die alte Logik dran.
 */
export interface WebhookPayload<TData = unknown> {
  id: string;          // evt_<base32-uuidv7>
  kind: WebhookEventKind;
  ts: string;          // ISO-8601 UTC ms-precision
  version: "1";
  data: TData;
}

/**
 * Payload-Body für alle `lead.*`-Events. Worker baut das in
 * `payload-builder.ts`; Empfänger bekommen das in `data` des
 * `WebhookPayload`.
 */
export interface LeadEventData {
  lead: WebhookLead;
  run: { id: string; name: string };
  campaign: { id: string; name: string };
  event: WebhookEventDetails;
}

/**
 * Standardisierte Lead-Felder, die der Webhook-Push liefert. `data` ist
 * der originale `leads.data`-Record (alle Originalspalten der CSV), die
 * obigen `firstName`/`lastName`/… sind case-insensitiv via
 * `lead-shortcuts.ts` extrahiert.
 */
export interface WebhookLead {
  id: string;
  slug: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  address: string;
  pageUrl: string;
  data: Record<string, string>;
}

/**
 * Event-spezifische Details. Welche Felder gesetzt sind, hängt vom
 * `WebhookEventKind` ab:
 *   - lead.opened         → sessionId, ipCountry
 *   - lead.video_played   → sessionId, durationSec
 *   - lead.video_progress → sessionId, playedSec, durationSec, quartile
 *   - lead.cta_clicked    → sessionId, ctaLabel, ctaUrl
 *   - lead.created        → keine zusätzlichen Felder (außer occurredAt)
 */
export interface WebhookEventDetails {
  occurredAt: string;
  sessionId?: string;
  ipCountry?: string;
  playedSec?: number;
  durationSec?: number;
  quartile?: 25 | 50 | 75 | 100;
  ctaLabel?: string;
  ctaUrl?: string;
}

/**
 * Payload-Body für `run.completed` / `run.failed`. Aggregate werden vom
 * Worker beim Abschluss des Runs aus `runs.*_leads` befüllt.
 */
export interface RunEventData {
  run: {
    id: string;
    name: string;
    totalLeads: number;
    completedLeads: number;
    failedLeads: number;
    startedAt: string | null;
    completedAt: string | null;
  };
  campaign: { id: string; name: string };
}

/**
 * Wird vom `url-guard.ts` geworfen, wenn die Ziel-URL gegen die
 * SSRF-Policy verstößt (privates Netz, Loopback, falsches Schema, …).
 * Der Worker fängt das spezifisch ab und markiert die Delivery als
 * `failed` mit `error_message = "URL blocked: <reason>"` — UND
 * incrementiert NICHT `consecutive_failures` (es ist kein transienter
 * Fehler).
 */
export class WebhookUrlBlockedError extends Error {
  reason: string;
  constructor(reason: string) {
    super(`URL blocked: ${reason}`);
    this.name = "WebhookUrlBlockedError";
    this.reason = reason;
  }
}
