export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/admin/domains/:id/reset
 *
 * Setzt eine Domain auf den initialen 'pending'-State zurück. Cleant zuerst
 * die Traefik-YAML (damit ein evtl. kaputtes Routing weg ist) und nullt dann
 * lastError / Cert-Felder. Der Verifier-Worker picked die Domain beim
 * nächsten Tick wieder auf und faehrt den Lifecycle frisch durch.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth-guard";
import {
  getDomainByIdAdmin,
  resetDomainAdmin,
} from "@/lib/db/queries/user-domains";
import { cleanupDeletedDomain } from "@/worker/jobs/domain-verifier";

export async function POST(
  _req: NextRequest,
  ctx: { params: { id: string } },
): Promise<NextResponse> {
  const guard = await requireAdminApi();
  if (!guard.ok) return guard.response;

  const d = await getDomainByIdAdmin(ctx.params.id);
  if (!d) {
    return NextResponse.json({ error: "Nicht gefunden." }, { status: 404 });
  }

  // Best-effort: Traefik-YAML entfernen — der Verifier schreibt sie beim
  // nächsten erfolgreichen Tick neu. So sind wir sicher, dass kein
  // verwaister Cert/Router-Eintrag mehr lebt.
  try {
    await cleanupDeletedDomain(d.hostname);
  } catch (err) {
    console.warn("[admin:domains:reset] cleanup warn", err);
  }

  await resetDomainAdmin(d.id);

  const updated = await getDomainByIdAdmin(d.id);
  return NextResponse.json({
    ok: true,
    domain: updated
      ? {
          id: updated.id,
          hostname: updated.hostname,
          kind: updated.kind,
          status: updated.status,
          verifiedAt: updated.verifiedAt,
          sslIssuedAt: updated.sslIssuedAt,
          sslExpiresAt: updated.sslExpiresAt,
          lastCheckedAt: updated.lastCheckedAt,
          lastError: updated.lastError,
          createdAt: updated.createdAt,
        }
      : null,
  });
}
