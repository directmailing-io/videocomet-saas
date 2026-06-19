/**
 * REST API für die Contact-Felder einer CRM-Integration.
 *
 *   GET  → Liste aller Contact-Felder vom Provider (gecached 60s).
 *   POST → Legt ein neues Custom-Feld an (HubSpot/Close). Salessuite
 *          wirft `CrmFeatureUnsupportedError` → 409 mit Klartext.
 *
 * Cache-Strategie: Process-lokal, keyed by integration-id, TTL 60s.
 * Im Multi-Instance-Setup (Coolify) sieht jeder Prozess einen eigenen
 * Cache — das ist akzeptabel: der User klickt typischerweise dieselbe
 * Integration mehrfach hintereinander, und ein „Felder neu laden"-Button
 * kann den Cache via POST → invalidate umgehen.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { requireUserApi } from "@/lib/auth-guard";
import { db } from "@/lib/db";
import { crmIntegrations } from "@/lib/db/schema";
import { getCrmProvider } from "@/lib/crm/registry";
import { decryptApiKey } from "@/lib/crm/crypto";
import { CrmFeatureUnsupportedError, type CrmField } from "@/lib/crm/types";

interface CacheEntry {
  fields: CrmField[];
  cachedAt: number;
}

const CACHE_TTL_MS = 60_000;
const fieldsCache = new Map<string, CacheEntry>();

function getCached(id: string): CacheEntry | null {
  const entry = fieldsCache.get(id);
  if (!entry) return null;
  if (Date.now() - entry.cachedAt > CACHE_TTL_MS) {
    fieldsCache.delete(id);
    return null;
  }
  return entry;
}

function setCached(id: string, fields: CrmField[]): CacheEntry {
  const entry: CacheEntry = { fields, cachedAt: Date.now() };
  fieldsCache.set(id, entry);
  return entry;
}

function invalidate(id: string): void {
  fieldsCache.delete(id);
}

const createFieldSchema = z.object({
  label: z.string().min(1).max(120),
  type: z.enum(["datetime", "text"]),
  name: z.string().min(1).max(120).optional(),
});

async function loadIntegration(
  integrationId: string,
  userId: string,
): Promise<{
  provider: "hubspot" | "salessuite" | "close";
  apiKeyEncrypted: string;
} | null> {
  const [row] = await db
    .select({
      provider: crmIntegrations.provider,
      apiKeyEncrypted: crmIntegrations.apiKeyEncrypted,
    })
    .from(crmIntegrations)
    .where(
      and(
        eq(crmIntegrations.id, integrationId),
        eq(crmIntegrations.userId, userId),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await requireUserApi();
  if (!auth.ok) return auth.response;

  const integ = await loadIntegration(params.id, auth.user.id);
  if (!integ) {
    return NextResponse.json({ error: "Nicht gefunden." }, { status: 404 });
  }

  const cached = getCached(params.id);
  if (cached) {
    return NextResponse.json({
      fields: cached.fields,
      cachedAt: new Date(cached.cachedAt).toISOString(),
    });
  }

  let plaintext: string;
  try {
    plaintext = decryptApiKey(integ.apiKeyEncrypted);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[crm:fields] decrypt failed:", err);
    return NextResponse.json(
      { error: "API-Key konnte nicht entschlüsselt werden." },
      { status: 500 },
    );
  }

  const provider = getCrmProvider(integ.provider);
  let fields: CrmField[];
  try {
    fields = await provider.listContactFields(plaintext);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[crm:fields] list failed:", err);
    return NextResponse.json(
      {
        error: "Felder konnten nicht geladen werden.",
        details: err instanceof Error ? err.message : null,
      },
      { status: 502 },
    );
  }

  const entry = setCached(params.id, fields);
  return NextResponse.json({
    fields: entry.fields,
    cachedAt: new Date(entry.cachedAt).toISOString(),
  });
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await requireUserApi();
  if (!auth.ok) return auth.response;

  const integ = await loadIntegration(params.id, auth.user.id);
  if (!integ) {
    return NextResponse.json({ error: "Nicht gefunden." }, { status: 404 });
  }

  let body: z.infer<typeof createFieldSchema>;
  try {
    body = createFieldSchema.parse(await req.json());
  } catch (err) {
    return NextResponse.json(
      {
        error: "Ungültige Eingabe.",
        details: err instanceof Error ? err.message : null,
      },
      { status: 400 },
    );
  }

  let plaintext: string;
  try {
    plaintext = decryptApiKey(integ.apiKeyEncrypted);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[crm:fields:create] decrypt failed:", err);
    return NextResponse.json(
      { error: "API-Key konnte nicht entschlüsselt werden." },
      { status: 500 },
    );
  }

  const provider = getCrmProvider(integ.provider);
  try {
    const field = await provider.createContactField(plaintext, {
      label: body.label,
      type: body.type,
      name: body.name,
    });
    invalidate(params.id);
    return NextResponse.json({ field }, { status: 201 });
  } catch (err) {
    if (err instanceof CrmFeatureUnsupportedError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    // eslint-disable-next-line no-console
    console.error("[crm:fields:create] failed:", err);
    return NextResponse.json(
      {
        error: "Feld konnte nicht angelegt werden.",
        details: err instanceof Error ? err.message : null,
      },
      { status: 502 },
    );
  }
}
