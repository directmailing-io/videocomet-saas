/**
 * BullMQ-Queue für Outgoing-Webhook-Deliveries.
 *
 * Mirrors the crm-queue pattern: own queue name `webhook-delivery`,
 * reuses the shared Redis connection from `./queue.ts`. Eigene Queue
 * lässt CRM-Sync + Webhook-Pushes unabhängig voneinander skalieren.
 *
 * Job-Shape ist absichtlich minimal — der Worker re-lädt die Delivery-Row
 * via `deliveryId` und liest payload + endpoint frisch aus der DB. So
 * bleibt der Job-Payload winzig (gut für Redis-RAM) und Updates am
 * Endpoint zwischen Enqueue + Worker-Pickup werden frisch berücksichtigt.
 */

import { Queue } from "bullmq";
import type { ConnectionOptions } from "bullmq";
import { getRedisConnection } from "./queue";

export const WEBHOOK_DELIVERY_QUEUE = "webhook-delivery";

export interface WebhookDeliveryJob {
  /** `webhook_deliveries.id` (bigint serialisiert als String). */
  deliveryId: string;
}

function getConnectionOpts(): ConnectionOptions {
  return getRedisConnection() as unknown as ConnectionOptions;
}

let cached: Queue<WebhookDeliveryJob> | null = null;

/**
 * Lazy-initialisierte Queue. Default-Optionen sind bewusst konservativ:
 *  - `removeOnComplete: 500` — wir wollen die letzten Erfolge im Bull-
 *    Board sehen, ohne Redis aufzublasen.
 *  - `removeOnFail: 2000` — Fehler-Historie länger halten, damit der
 *    User in der UI auch ältere Failures untersuchen kann.
 *  - `attempts: 1` — Retries managen WIR auf DB-Ebene (siehe
 *    `webhook_deliveries.attempt`/`next_retry_at`); BullMQ macht keine
 *    impliziten Retries, sondern bekommt die nächsten Versuche als
 *    neuen Job mit `delay`.
 */
export function webhookDeliveryQueue(): Queue<WebhookDeliveryJob> {
  if (cached) return cached;
  cached = new Queue<WebhookDeliveryJob>(WEBHOOK_DELIVERY_QUEUE, {
    connection: getConnectionOpts(),
    defaultJobOptions: {
      attempts: 1,
      removeOnComplete: { count: 500 },
      removeOnFail: { count: 2000 },
    },
  });
  return cached;
}
