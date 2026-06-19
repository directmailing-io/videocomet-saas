/**
 * POST /api/crm/integrations/[id]/test
 *
 * Triggert einen Live-`testConnection` gegen die CRM-API, schreibt das
 * Ergebnis (`last_tested_at`, `last_test_ok`, `last_test_error`) zurück
 * und räumt — bei Erfolg — den `disabled_at`-Marker ab. Bei Fehlschlag
 * lassen wir `disabled_at` unverändert: ein bereits manuell disabled-tes
 * Integration soll NICHT durch einen erfolglosen Re-Test wieder
 * aktiv gestempelt werden, aber sie soll auch nicht durch einen Fehler
 * automatisch deaktiviert werden — das macht der Worker (Phase 2) auf
 * Basis von Push-Failure-Counts.
 *
 * Response: `{ ok, error?, metadata? }`. HTTP 200 in beiden Fällen — der
 * Fehlertext steht im Body, damit die UI die Pille einfach grün/rot
 * setzen kann.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { requireUserApi } from "@/lib/auth-guard";
import { db } from "@/lib/db";
import { crmIntegrations } from "@/lib/db/schema";
import { getCrmProvider } from "@/lib/crm/registry";
import { decryptApiKey } from "@/lib/crm/crypto";

export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await requireUserApi();
  if (!auth.ok) return auth.response;

  const [row] = await db
    .select({
      id: crmIntegrations.id,
      provider: crmIntegrations.provider,
      apiKeyEncrypted: crmIntegrations.apiKeyEncrypted,
    })
    .from(crmIntegrations)
    .where(
      and(
        eq(crmIntegrations.id, params.id),
        eq(crmIntegrations.userId, auth.user.id),
      ),
    )
    .limit(1);
  if (!row) {
    return NextResponse.json({ error: "Nicht gefunden." }, { status: 404 });
  }

  let plaintext: string;
  try {
    plaintext = decryptApiKey(row.apiKeyEncrypted);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[crm:test] decrypt failed:", err);
    return NextResponse.json(
      { error: "API-Key konnte nicht entschlüsselt werden." },
      { status: 500 },
    );
  }

  const provider = getCrmProvider(row.provider);
  let result: { ok: boolean; error?: string; metadata?: Record<string, unknown> };
  try {
    result = await provider.testConnection(plaintext);
  } catch (err) {
    result = { ok: false, error: err instanceof Error ? err.message : String(err) };
  }

  const now = new Date();
  try {
    if (result.ok) {
      await db
        .update(crmIntegrations)
        .set({
          lastTestedAt: now,
          lastTestOk: true,
          lastTestError: null,
          disabledAt: null,
          metadata: result.metadata ?? {},
        })
        .where(
          and(
            eq(crmIntegrations.id, params.id),
            eq(crmIntegrations.userId, auth.user.id),
          ),
        );
    } else {
      // Fehlschlag: `disabledAt` NICHT anfassen (siehe Modul-Kommentar).
      await db
        .update(crmIntegrations)
        .set({
          lastTestedAt: now,
          lastTestOk: false,
          lastTestError: result.error ?? "Unbekannter Fehler",
        })
        .where(
          and(
            eq(crmIntegrations.id, params.id),
            eq(crmIntegrations.userId, auth.user.id),
          ),
        );
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[crm:test] persist failed:", err);
  }

  return NextResponse.json({
    ok: result.ok,
    error: result.ok ? undefined : (result.error ?? "Unbekannter Fehler"),
    metadata: result.ok ? (result.metadata ?? {}) : undefined,
  });
}
