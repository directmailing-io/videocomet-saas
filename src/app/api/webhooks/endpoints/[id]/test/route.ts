/**
 * POST /api/webhooks/endpoints/:id/test
 *
 * Synchroner Test-Push gegen den Endpoint. Baut einen Fixture-Lead-Event-
 * Payload (`lead.opened`), signiert ihn mit dem aktuellen Secret und
 * POSTet ihn mit 10s-Timeout. Antwort enthält Status + Latenz +
 * Response-Body-Excerpt für die UI.
 *
 * Audit: legt eine `webhook_deliveries`-Row mit `event_kind="test_sync"`
 * an, damit die Test-Calls im UI-Log auftauchen — getrennt von echten
 * Produktions-Deliveries.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { requireUserApi } from "@/lib/auth-guard";
import { db } from "@/lib/db";
import { webhookDeliveries, webhookEndpoints } from "@/lib/db/schema";
import { requireWebhookEndpoint } from "@/lib/webhooks/auth";
import { buildLeadEventPayload } from "@/lib/webhooks/payload-builder";
import { signRawBody } from "@/lib/webhooks/signature";
import { validateWebhookUrl } from "@/lib/webhooks/url-guard";

const HTTP_TIMEOUT_MS = 10_000;
const RESPONSE_BODY_TRUNC = 2000;

function truncate(s: string, limit: number): string {
  return s.length <= limit ? s : s.slice(0, limit);
}

export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await requireUserApi();
  if (!auth.ok) return auth.response;

  let endpoint;
  try {
    endpoint = await requireWebhookEndpoint(params.id, auth.user.id);
  } catch {
    return NextResponse.json({ error: "Nicht gefunden." }, { status: 404 });
  }

  const guard = await validateWebhookUrl(endpoint.url);
  if (!guard.ok) {
    return NextResponse.json(
      {
        ok: false,
        status: null,
        latencyMs: null,
        responseExcerpt: null,
        error: `URL nicht erlaubt: ${guard.reason}`,
      },
      { status: 200 },
    );
  }

  // Fixture-Payload bauen — sieht aus wie ein echter Event, ist aber
  // klar als test gekennzeichnet.
  const payload = buildLeadEventPayload("lead.opened", {
    lead: {
      id: "00000000-0000-0000-0000-000000000000",
      slug: "test-lead",
      data: {
        firstName: "Test",
        lastName: "User",
        email: "test@example.com",
      },
    },
    run: { id: "00000000-0000-0000-0000-000000000000", name: "Test Run" },
    campaign: { id: "00000000-0000-0000-0000-000000000000", name: "Test Kampagne" },
    pageUrl: "https://app.videocomet.de/v/test-lead",
    event: {
      occurredAt: new Date().toISOString(),
      sessionId: "test-session",
    },
  });

  const rawBody = JSON.stringify(payload);
  const signed = signRawBody(endpoint.secret, rawBody);

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "User-Agent": "VideoComet-Webhooks/1.0",
    "X-VideoComet-Signature": signed.header,
    "X-VideoComet-Event-Id": payload.id,
    "X-VideoComet-Event-Kind": "lead.opened",
    "X-VideoComet-Delivery-Attempt": "1",
    "X-VideoComet-Test": "true",
  };
  if (endpoint.customHeaders && typeof endpoint.customHeaders === "object") {
    for (const [k, v] of Object.entries(
      endpoint.customHeaders as Record<string, string>,
    )) {
      const lk = k.toLowerCase();
      if (lk.startsWith("x-videocomet-")) continue;
      if (lk === "content-type" || lk === "content-length" || lk === "host") continue;
      if (typeof v === "string") headers[k] = v;
    }
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);
  const start = Date.now();
  let status: number | null = null;
  let responseBody = "";
  let error: string | null = null;
  try {
    const resp = await fetch(guard.url.toString(), {
      method: "POST",
      headers,
      body: rawBody,
      signal: controller.signal,
      redirect: "manual",
    });
    status = resp.status;
    try {
      responseBody = await resp.text();
    } catch {
      responseBody = "";
    }
  } catch (err) {
    if (err instanceof Error) {
      error = err.name === "AbortError" ? "timeout" : err.message;
    } else {
      error = "network_error";
    }
  } finally {
    clearTimeout(timer);
  }
  const latencyMs = Date.now() - start;

  // Audit-Row schreiben. eventKind="test_sync" trennt das von echten
  // Deliveries; sowohl die Webhook-UI als auch die Deliveries-Liste
  // können danach filtern.
  try {
    await db.insert(webhookDeliveries).values({
      endpointId: endpoint.id,
      eventKind: "test_sync",
      eventId: payload.id,
      campaignId: endpoint.campaignId ?? null,
      payload,
      httpStatus: status,
      responseBody: truncate(responseBody, RESPONSE_BODY_TRUNC),
      errorMessage: error,
      attempt: 1,
      deliveredAt: status !== null && status >= 200 && status < 300 ? new Date() : null,
      failedAt: status !== null && (status < 200 || status >= 300) ? new Date() : error ? new Date() : null,
    });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error(
      `[webhooks:test] audit row insert failed for endpoint=${endpoint.id}:`,
      e instanceof Error ? e.message : e,
    );
  }

  // Update endpoint last-delivery-cache (nur bei tatsächlich gesendetem
  // HTTP — Timeouts/Netz zählen auch als "letzter Versuch").
  try {
    const isOk = status !== null && status >= 200 && status < 300;
    await db
      .update(webhookEndpoints)
      .set({
        lastDeliveryAt: new Date(),
        lastDeliveryOk: isOk,
        lastDeliveryError: isOk ? null : error ?? (status ? `http_${status}` : "unknown"),
        updatedAt: new Date(),
      })
      .where(eq(webhookEndpoints.id, endpoint.id));
  } catch {
    /* swallow */
  }

  return NextResponse.json({
    ok: status !== null && status >= 200 && status < 300,
    status,
    latencyMs,
    responseExcerpt: truncate(responseBody, 500),
    error,
  });
}
