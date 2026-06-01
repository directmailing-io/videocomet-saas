export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/admin/domains/:id/recheck
 *
 * Erzwingt einen sofortigen DNS + TXT + Cert-Re-Check über den Verifier-Job
 * und liefert die aktualisierte Domain zurück.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth-guard";
import { forceDomainRecheck } from "@/worker/jobs/domain-verifier";

export async function POST(
  _req: NextRequest,
  ctx: { params: { id: string } },
): Promise<NextResponse> {
  const guard = await requireAdminApi();
  if (!guard.ok) return guard.response;

  try {
    const updated = await forceDomainRecheck(ctx.params.id);
    if (!updated) {
      return NextResponse.json({ error: "Nicht gefunden." }, { status: 404 });
    }
    return NextResponse.json({
      ok: true,
      domain: {
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
      },
    });
  } catch (err) {
    console.error("[admin:domains:recheck] error", err);
    return NextResponse.json(
      { error: "Re-Check fehlgeschlagen." },
      { status: 500 },
    );
  }
}
