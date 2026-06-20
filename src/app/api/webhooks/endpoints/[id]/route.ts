/**
 * REST API für einen einzelnen Webhook-Endpoint des Users.
 *
 *   GET    → Endpoint-Details (mit Secret, weil der User es nochmal sehen darf,
 *            wenn er als Owner authentifiziert ist — analog Stripe-UX).
 *   PATCH  → Updates an Name/URL/EnabledEvents/CustomHeaders/Active.
 *   DELETE → Endpoint hart löschen (Deliveries kaskadieren weg via FK).
 *
 * Tenant-Guard via `requireWebhookEndpoint`.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { requireUserApi } from "@/lib/auth-guard";
import { db } from "@/lib/db";
import { webhookEndpoints } from "@/lib/db/schema";
import {
  requireWebhookEndpoint,
  validateCustomHeaders,
} from "@/lib/webhooks/auth";
import {
  ALL_WEBHOOK_EVENT_KINDS,
  type WebhookEventKind,
} from "@/lib/webhooks/types";
import { validateWebhookUrl } from "@/lib/webhooks/url-guard";
import { bumpWebhookRevision } from "@/lib/webhooks/enqueue";

const patchSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  url: z.string().url("Ungültige URL.").optional(),
  enabledEvents: z.array(z.string()).optional(),
  customHeaders: z.record(z.string(), z.string()).optional(),
  active: z.boolean().optional(),
  campaignId: z.string().uuid().nullable().optional(),
});

function filterEnabledEvents(input: string[]): WebhookEventKind[] {
  const allowed = new Set<string>(ALL_WEBHOOK_EVENT_KINDS);
  const out: WebhookEventKind[] = [];
  for (const k of input) {
    if (allowed.has(k)) out.push(k as WebhookEventKind);
  }
  return out;
}

function isUniqueViolation(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const inner =
    (err as { cause?: unknown }).cause &&
    typeof (err as { cause?: unknown }).cause === "object"
      ? ((err as { cause: Record<string, unknown> }).cause as Record<string, unknown>)
      : (err as Record<string, unknown>);
  return inner.code === "23505";
}

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await requireUserApi();
  if (!auth.ok) return auth.response;

  try {
    const ep = await requireWebhookEndpoint(params.id, auth.user.id);
    return NextResponse.json(ep);
  } catch {
    return NextResponse.json({ error: "Nicht gefunden." }, { status: 404 });
  }
}

export async function PATCH(
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

  let body: z.infer<typeof patchSchema>;
  try {
    body = patchSchema.parse(await req.json());
  } catch (err) {
    return NextResponse.json(
      {
        error: "Ungültige Eingabe.",
        details: err instanceof Error ? err.message : null,
      },
      { status: 400 },
    );
  }

  const patch: Partial<typeof webhookEndpoints.$inferInsert> = {};

  if (body.name !== undefined) patch.name = body.name;
  if (body.active !== undefined) {
    patch.active = body.active;
    // Manuell wieder aktivieren → Auto-Disable-Marker zurücksetzen.
    if (body.active) {
      patch.disabledAt = null;
      patch.disabledReason = null;
      patch.consecutiveFailures = 0;
    }
  }
  if (body.url !== undefined) {
    const guard = await validateWebhookUrl(body.url);
    if (!guard.ok) {
      return NextResponse.json(
        { error: `URL nicht erlaubt: ${guard.reason}` },
        { status: 400 },
      );
    }
    patch.url = body.url;
  }
  if (body.enabledEvents !== undefined) {
    patch.enabledEvents = filterEnabledEvents(body.enabledEvents);
  }
  if (body.customHeaders !== undefined) {
    const headerErr = validateCustomHeaders(body.customHeaders);
    if (headerErr) {
      return NextResponse.json({ error: headerErr.message }, { status: 400 });
    }
    patch.customHeaders = body.customHeaders;
  }
  if (body.campaignId !== undefined) {
    patch.campaignId = body.campaignId;
  }

  patch.updatedAt = new Date();

  let updated;
  try {
    [updated] = await db
      .update(webhookEndpoints)
      .set(patch)
      .where(eq(webhookEndpoints.id, params.id))
      .returning();
  } catch (err) {
    if (isUniqueViolation(err)) {
      return NextResponse.json(
        { error: "Name bereits vergeben." },
        { status: 409 },
      );
    }
    // eslint-disable-next-line no-console
    console.error("[webhooks:patch] failed:", err);
    return NextResponse.json(
      { error: "Endpoint konnte nicht aktualisiert werden." },
      { status: 500 },
    );
  }

  if (!updated) {
    return NextResponse.json({ error: "Nicht gefunden." }, { status: 404 });
  }

  await bumpWebhookRevision(auth.user.id);
  return NextResponse.json(updated);
}

export async function DELETE(
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

  try {
    await db
      .delete(webhookEndpoints)
      .where(eq(webhookEndpoints.id, params.id));
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[webhooks:delete] failed:", err);
    return NextResponse.json(
      { error: "Endpoint konnte nicht gelöscht werden." },
      { status: 500 },
    );
  }

  await bumpWebhookRevision(auth.user.id);
  return NextResponse.json({ ok: true });
}
