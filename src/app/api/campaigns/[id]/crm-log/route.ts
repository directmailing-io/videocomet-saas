/**
 * GET /api/campaigns/[id]/crm-log
 *
 *   Query-Params:
 *     status = "ok" | "err" | "all" (default "all")
 *     limit  = 1..200 (default 50)
 *     cursor = string-encoded bigint-id des zuletzt gelesenen Rows
 *
 * Liefert paginierte CRM-Event-Log-Einträge für die Kampagne. Sortierung
 * matched den Index `crm_event_log_campaign_ts_idx (campaign_id, ts DESC)`
 * — zusätzlich nach `id DESC` als Tie-Breaker (mehrere Events derselben
 * `ts`).
 *
 * Defense-in-Depth: `request_body.headers.Authorization` (und ähnliche
 * Header-Namen) werden vor der Ausgabe gestrippt. Phase-2-Code maskiert
 * das schon beim Schreiben — wir wollen aber NIE einen API-Key über
 * dieses Endpoint leaken, selbst wenn ein Bug das Masking umgeht.
 *
 * `bigint` wird als String serialisiert, damit JavaScript-Clients keine
 * Präzisions-Probleme bekommen.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq, lt, sql } from "drizzle-orm";
import { requireUserApi } from "@/lib/auth-guard";
import { db } from "@/lib/db";
import { crmEventLog } from "@/lib/db/schema";
import { getCampaign } from "@/lib/db/queries/campaigns";

const SENSITIVE_HEADERS = new Set([
  "authorization",
  "x-api-key",
  "x-auth-token",
  "cookie",
]);

/**
 * Rekursiv-leichte Maskierung: greift nur am bekannten Pfad
 * `request_body.headers.<sensitive>` und überschreibt den Wert mit
 * `"<redacted>"`. Wir machen NICHT mehr — Tiefer-Geh-Maskierung gehört
 * an die Write-Seite (siehe Worker, Phase 2).
 */
function maskRequestBody(value: unknown): unknown {
  if (!value || typeof value !== "object") return value;
  const obj = value as Record<string, unknown>;
  const headers = obj.headers;
  if (!headers || typeof headers !== "object") return obj;
  const cleaned: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(headers as Record<string, unknown>)) {
    cleaned[k] = SENSITIVE_HEADERS.has(k.toLowerCase()) ? "<redacted>" : v;
  }
  return { ...obj, headers: cleaned };
}

function parseCursor(raw: string | null): bigint | null {
  if (!raw) return null;
  try {
    const value = BigInt(raw);
    if (value <= BigInt(0)) return null;
    return value;
  } catch {
    return null;
  }
}

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await requireUserApi();
  if (!auth.ok) return auth.response;

  try {
    await getCampaign(params.id, auth.user.id);
  } catch {
    return NextResponse.json({ error: "Nicht gefunden." }, { status: 404 });
  }

  const url = req.nextUrl;
  const statusParam = url.searchParams.get("status");
  const status: "ok" | "err" | "all" =
    statusParam === "ok" || statusParam === "err" ? statusParam : "all";

  const limitRaw = Number.parseInt(url.searchParams.get("limit") ?? "50", 10);
  const limit = Number.isFinite(limitRaw)
    ? Math.min(200, Math.max(1, limitRaw))
    : 50;

  const cursor = parseCursor(url.searchParams.get("cursor"));

  const whereParts = [eq(crmEventLog.campaignId, params.id)];
  if (status === "ok") {
    whereParts.push(sql`${crmEventLog.httpStatus} >= 200 AND ${crmEventLog.httpStatus} < 300`);
  } else if (status === "err") {
    whereParts.push(
      sql`(${crmEventLog.httpStatus} IS NULL OR ${crmEventLog.httpStatus} >= 400 OR ${crmEventLog.errorMessage} IS NOT NULL)`,
    );
  }
  if (cursor !== null) {
    whereParts.push(lt(crmEventLog.id, cursor));
  }

  // Order matched den Index (campaign_id, ts DESC) — id DESC als
  // deterministischer Tie-Breaker, damit der `lt(id, cursor)`-Pager
  // auch bei identischen `ts` korrekt durchläuft.
  const rows = await db
    .select({
      id: crmEventLog.id,
      campaignId: crmEventLog.campaignId,
      leadId: crmEventLog.leadId,
      integrationId: crmEventLog.integrationId,
      eventKind: crmEventLog.eventKind,
      lookupField: crmEventLog.lookupField,
      lookupValue: crmEventLog.lookupValue,
      contactId: crmEventLog.contactId,
      httpStatus: crmEventLog.httpStatus,
      requestBody: crmEventLog.requestBody,
      responseBody: crmEventLog.responseBody,
      errorMessage: crmEventLog.errorMessage,
      attempt: crmEventLog.attempt,
      ts: crmEventLog.ts,
    })
    .from(crmEventLog)
    .where(and(...whereParts))
    .orderBy(desc(crmEventLog.ts), desc(crmEventLog.id))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page[page.length - 1];
  const nextCursor = hasMore && last ? last.id.toString() : null;

  const serialized = page.map((r) => ({
    ...r,
    id: r.id.toString(),
    requestBody: maskRequestBody(r.requestBody),
  }));

  return NextResponse.json({ rows: serialized, nextCursor });
}
