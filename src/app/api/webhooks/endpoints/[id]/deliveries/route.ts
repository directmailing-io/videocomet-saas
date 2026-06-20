/**
 * GET /api/webhooks/endpoints/:id/deliveries?status=ok|err|pending&cursor=<bigint>&limit=50
 *
 * Cursor-Pagination über `(ts DESC, id DESC)`. Cursor ist die `id` der
 * letzten Row in der vorherigen Seite (eine BigInt; transportiert als
 * String). `status`:
 *   - ok       → `delivered_at IS NOT NULL`
 *   - err      → `failed_at IS NOT NULL`
 *   - pending  → beide NULL (entweder noch in-flight oder im Backoff)
 *
 * Antwort: `{ deliveries: [...], nextCursor: string | null }`.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq, isNotNull, isNull, lt, sql } from "drizzle-orm";
import { requireUserApi } from "@/lib/auth-guard";
import { db } from "@/lib/db";
import { webhookDeliveries } from "@/lib/db/schema";
import { requireWebhookEndpoint } from "@/lib/webhooks/auth";

export async function GET(
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

  const url = req.nextUrl;
  const statusParam = url.searchParams.get("status");
  const cursorParam = url.searchParams.get("cursor");
  const limitParam = Number.parseInt(url.searchParams.get("limit") ?? "50", 10);
  const limit = Math.max(1, Math.min(200, Number.isFinite(limitParam) ? limitParam : 50));

  const conditions = [eq(webhookDeliveries.endpointId, params.id)];

  if (statusParam === "ok") {
    conditions.push(isNotNull(webhookDeliveries.deliveredAt));
  } else if (statusParam === "err") {
    conditions.push(isNotNull(webhookDeliveries.failedAt));
  } else if (statusParam === "pending") {
    conditions.push(isNull(webhookDeliveries.deliveredAt));
    conditions.push(isNull(webhookDeliveries.failedAt));
  }

  // Cursor: id < cursor → nächste Seite älter.
  if (cursorParam && /^\d+$/.test(cursorParam)) {
    try {
      const cursorBig = BigInt(cursorParam);
      conditions.push(lt(webhookDeliveries.id, cursorBig));
    } catch {
      /* swallow */
    }
  }

  const rows = await db
    .select({
      id: webhookDeliveries.id,
      endpointId: webhookDeliveries.endpointId,
      eventKind: webhookDeliveries.eventKind,
      eventId: webhookDeliveries.eventId,
      leadId: webhookDeliveries.leadId,
      runId: webhookDeliveries.runId,
      campaignId: webhookDeliveries.campaignId,
      httpStatus: webhookDeliveries.httpStatus,
      errorMessage: webhookDeliveries.errorMessage,
      attempt: webhookDeliveries.attempt,
      nextRetryAt: webhookDeliveries.nextRetryAt,
      deliveredAt: webhookDeliveries.deliveredAt,
      failedAt: webhookDeliveries.failedAt,
      ts: webhookDeliveries.ts,
    })
    .from(webhookDeliveries)
    .where(and(...conditions))
    .orderBy(desc(webhookDeliveries.ts), desc(webhookDeliveries.id))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const nextCursor = hasMore ? String(page[page.length - 1]!.id) : null;

  // BigInt → String für JSON-Serialisierung.
  const serialised = page.map((r) => ({
    ...r,
    id: String(r.id),
  }));

  // sql ist hier ungenutzt — nur als Library-Re-Export gehalten, wir
  // brauchen ihn nicht.
  void sql;

  return NextResponse.json({ deliveries: serialised, nextCursor });
}
