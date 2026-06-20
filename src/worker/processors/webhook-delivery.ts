/**
 * Webhook-Delivery Worker Processor.
 *
 * Liest eine `webhook_deliveries`-Row (DB-bigint als String im Job) +
 * den zugehörigen Endpoint, signiert den persistierten Payload mit
 * `signRawBody`, validiert die Ziel-URL frisch (DNS-Rebind-Defense)
 * und POSTet das JSON-Body mit 10s-Timeout zum Empfänger.
 *
 * Retry-Strategie:
 *   - Transiente Fehler (408, 429, 5xx, network/timeout) → Backoff-
 *     Schedule [30s, 2m, 10m, 1h, 6h]; nach attempt 6 final als failed.
 *   - 429 honoriert `Retry-After` (Sekunden ODER HTTP-Date), aber
 *     gecapped auf das Maximum des aktuellen Schedule-Slots damit ein
 *     bösartiger/buggy Empfänger uns nicht 10 Tage in der Zukunft
 *     scheduled.
 *   - Andere 4xx → terminal failed, no retry.
 *   - URL-Block → terminal failed, no retry, kein consecutive_failures-
 *     Increment.
 *
 * Soft-Disable: nach 5 aufeinanderfolgenden Failures wird der Endpoint
 * auf `active = false` gesetzt mit `disabled_reason = 'auto:consecutive_failures'`.
 *
 * Per-Endpoint Concurrency-Cap: Redis-INCR auf `webhook:inflight:<endpointId>`
 * mit 30s EXPIRE. Maximaler Wert: 4 parallele Pushes pro Endpoint. Über
 * dem Cap wird der Job mit 1s `delay` wieder eingereiht und kein HTTP-
 * Call erfolgt.
 */

import type { Job } from "bullmq";
import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { webhookDeliveries, webhookEndpoints } from "@/lib/db/schema";
import type { WebhookEndpoint } from "@/lib/db/schema";
import { signRawBody } from "@/lib/webhooks/signature";
import { validateWebhookUrl } from "@/lib/webhooks/url-guard";
import { getRedisConnection } from "../queue";
import {
  webhookDeliveryQueue,
  type WebhookDeliveryJob,
} from "../webhook-queue";

const MAX_ATTEMPTS = 6;
const HTTP_TIMEOUT_MS = 10_000;
const PER_ENDPOINT_CAP = 4;
const PER_ENDPOINT_TTL_SEC = 30;
const CONSECUTIVE_FAILURES_DISABLE_THRESHOLD = 5;
const RESPONSE_BODY_TRUNC = 2000;

/**
 * Backoff-Schedule für die Attempts 1→2, 2→3, …, 5→6. Index = nächster
 * Attempt nach diesem Fehler − 2 (also Attempt 1-Fail nutzt Index 0 →
 * 30s). Letzter Eintrag (Attempt 5→6 → 6h) ist die maximale Wartezeit
 * für den finalen Versuch.
 */
const RETRY_DELAYS_MS = [
  30_000, // attempt 1 → 2
  120_000, // attempt 2 → 3
  600_000, // attempt 3 → 4
  3_600_000, // attempt 4 → 5
  21_600_000, // attempt 5 → 6
];

function delayForAttempt(currentAttempt: number): number {
  // currentAttempt is 1..5 → schedule index 0..4
  const idx = Math.max(0, Math.min(RETRY_DELAYS_MS.length - 1, currentAttempt - 1));
  return RETRY_DELAYS_MS[idx]!;
}

/**
 * Parst den `Retry-After`-Header. Akzeptiert Sekunden-Integer ODER HTTP-
 * Date. Cap = `currentSlot` (siehe Schedule oben).
 */
function parseRetryAfter(value: string | null, currentSlotMs: number): number | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) {
    const sec = Number.parseInt(trimmed, 10);
    if (!Number.isFinite(sec) || sec < 0) return null;
    return Math.min(sec * 1000, currentSlotMs);
  }
  const epoch = Date.parse(trimmed);
  if (Number.isNaN(epoch)) return null;
  const ms = epoch - Date.now();
  if (ms <= 0) return 0;
  return Math.min(ms, currentSlotMs);
}

interface InflightHandle {
  acquired: boolean;
  release: () => Promise<void>;
}

