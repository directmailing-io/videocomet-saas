/**
 * POST /api/v1/lists/:id/contacts — Public-Endpoint für Automation
 * (Mini-CRM Etappe 6b, Zapier/Make/n8n).
 *
 * Auth:  Header `Authorization: Bearer vc_live_...`
 * Idempotency: Header `Idempotency-Key: <string>` (empfohlen).
 *              Bei doppeltem Key innerhalb 24h wird die cached Response
 *              zurückgegeben statt der Contact ein zweites Mal angelegt.
 *
 * Body:
 *   { email?, firstName?, lastName?, company?, phone?, linkedinUrl?,
 *     customFields?: Record<string,string> }
 *
 * Response 201:
 *   { contactId, status: "created" | "updated", listId }
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { contactLists } from "@/lib/db/schema";
import {
  authenticateApiKey,
  bumpApiKeyUsage,
  findIdempotentResponse,
} from "@/lib/db/queries/api-keys";
import { bulkImportContacts } from "@/lib/db/queries/contacts";

// Sehr simples In-Memory-Rate-Limit: pro Key max 60 Requests/Minute.
// Für Multi-Instance kommt Redis später.
const rateBuckets = new Map<string, { count: number; windowStart: number }>();
const RATE_LIMIT = 60;
const WINDOW_MS = 60_000;
function checkRate(keyId: string): boolean {
  const now = Date.now();
  const b = rateBuckets.get(keyId);
  if (!b || now - b.windowStart > WINDOW_MS) {
    rateBuckets.set(keyId, { count: 1, windowStart: now });
    return true;
  }
  if (b.count >= RATE_LIMIT) return false;
  b.count++;
  return true;
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  // 1. Auth
  const authHeader = req.headers.get("authorization") ?? "";
  const bearer = authHeader.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!bearer) {
    return NextResponse.json(
      { error: "Bearer-Token erwartet." },
      { status: 401 },
    );
  }
  const key = await authenticateApiKey(bearer);
  if (!key) {
    return NextResponse.json(
      { error: "Ungültiger oder revoked API-Key." },
      { status: 401 },
    );
  }

  // 2. Rate-Limit
  if (!checkRate(key.id)) {
    return NextResponse.json(
      { error: "Rate-Limit überschritten (60 Anfragen/Minute)." },
      { status: 429, headers: { "Retry-After": "60" } },
    );
  }

  // 3. Ownership: Liste muss dem Key-User gehören
  const [list] = await db
    .select({ id: contactLists.id, autoRunCampaignId: contactLists.autoRunCampaignId })
    .from(contactLists)
    .where(and(eq(contactLists.id, params.id), eq(contactLists.userId, key.userId)))
    .limit(1);
  if (!list) {
    return NextResponse.json({ error: "Liste nicht gefunden." }, { status: 404 });
  }

  // 4. Idempotency-Lookup
  const idemKey = req.headers.get("idempotency-key") ?? undefined;
  if (idemKey) {
    const cached = findIdempotentResponse(key, idemKey);
    if (cached) {
      return new NextResponse(cached, {
        status: 200,
        headers: { "Content-Type": "application/json", "X-Idempotent-Replay": "1" },
      });
    }
  }

  // 5. Body parsen
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Ungültiges JSON." }, { status: 400 });
  }
  const b = (body ?? {}) as Record<string, unknown>;
  const asStr = (v: unknown): string | undefined =>
    typeof v === "string" && v.trim() ? v.trim() : undefined;

  const customFields =
    b.customFields && typeof b.customFields === "object"
      ? Object.fromEntries(
          Object.entries(b.customFields as Record<string, unknown>)
            .filter(([, v]) => typeof v === "string")
            .map(([k, v]) => [k, String(v)]),
        )
      : {};

  const email = asStr(b.email);
  const firstName = asStr(b.firstName);
  const lastName = asStr(b.lastName);
  const company = asStr(b.company);
  if (!email && !(firstName || lastName) && !company) {
    return NextResponse.json(
      { error: "Mindestens email, name oder company erforderlich." },
      { status: 400 },
    );
  }

  // 6. Import via bulkImportContacts (behandelt Upsert-Semantik).
  try {
    const result = await bulkImportContacts({
      userId: key.userId,
      listId: list.id,
      rows: [
        {
          email,
          firstName,
          lastName,
          company,
          phone: asStr(b.phone),
          linkedinUrl: asStr(b.linkedinUrl),
          data: customFields,
        },
      ],
    });
    const contactId = result.contactIds[0];
    const status = result.created > 0 ? "created" : result.updated > 0 ? "updated" : "skipped";

    const responseBody = JSON.stringify({
      contactId,
      status,
      listId: list.id,
      autoRunCampaignId: list.autoRunCampaignId,
    });

    // 7. Idempotency-Cache + Usage-Bump
    await bumpApiKeyUsage({
      id: key.id,
      idempotencyKey: idemKey,
      responseJson: idemKey ? responseBody : undefined,
    });

    return new NextResponse(responseBody, {
      status: 201,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[api/v1] contact import failed:", err);
    return NextResponse.json(
      { error: "Contact konnte nicht angelegt werden.", details: err instanceof Error ? err.message : null },
      { status: 500 },
    );
  }
}
