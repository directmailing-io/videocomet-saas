/**
 * UI-seitige Spiegelung des serverseitigen `WebhookEndpoint`-Typs.
 * Frozen contract — siehe Brief in der Aufgabenbeschreibung. Backend liefert
 * alle Zeitstempel als ISO-Strings (nicht Date), Headers als Plain-Object.
 */

import type { WebhookEventKind } from "@/lib/webhooks/types";

export interface WebhookEndpoint {
  id: string;
  userId: string;
  campaignId: string | null;
  name: string;
  url: string;
  enabledEvents: WebhookEventKind[];
  customHeaders: Record<string, string>;
  active: boolean;
  disabledAt: string | null;
  disabledReason: string | null;
  consecutiveFailures: number;
  lastDeliveryAt: string | null;
  lastDeliveryOk: boolean | null;
  lastDeliveryError: string | null;
  createdAt: string;
}

export interface WebhookDeliveryRow {
  id: string;
  ts: string;
  eventKind: WebhookEventKind | string;
  eventId: string;
  status: "ok" | "err" | "pending";
  httpStatus: number | null;
  attempt: number;
  latencyMs: number | null;
  errorMessage: string | null;
  requestHeaders: Record<string, string> | null;
  requestBody: unknown;
  responseBody: unknown;
  nextRetryAt: string | null;
}
