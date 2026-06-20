/**
 * POST /api/webhooks/endpoints/:id/rotate-secret
 *
 * Generiert ein neues Secret und ersetzt das alte mit sofortiger Cutover-
 * Wirkung. Die Antwort enthält das Plaintext-Secret EINMALIG; der User
 * muss es kopieren.
 *
 * Kein Übergangsfenster (kein Dual-Secret-Modus). Begründung: die
 * Mehrheit der Webhook-Empfänger hat keine Sliding-Window-Support, und
 * die UI macht klar, dass Bestands-Empfänger nach Rotation neu
 * konfiguriert werden müssen.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { requireUserApi } from "@/lib/auth-guard";
import { db } from "@/lib/db";
import { webhookEndpoints } from "@/lib/db/schema";
import { requireWebhookEndpoint } from "@/lib/webhooks/auth";

function generateSecret(): string {
  const buf = randomBytes(32);
  return `whsec_${buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "")}`;
}

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

  const secret = generateSecret();
  const now = new Date();

  const [updated] = await db
    .update(webhookEndpoints)
    .set({ secret, updatedAt: now })
    .where(eq(webhookEndpoints.id, params.id))
    .returning({ id: webhookEndpoints.id, secret: webhookEndpoints.secret });

  if (!updated) {
    return NextResponse.json(
      { error: "Endpoint konnte nicht aktualisiert werden." },
      { status: 500 },
    );
  }

  return NextResponse.json({ id: updated.id, secret: updated.secret });
}
