/**
 * Fire-and-forget Enqueue für Outgoing-Webhook-Deliveries.
 *
 * Wird aus den Hot-Path-Hooks (lead-events, leads-create, run-finalize)
 * aufgerufen. Kontrakt: **niemals werfen** — alle Fehler werden mit
 * `console.error` geloggt und der Caller bekommt eine resolved Promise.
 *
 * Zwei-Stufen-Gating analog zur CRM-Schicht:
 *   1. 60s in-process Map-Cache pro `(userId, campaignId)` →
 *      Liste matchender Endpoints. Revision-Counter `webhook:rev:<userId>`
 *      in Redis erlaubt Routen (POST/PATCH/DELETE), den Cache via INCR
 *      zu invalidieren — wir lesen den Counter bei jedem Cache-Hit.
 *   2. Für jeden gematchten Endpoint: eine neue Row in
 *      `webhook_deliveries` mit dem vollen Payload und ein BullMQ-Job
 *      mit `jobId = wd_<id>_1`.
 */

import { and, eq, isNull, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { webhookDeliveries, webhookEndpoints } from "@/lib/db/schema";
import {
  webhookDeliveryQueue,
  type WebhookDeliveryJob,
} from "@/worker/webhook-queue";
import { getRedisConnection } from "@/worker/queue";
import type { WebhookEventKind, WebhookPayload } from "./types";

interface CachedEndpoint {
  id: string;
  enabledEvents: WebhookEventKind[];
}

interface CacheEntry {
  endpoints: CachedEndpoint[];
  expiresAt: number;
  /** Snapshot des `webhook:rev:<userId>`-Counters zum Cache-Zeitpunkt. */
  rev: number;
}

const CACHE_TTL_MS = 60_000;
const cache = new Map<string, CacheEntry>();

function cleanupCache(now: number): void {
  if (cache.size < 1000) return;
  for (const [k, v] of Array.from(cache.entries())) {
    if (v.expiresAt <= now) cache.delete(k);
  }
}

async function fetchRevision(userId: string): Promise<number> {
  try {
    const redis = getRedisConnection();
    const raw = await redis.get(`webhook:rev:${userId}`);
    return raw ? Number.parseInt(raw, 10) : 0;
  } catch {
    return 0;
  }
}

/**
 * Increments the per-user revision counter so all cache entries for that
 * user are invalidated on the next read. Used by the REST routes
 * (POST/PATCH/DELETE) after every mutation.
 */
export async function bumpWebhookRevision(userId: string): Promise<void> {
  try {
    const redis = getRedisConnection();
    await redis.incr(`webhook:rev:${userId}`);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(
      `[webhooks:enqueue] failed to bump revision for user=${userId}:`,
      err instanceof Error ? err.message : err,
    );
  }
}

async function loadEndpoints(
  userId: string,
  campaignId: string,
): Promise<CachedEndpoint[]> {
  // active + nicht soft-disabled + scoped auf User UND (campaignId match
  // ODER global == NULL).
  const rows = await db
    .select({
      id: webhookEndpoints.id,
      enabledEvents: webhookEndpoints.enabledEvents,
    })
    .from(webhookEndpoints)
    .where(
      and(
        eq(webhookEndpoints.userId, userId),
        eq(webhookEndpoints.active, true),
        isNull(webhookEndpoints.disabledAt),
        or(
          eq(webhookEndpoints.campaignId, campaignId),
          isNull(webhookEndpoints.campaignId),
        ),
      ),
    );
  return rows.map((r) => ({
    id: r.id,
    enabledEvents: Array.isArray(r.enabledEvents)
      ? (r.enabledEvents as string[]).filter(
          (k): k is WebhookEventKind => typeof k === "string",
        )
      : [],
  }));
}

async function getMatchingEndpoints(
  userId: string,
  campaignId: string,
  kind: WebhookEventKind,
): Promise<CachedEndpoint[]> {
  const cacheKey = `${userId}:${campaignId}`;
  const now = Date.now();
  const cached = cache.get(cacheKey);
  const rev = await fetchRevision(userId);
  if (cached && cached.expiresAt > now && cached.rev === rev) {
    return cached.endpoints.filter((e) => e.enabledEvents.includes(kind));
  }
  cleanupCache(now);
  const endpoints = await loadEndpoints(userId, campaignId);
  cache.set(cacheKey, {
    endpoints,
    expiresAt: now + CACHE_TTL_MS,
    rev,
  });
  return endpoints.filter((e) => e.enabledEvents.includes(kind));
}

export interface EnqueueWebhooksArgs {
  userId: string;
  campaignId: string;
  kind: WebhookEventKind;
  payload: WebhookPayload<unknown>;
  leadId?: string;
  runId?: string;
}

/**
 * Kernroutine: Für jede passende Endpoint-Row eine `webhook_deliveries`
 * Row anlegen UND einen BullMQ-Job mit dem zugehörigen `deliveryId`
 * einreihen. NIEMALS WIRFT.
 */
export async function enqueueWebhooks(args: EnqueueWebhooksArgs): Promise<void> {
  try {
    const targets = await getMatchingEndpoints(
      args.userId,
      args.campaignId,
      args.kind,
    );
    if (targets.length === 0) return;

    const queue = webhookDeliveryQueue();
    for (const endpoint of targets) {
      try {
        const [inserted] = await db
          .insert(webhookDeliveries)
          .values({
            endpointId: endpoint.id,
            eventKind: args.kind,
            eventId: args.payload.id,
            leadId: args.leadId ?? null,
            runId: args.runId ?? null,
            campaignId: args.campaignId,
            payload: args.payload,
            attempt: 1,
          })
          .returning({ id: webhookDeliveries.id });

        if (!inserted) continue;

        const deliveryId = String(inserted.id);
        const job: WebhookDeliveryJob = { deliveryId };
        await queue.add("webhook-delivery", job, {
          jobId: `wd_${deliveryId}_1`,
        });
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error(
          `[webhooks:enqueue] per-endpoint failure for endpoint=${endpoint.id} kind=${args.kind}:`,
          err instanceof Error ? err.message : err,
        );
      }
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(
      `[webhooks:enqueue] failed for user=${args.userId} campaign=${args.campaignId} kind=${args.kind}:`,
      err instanceof Error ? err.message : err,
    );
  }
}

/**
 * Reine Helper-Variante für den Lead-Event-Hook: enqueues für genau die
 * Webhook-Kinds, die zum gegebenen Lead-Event gehören.
 */
export async function enqueueWebhookDelivery(args: {
  deliveryId: string;
  /** Bei `true` wird KEIN neuer Datenbank-Eintrag angelegt — der Job ist
   *  ein Re-Delivery einer existierenden Delivery-Row. */
  reuseRow: true;
  attempt: number;
  delayMs?: number;
}): Promise<void> {
  try {
    const queue = webhookDeliveryQueue();
    await queue.add(
      "webhook-delivery",
      { deliveryId: args.deliveryId },
      {
        jobId: `wd_${args.deliveryId}_${args.attempt}`,
        delay: args.delayMs ?? 0,
      },
    );
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(
      `[webhooks:enqueue] re-enqueue failed for delivery=${args.deliveryId}:`,
      err instanceof Error ? err.message : err,
    );
  }
}

/** Test-Hilfe: Cache leeren. Nicht aus dem öffentlichen API-Surface. */
export function _resetWebhookEnqueueCacheForTests(): void {
  cache.clear();
}