async function acquireInflight(endpointId: string): Promise<InflightHandle> {
  let acquired = false;
  try {
    const redis = getRedisConnection();
    const key = `webhook:inflight:${endpointId}`;
    const count = await redis.incr(key);
    await redis.expire(key, PER_ENDPOINT_TTL_SEC);
    if (count <= PER_ENDPOINT_CAP) {
      acquired = true;
      return {
        acquired: true,
        release: async () => {
          try {
            await redis.decr(key);
          } catch {
            /* ignored */
          }
        },
      };
    }
    // Cap überschritten — sofort wieder freigeben.
    try {
      await redis.decr(key);
    } catch {
      /* ignored */
    }
  } catch {
    // Redis weg → wir können den Cap nicht prüfen, lassen den Call
    // durch (fail-open, alternative wäre alles zu blocken — riskanter).
    acquired = true;
  }
  return {
    acquired,
    release: async () => {
      /* nothing to release */
    },
  };
}

/**
 * Markiert die Delivery als endgültig fehlgeschlagen + setzt endpoint-
 * Cache-Spalten + incrementiert `consecutive_failures` (außer wenn
 * `skipConsecutive` true ist — etwa bei `url_blocked`).
 */
async function markDeliveryFailed(opts: {
  deliveryId: bigint;
  endpointId: string;
  errorMessage: string;
  httpStatus: number | null;
  responseBody: string | null;
  skipConsecutive?: boolean;
}): Promise<void> {
  const now = new Date();
  await db
    .update(webhookDeliveries)
    .set({
      failedAt: now,
      nextRetryAt: null,
      errorMessage: opts.errorMessage,
      httpStatus: opts.httpStatus,
      responseBody: opts.responseBody,
    })
    .where(eq(webhookDeliveries.id, opts.deliveryId));

  // Endpoint last_delivery_* aktualisieren + ggf. consecutive_failures.
  if (opts.skipConsecutive) {
    await db
      .update(webhookEndpoints)
      .set({
        lastDeliveryAt: now,
        lastDeliveryOk: false,
        lastDeliveryError: opts.errorMessage,
        updatedAt: now,
      })
      .where(eq(webhookEndpoints.id, opts.endpointId));
    return;
  }

  const [updated] = await db
    .update(webhookEndpoints)
    .set({
      lastDeliveryAt: now,
      lastDeliveryOk: false,
      lastDeliveryError: opts.errorMessage,
      consecutiveFailures: sql`${webhookEndpoints.consecutiveFailures} + 1`,
      updatedAt: now,
    })
    .where(eq(webhookEndpoints.id, opts.endpointId))
    .returning({
      consecutiveFailures: webhookEndpoints.consecutiveFailures,
      active: webhookEndpoints.active,
    });

  if (
    updated &&
    updated.active &&
    (updated.consecutiveFailures ?? 0) >= CONSECUTIVE_FAILURES_DISABLE_THRESHOLD
  ) {
    await db
      .update(webhookEndpoints)
      .set({
        active: false,
        disabledAt: now,
        disabledReason: "auto:consecutive_failures",
        updatedAt: now,
      })
      .where(eq(webhookEndpoints.id, opts.endpointId));
  }
}

async function markDeliverySuccess(opts: {
  deliveryId: bigint;
  endpointId: string;
  httpStatus: number;
  responseBody: string | null;
}): Promise<void> {
  const now = new Date();
  await db
    .update(webhookDeliveries)
    .set({
      deliveredAt: now,
      failedAt: null,
      nextRetryAt: null,
      httpStatus: opts.httpStatus,
      responseBody: opts.responseBody,
      errorMessage: null,
    })
    .where(eq(webhookDeliveries.id, opts.deliveryId));

  await db
    .update(webhookEndpoints)
    .set({
      consecutiveFailures: 0,
      lastDeliveryAt: now,
      lastDeliveryOk: true,
      lastDeliveryError: null,
      updatedAt: now,
    })
    .where(eq(webhookEndpoints.id, opts.endpointId));
}

async function scheduleRetry(opts: {
  deliveryId: bigint;
  currentAttempt: number;
  errorMessage: string;
  httpStatus: number | null;
  responseBody: string | null;
  retryAfterMs?: number | null;
}): Promise<void> {
  const nextAttempt = opts.currentAttempt + 1;
  const baseDelay = delayForAttempt(opts.currentAttempt);
  const delay =
    typeof opts.retryAfterMs === "number" && opts.retryAfterMs >= 0
      ? opts.retryAfterMs
      : baseDelay;
  const now = Date.now();
  const nextRetryAt = new Date(now + delay);

  await db
    .update(webhookDeliveries)
    .set({
      attempt: nextAttempt,
      nextRetryAt,
      errorMessage: opts.errorMessage,
      httpStatus: opts.httpStatus,
      responseBody: opts.responseBody,
    })
    .where(eq(webhookDeliveries.id, opts.deliveryId));

  const queue = webhookDeliveryQueue();
  await queue.add(
    "webhook-delivery",
    { deliveryId: String(opts.deliveryId) } satisfies WebhookDeliveryJob,
    {
      jobId: `wd_${opts.deliveryId}_${nextAttempt}`,
      delay,
    },
  );
}

