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
import { logAdminAction } from "@/lib/admin-audit";

export async function POST(
  req: NextRequest,
  ctx: { params: { id: string } },
): Promise<NextResponse> {
  const guard = await requireAdminApi();
  if (!guard.ok) return guard.response;

  const d = await getDomainByIdAdmin(ctx.params.id);
  if (!d) {
    return NextResponse.json({ error: "Nicht gefunden." }, { status: 404 });
  }

  // Die Traefik-YAML entfernt der Worker-Tick binnen 30 s (Reconcile:
  // Domains ohne Status issuing_cert/active haben keine YAML). Der App-
  // Container fasst seit 2026-09-02 keine Traefik-Dateien mehr an.
  await resetDomainAdmin(d.id);
  await logAdminAction({
    admin: { id: guard.user.id, email: guard.user.email },
    action: "domain.reset",
    targetType: "domain",
    targetId: d.id,
    details: { hostname: d.hostname, previousStatus: d.status },
    req,
  });

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
