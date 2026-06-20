/**
 * GET /api/webhooks/endpoints/:id/deliveries/:deliveryId
 *
 * Liefert eine einzelne Delivery-Row in voller Detail-Tiefe (inkl.
 * payload, request_headers, response_body). Owner-Check via Endpoint-ID,
 * delivery-ID muss zur Endpoint-ID passen.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { requireUserApi } from "@/lib/auth-guard";
import { db } from "@/lib/db";
import { webhookDeliveries } from "@/lib/db/schema";
import { requireWebhookEndpoint } from "@/lib/webhooks/auth";

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string; deliveryId: string } },
) {
  const auth = await requireUserApi();
  if (!auth.ok) return auth.response;

  try {
    await requireWebhookEndpoint(params.id, auth.user.id);
  } catch {
    return NextResponse.json({ error: "Nicht gefunden." }, { status: 404 });
  }

  if (!/^\d+$/.test(params.deliveryId)) {
    return NextResponse.json({ error: "Ungültige ID." }, { status: 400 });
  }
  let deliveryIdBig: bigint;
  try {
    deliveryIdBig = BigInt(params.deliveryId);
  } catch {
    return NextResponse.json({ error: "Ungültige ID." }, { status: 400 });
  }

  const [row] = await db
    .select()
    .from(webhookDeliveries)
    .where(
      and(
        eq(webhookDeliveries.id, deliveryIdBig),
        eq(webhookDeliveries.endpointId, params.id),
      ),
    )
    .limit(1);

  if (!row) {
    return NextResponse.json({ error: "Nicht gefunden." }, { status: 404 });
  }

  return NextResponse.json({ ...row, id: String(row.id) });
}
