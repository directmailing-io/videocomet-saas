/**
 * POST /api/webhooks/endpoints/:id/redeliver
 *
 * Body: `{ deliveryId: string }`. Legt eine NEUE `webhook_deliveries`-Row
 * mit dem gleichen `event_id` + Payload an und enqueued sie sofort. Das
 * stellt sicher, dass der Empfänger das Event mit derselben event_id
 * deduplizieren kann.
 *
 * Antwort: 202 Accepted mit `{ newDeliveryId }`.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { requireUserApi } from "@/lib/auth-guard";
import { db } from "@/lib/db";
import { webhookDeliveries } from "@/lib/db/schema";
import { requireWebhookEndpoint } from "@/lib/webhooks/auth";
import {
  webhookDeliveryQueue,
  type WebhookDeliveryJob,
} from "@/worker/webhook-queue";

const bodySchema = z.object({
  deliveryId: z.string().regex(/^\d+$/, "Ungültige Delivery-ID."),
});

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await requireUserApi();
  if (!auth.ok) return auth.response;

  try {
    await requireWebhookEndpoint(params.id, auth.user.id);
  } catch {
    return NextResponse.json({ error: "Nicht gefunden." }, { status: 404 });
  }

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await req.json());
  } catch (err) {
    return NextResponse.json(
      {
        error: "Ungültige Eingabe.",
        details: err instanceof Error ? err.message : null,
      },
      { status: 400 },
    );
  }

  let deliveryIdBig: bigint;
  try {
    deliveryIdBig = BigInt(body.deliveryId);
  } catch {
    return NextResponse.json({ error: "Ungültige Delivery-ID." }, { status: 400 });
  }

  const [orig] = await db
    .select()
    .from(webhookDeliveries)
    .where(
      and(
        eq(webhookDeliveries.id, deliveryIdBig),
        eq(webhookDeliveries.endpointId, params.id),
      ),
    )
    .limit(1);

  if (!orig) {
    return NextResponse.json({ error: "Delivery nicht gefunden." }, { status: 404 });
  }

  const [inserted] = await db
    .insert(webhookDeliveries)
    .values({
      endpointId: orig.endpointId,
      eventKind: orig.eventKind,
      eventId: orig.eventId, // gleiche event-id → Empfänger kann dedupen
      leadId: orig.leadId,
      runId: orig.runId,
      campaignId: orig.campaignId,
      payload: orig.payload,
      attempt: 1,
    })
    .returning({ id: webhookDeliveries.id });

  if (!inserted) {
    return NextResponse.json(
      { error: "Delivery konnte nicht angelegt werden." },
      { status: 500 },
    );
  }

  const newDeliveryId = String(inserted.id);
  try {
    const queue = webhookDeliveryQueue();
    await queue.add(
      "webhook-delivery",
      { deliveryId: newDeliveryId } satisfies WebhookDeliveryJob,
      { jobId: `wd_${newDeliveryId}_1` },
    );
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(
      `[webhooks:redeliver] enqueue failed for delivery=${newDeliveryId}:`,
      err instanceof Error ? err.message : err,
    );
    // Wir haben die Row geschrieben — wir geben dennoch 202 zurück, der
    // Recovery-Loop (falls jemals existent) kann sich darum kümmern.
  }

  return NextResponse.json({ newDeliveryId }, { status: 202 });
}
