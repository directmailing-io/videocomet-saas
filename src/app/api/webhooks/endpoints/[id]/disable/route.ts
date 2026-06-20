/**
 * POST /api/webhooks/endpoints/:id/disable
 *
 * Setzt `active = false` + `disabled_at = now()` mit
 * `disabled_reason = 'user:manual'`. Der nächste Event-Hook überspringt
 * den Endpoint sofort.
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
      active: false,
      disabledAt: now,
      disabledReason: "user:manual",
      updatedAt: now,
    })
    .where(eq(webhookEndpoints.id, params.id))
    .returning();

  await bumpWebhookRevision(auth.user.id);
  return NextResponse.json(updated);
}
