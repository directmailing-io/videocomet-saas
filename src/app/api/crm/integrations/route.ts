/**
 * REST API für CRM-Integrationen des angemeldeten Users.
 *
 *   GET  → Liste aller Integrations (ohne API-Key-Klartext).
 *   POST → Legt eine neue Integration an. VOR dem Insert wird
 *          `provider.testConnection(apiKey)` aufgerufen — bei Misserfolg
 *          400, bei Erfolg encrypt + insert + Test-Marker setzen.
 *
 * Tenant-Guard: `requireUserApi`. Uniqueness pro (userId, name) ist im
 * Schema als UNIQUE-Constraint angelegt; wir fangen 23505 zusätzlich
 * defensiv ab, falls die Zod-Validierung mal nicht greift (Race-Condition
 * zwischen zwei parallelen POSTs).
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import { requireUserApi } from "@/lib/auth-guard";
import { db } from "@/lib/db";
import { crmIntegrations } from "@/lib/db/schema";
import { getCrmProvider } from "@/lib/crm/registry";
import { apiKeyHint, encryptApiKey } from "@/lib/crm/crypto";

const providerEnum = z.enum(["hubspot", "salessuite", "close"]);

const createSchema = z.object({
  provider: providerEnum,
  name: z.string().min(1, "Name darf nicht leer sein.").max(80),
  apiKey: z.string().min(1, "API-Key darf nicht leer sein."),
});

function isUniqueViolation(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const inner =
    (err as { cause?: unknown }).cause &&
    typeof (err as { cause?: unknown }).cause === "object"
      ? ((err as { cause: Record<string, unknown> }).cause as Record<
          string,
          unknown
        >)
      : (err as Record<string, unknown>);
  return inner.code === "23505";
}

export async function GET() {
  const auth = await requireUserApi();
  if (!auth.ok) return auth.response;

  const rows = await db
    .select({
      id: crmIntegrations.id,
      provider: crmIntegrations.provider,
      name: crmIntegrations.name,
      apiKeyHint: crmIntegrations.apiKeyHint,
      createdAt: crmIntegrations.createdAt,
      lastTestedAt: crmIntegrations.lastTestedAt,
      lastTestOk: crmIntegrations.lastTestOk,
      lastTestError: crmIntegrations.lastTestError,
      disabledAt: crmIntegrations.disabledAt,
      metadata: crmIntegrations.metadata,
    })
    .from(crmIntegrations)
    .where(eq(crmIntegrations.userId, auth.user.id))
    .orderBy(desc(crmIntegrations.createdAt));

  return NextResponse.json({ integrations: rows });
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

  // Vorab-Check auf Name-Uniqueness — vermeidet einen unnötigen Provider-
  // Test, wenn der Name eh schon vergeben ist. Race-Condition fängt die
  // DB-Constraint unten ab.
  const [existing] = await db
    .select({ id: crmIntegrations.id })
    .from(crmIntegrations)
    .where(
      and(
        eq(crmIntegrations.userId, auth.user.id),
        eq(crmIntegrations.name, body.name),
      ),
    )
    .limit(1);
  if (existing) {
    return NextResponse.json(
      { error: "Name bereits vergeben" },
      { status: 409 },
    );
  }

  // Provider-Test gegen die CRM-API. Wir wollen NIE eine kaputte
  // Connection persistieren — der User soll sofort sehen, dass der Key
  // nicht funktioniert.
  const provider = getCrmProvider(body.provider);
  let testResult: { ok: boolean; error?: string; metadata?: Record<string, unknown> };
  try {
    testResult = await provider.testConnection(body.apiKey);
  } catch (err) {
    return NextResponse.json(
      {
        error: "Verbindungstest fehlgeschlagen.",
        details: err instanceof Error ? err.message : null,
      },
      { status: 400 },
    );
  }
  if (!testResult.ok) {
    return NextResponse.json(
      { error: testResult.error ?? "Verbindungstest fehlgeschlagen." },
      { status: 400 },
    );
  }

  const now = new Date();
  let inserted;
  try {
    [inserted] = await db
      .insert(crmIntegrations)
      .values({
        userId: auth.user.id,
        provider: body.provider,
        name: body.name,
        apiKeyEncrypted: encryptApiKey(body.apiKey),
        apiKeyHint: apiKeyHint(body.apiKey),
        metadata: testResult.metadata ?? {},
        lastTestedAt: now,
        lastTestOk: true,
        lastTestError: null,
      })
      .returning({
        id: crmIntegrations.id,
        provider: crmIntegrations.provider,
        name: crmIntegrations.name,
        apiKeyHint: crmIntegrations.apiKeyHint,
        lastTestedAt: crmIntegrations.lastTestedAt,
        lastTestOk: crmIntegrations.lastTestOk,
        metadata: crmIntegrations.metadata,
        disabledAt: crmIntegrations.disabledAt,
      });
  } catch (err) {
    if (isUniqueViolation(err)) {
      return NextResponse.json(
        { error: "Name bereits vergeben" },
        { status: 409 },
      );
    }
    // eslint-disable-next-line no-console
    console.error("[crm:integrations] insert failed:", err);
    return NextResponse.json(
      { error: "Integration konnte nicht angelegt werden." },
      { status: 500 },
    );
  }

  if (!inserted) {
    return NextResponse.json(
      { error: "Integration konnte nicht angelegt werden." },
      { status: 500 },
    );
  }

  return NextResponse.json(inserted, { status: 201 });
}