function truncate(text: string, limit: number): string {
  if (text.length <= limit) return text;
  return text.slice(0, limit);
}

/**
 * Per-Endpoint-Rate-Limit-Re-Enqueue: 1s delay, gleicher Attempt-Count
 * — verbraucht KEINEN Retry-Versuch.
 */
async function reEnqueueDueToRateLimit(deliveryId: bigint, attempt: number): Promise<void> {
  const queue = webhookDeliveryQueue();
  // jobId-Suffix `_rl<timestamp>` damit BullMQ nicht silent-dedupiert,
  // wenn der gleiche Versuch zurück in die Queue muss.
  const id = `wd_${deliveryId}_${attempt}_rl${Date.now()}`;
  await queue.add(
    "webhook-delivery",
    { deliveryId: String(deliveryId) } satisfies WebhookDeliveryJob,
    {
      jobId: id,
      delay: 1000,
    },
  );
}

interface DeliveryRow {
  id: bigint;
  endpointId: string;
  attempt: number;
  payload: unknown;
  eventId: string;
  eventKind: string;
}

export async function processWebhookDelivery(
  job: Job<WebhookDeliveryJob>,
): Promise<void> {
  const deliveryIdStr = job.data.deliveryId;
  let deliveryIdBig: bigint;
  try {
    deliveryIdBig = BigInt(deliveryIdStr);
  } catch {
    // eslint-disable-next-line no-console
    console.error(`[webhooks:worker] invalid deliveryId ${deliveryIdStr}`);
    return;
  }

  // 1) Delivery + Endpoint laden.
  const [row] = await db
    .select({
      delivery: webhookDeliveries,
      endpoint: webhookEndpoints,
    })
    .from(webhookDeliveries)
    .innerJoin(
      webhookEndpoints,
      eq(webhookEndpoints.id, webhookDeliveries.endpointId),
    )
    .where(eq(webhookDeliveries.id, deliveryIdBig))
    .limit(1);

  if (!row) {
    // Delivery wurde gelöscht (z.B. Endpoint-Cascade) — nichts zu tun.
    return;
  }

  const delivery: DeliveryRow = {
    id: row.delivery.id,
    endpointId: row.delivery.endpointId,
    attempt: row.delivery.attempt ?? 1,
    payload: row.delivery.payload,
    eventId: row.delivery.eventId,
    eventKind: row.delivery.eventKind,
  };
  const endpoint = row.endpoint as WebhookEndpoint;

  // Idempotenz-Guard: wenn die Delivery schon abgeschlossen ist,
  // einfach skippen. Kann durch BullMQ-Re-Delivery passieren.
  if (row.delivery.deliveredAt || row.delivery.failedAt) {
    return;
  }

  // 2) Endpoint deaktiviert / gelöscht / nicht-aktiv?
  if (!endpoint.active || endpoint.disabledAt) {
    await markDeliveryFailed({
      deliveryId: delivery.id,
      endpointId: endpoint.id,
      errorMessage: "endpoint_inactive",
      httpStatus: null,
      responseBody: null,
      skipConsecutive: true,
    });
    return;
  }

  // 3) Per-Endpoint Concurrency-Cap.
  const inflight = await acquireInflight(endpoint.id);
  if (!inflight.acquired) {
    await reEnqueueDueToRateLimit(delivery.id, delivery.attempt);
    return;
  }

  try {
    // 4) URL frisch validieren (DNS-Rebind-Defense).
    const guard = await validateWebhookUrl(endpoint.url);
    if (!guard.ok) {
      await markDeliveryFailed({
        deliveryId: delivery.id,
        endpointId: endpoint.id,
        errorMessage: `url_blocked: ${guard.reason}`,
        httpStatus: null,
        responseBody: null,
        skipConsecutive: true,
      });
      return;
    }

    // 5) Body + Signatur.
    const rawBody = JSON.stringify(delivery.payload);
    const signed = signRawBody(endpoint.secret, rawBody);

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "User-Agent": "VideoComet-Webhooks/1.0",
      "X-VideoComet-Signature": signed.header,
      "X-VideoComet-Event-Id": delivery.eventId,
      "X-VideoComet-Event-Kind": delivery.eventKind,
      "X-VideoComet-Delivery-Attempt": String(delivery.attempt),
    };

    // Custom-Headers vom User mergen. Verbotene Keys werden bereits in
    // der Route abgefangen; hier defensiv nochmal die VideoComet-Prefix-
    // Keys schützen.
    if (endpoint.customHeaders && typeof endpoint.customHeaders === "object") {
      for (const [k, v] of Object.entries(
        endpoint.customHeaders as Record<string, string>,
      )) {
        const lk = k.toLowerCase();
        if (lk.startsWith("x-videocomet-")) continue;
        if (
          lk === "content-type" ||
          lk === "content-length" ||
          lk === "host" ||
          lk === "connection" ||
          lk === "transfer-encoding"
        ) {
          continue;
        }
        if (typeof v === "string") headers[k] = v;
      }
    }

    // 6) HTTP-POST mit Timeout.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);
    let resp: Response | null = null;
    let networkErrorMessage: string | null = null;
    try {
      resp = await fetch(guard.url.toString(), {
        method: "POST",
        headers,
        body: rawBody,
        signal: controller.signal,
        // Wir folgen *nicht* automatisch Redirects — der User hat die
        // URL explizit hinterlegt, ein 3xx ist eher ein Konfig-Fehler
        // beim Empfänger und sollte sichtbar werden.
        redirect: "manual",
      });
    } catch (err) {
      networkErrorMessage =
        err instanceof Error
          ? err.name === "AbortError"
            ? "timeout"
            : err.message
          : "network_error";
    } finally {
      clearTimeout(timer);
    }

    if (!resp) {
      // Netzwerk-/Timeout-Fehler → retryable.
      await handleRetryable({
        delivery,
        errorMessage: `network: ${networkErrorMessage ?? "unknown"}`,
        httpStatus: null,
        responseBody: null,
      });
      return;
    }

    let responseText = "";
    try {
      responseText = await resp.text();
    } catch {
      responseText = "";
    }
    const responseBody = truncate(responseText, RESPONSE_BODY_TRUNC);

    const status = resp.status;

    if (status >= 200 && status < 300) {
      await markDeliverySuccess({
        deliveryId: delivery.id,
        endpointId: endpoint.id,
        httpStatus: status,
        responseBody,
      });
      return;
    }

    // 429 / 408 / 5xx → retryable.
    if (status === 408 || status === 429 || (status >= 500 && status <= 599)) {
      const retryHeader =
        status === 429 ? resp.headers.get("retry-after") : null;
      const slot = delayForAttempt(delivery.attempt);
      const retryAfterMs = parseRetryAfter(retryHeader, slot);
      await handleRetryable({
        delivery,
        errorMessage: `http_${status}`,
        httpStatus: status,
        responseBody,
        retryAfterMs,
      });
      return;
    }

    // 3xx (manual redirect not followed) → wir betrachten das als nicht-
    // retryable Empfänger-Konfig-Fehler (Empfänger sollte einen 2xx
    // zurückgeben). Klassisches "other 4xx".
    await markDeliveryFailed({
      deliveryId: delivery.id,
      endpointId: endpoint.id,
      errorMessage: `http_${status}`,
      httpStatus: status,
      responseBody,
    });
  } finally {
    await inflight.release();
  }
}

async function handleRetryable(opts: {
  delivery: DeliveryRow;
  errorMessage: string;
  httpStatus: number | null;
  responseBody: string | null;
  retryAfterMs?: number | null;
}): Promise<void> {
  const { delivery } = opts;
  if (delivery.attempt >= MAX_ATTEMPTS) {
    // Letzter Versuch — als endgültig failed markieren.
    await markDeliveryFailed({
      deliveryId: delivery.id,
      endpointId: delivery.endpointId,
      errorMessage: opts.errorMessage,
      httpStatus: opts.httpStatus,
      responseBody: opts.responseBody,
    });
    return;
  }
  await scheduleRetry({
    deliveryId: delivery.id,
    currentAttempt: delivery.attempt,
    errorMessage: opts.errorMessage,
    httpStatus: opts.httpStatus,
    responseBody: opts.responseBody,
    retryAfterMs: opts.retryAfterMs ?? null,
  });
}
