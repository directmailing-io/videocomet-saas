/**
 * POST /api/webhooks/endpoints/:id/enable
 *
 * Setzt `active = true` + clear-t den Auto-Disable-Marker + setzt
 * `consecutive_failures` zurück auf 0. Der nächste Event-Hook nimmt
 * den Endpoint sofort wieder auf.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { requireUserApi } from "@/lib/auth-guard";
import { db } from "@/lib/db";
import { webhookEndpoints } from "@/lib/db/schema";
import { requireWebhookEndpoint } from "@/lib/webhooks/auth";
import { bumpWebhookRevision } from "@/lib/webhooks/enqueue";

export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await requireUserApi();
  if (!auth.ok) return auth.response;

  try {
    await requireWebhookEndpoint(params.id, auth.user.id);
  } catch {
    return NextResponse.json({ error: "Nicht gefunden." }, { status: 404 });
  }

  const now = new Date();
  const [updated] = await db
    .update(webhookEndpoints)
    .set({
      active: true,
      disabledAt: null,
      disabledReason: null,
      consecutiveFailures: 0,
      updatedAt: now,
    })
    .where(eq(webhookEndpoints.id, params.id))
    .returning();

  await bumpWebhookRevision(auth.user.id);
  return NextResponse.json(updated);
}
