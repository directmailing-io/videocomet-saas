/**
 * REST API für die Outgoing-Webhook-Endpoints des angemeldeten Users.
 *
 *   GET  → Liste aller Endpoints des Users (ohne Secret).
 *   POST → Legt einen neuen Endpoint an.
 *
 * POST-Flow:
 *   1. Body validieren (Zod).
 *   2. URL durch `validateWebhookUrl` schicken — bei Block 400 zurück.
 *   3. Custom-Header validieren (`validateCustomHeaders`).
 *   4. EnabledEvents auf `ALL_WEBHOOK_EVENT_KINDS` einschränken.
 *   5. Secret generieren (`whsec_` + 32 Bytes base64url).
 *   6. Insert + Cache-Revision für den User bumpen.
 *   7. Antwort: Endpoint MIT Plaintext-Secret (EINMALIG sichtbar).
 *
 * Tenant-Guard: `requireUserApi`. Uniqueness `(userId, name)` wird vom
 * DB-Constraint `webhook_endpoints_user_name_uq` erzwungen — wir fangen
 * 23505 ab und antworten 409.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import { requireUserApi } from "@/lib/auth-guard";
import { db } from "@/lib/db";
import { webhookEndpoints, campaigns } from "@/lib/db/schema";
import { ALL_WEBHOOK_EVENT_KINDS, type WebhookEventKind } from "@/lib/webhooks/types";
import { validateWebhookUrl } from "@/lib/webhooks/url-guard";
import { validateCustomHeaders } from "@/lib/webhooks/auth";
import { bumpWebhookRevision } from "@/lib/webhooks/enqueue";

const createSchema = z.object({
  name: z.string().min(1, "Name darf nicht leer sein.").max(80),
  url: z.string().url("Ungültige URL."),
  campaignId: z.string().uuid().nullable().optional(),
  enabledEvents: z.array(z.string()).default([]),
  customHeaders: z.record(z.string(), z.string()).default({}),
  active: z.boolean().default(true),
});

function isUniqueViolation(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const inner =
    (err as { cause?: unknown }).cause &&
    typeof (err as { cause?: unknown }).cause === "object"
      ? ((err as { cause: Record<string, unknown> }).cause as Record<string, unknown>)
      : (err as Record<string, unknown>);
  return inner.code === "23505";
}

function generateSecret(): string {
  // 32 zufällige Bytes als base64url ohne Padding — ergibt 43 Zeichen.
  // Mit `whsec_`-Prefix sind das 50 Zeichen total.
  const buf = randomBytes(32);
  return `whsec_${buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "")}`;
}

function filterEnabledEvents(input: string[]): WebhookEventKind[] {
  const allowed = new Set<string>(ALL_WEBHOOK_EVENT_KINDS);
  const out: WebhookEventKind[] = [];
  for (const k of input) {
    if (allowed.has(k)) out.push(k as WebhookEventKind);
  }
  return out;
}

export async function GET() {
  const auth = await requireUserApi();
  if (!auth.ok) return auth.response;

  const rows = await db
    .select({
      id: webhookEndpoints.id,
      userId: webhookEndpoints.userId,
      campaignId: webhookEndpoints.campaignId,
      name: webhookEndpoints.name,
      url: webhookEndpoints.url,
      enabledEvents: webhookEndpoints.enabledEvents,
      customHeaders: webhookEndpoints.customHeaders,
      active: webhookEndpoints.active,
      disabledAt: webhookEndpoints.disabledAt,
      disabledReason: webhookEndpoints.disabledReason,
      consecutiveFailures: webhookEndpoints.consecutiveFailures,
      createdAt: webhookEndpoints.createdAt,
      updatedAt: webhookEndpoints.updatedAt,
      lastDeliveryAt: webhookEndpoints.lastDeliveryAt,
      lastDeliveryOk: webhookEndpoints.lastDeliveryOk,
      lastDeliveryError: webhookEndpoints.lastDeliveryError,
    })
    .from(webhookEndpoints)
    .where(eq(webhookEndpoints.userId, auth.user.id))
    .orderBy(desc(webhookEndpoints.createdAt));

  return NextResponse.json({ endpoints: rows });
}

export async function POST(req: NextRequest) {
  const auth = await requireUserApi();
  if (!auth.ok) return auth.response;

  let body: z.infer<typeof createSchema>;
  try {
    body = createSchema.parse(await req.json());
  } catch (err) {
    return NextResponse.json(
      {
        error: "Ungültige Eingabe.",
        details: err instanceof Error ? err.message : null,
      },
      { status: 400 },
    );
  }

  // URL-Validierung gegen SSRF VOR jeder DB-Operation.
  const guard = await validateWebhookUrl(body.url);
  if (!guard.ok) {
    return NextResponse.json(
      { error: `URL nicht erlaubt: ${guard.reason}` },
      { status: 400 },
    );
  }

  // Custom-Header validieren.
  const headerErr = validateCustomHeaders(body.customHeaders);
  if (headerErr) {
    return NextResponse.json({ error: headerErr.message }, { status: 400 });
  }

  const enabledEvents = filterEnabledEvents(body.enabledEvents);

  // Campaign-Ownership prüfen (wenn gesetzt).
  let campaignId: string | null = body.campaignId ?? null;
  if (campaignId) {
    const [own] = await db
      .select({ id: campaigns.id })
      .from(campaigns)
      .where(and(eq(campaigns.id, campaignId), eq(campaigns.userId, auth.user.id)))
      .limit(1);
    if (!own) {
      return NextResponse.json(
        { error: "Kampagne nicht gefunden." },
        { status: 404 },
      );
    }
  }

  const secret = generateSecret();
  const now = new Date();

  let inserted;
  try {
    [inserted] = await db
      .insert(webhookEndpoints)
      .values({
        userId: auth.user.id,
        campaignId,
        name: body.name,
        url: body.url,
        secret,
        enabledEvents,
        customHeaders: body.customHeaders,
        active: body.active,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
  } catch (err) {
    if (isUniqueViolation(err)) {
      return NextResponse.json(
        { error: "Name bereits vergeben." },
        { status: 409 },
      );
    }
    // eslint-disable-next-line no-console
    console.error("[webhooks:create] insert failed:", err);
    return NextResponse.json(
      { error: "Endpoint konnte nicht angelegt werden." },
      { status: 500 },
    );
  }

  if (!inserted) {
    return NextResponse.json(
      { error: "Endpoint konnte nicht angelegt werden." },
      { status: 500 },
    );
  }

  await bumpWebhookRevision(auth.user.id);

  // Plaintext-Secret EINMALIG zurückgeben — UI muss den Wert speichern.
  return NextResponse.json(inserted, { status: 201 });
}
