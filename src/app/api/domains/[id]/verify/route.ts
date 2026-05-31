export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/domains/:id/verify
 *
 * Triggert einen sofortigen Re-Check fuer eine Domain. Der naechste reguläre
 * Verifier-Tick wuerde innerhalb von 30s sowieso laufen — dieser Endpoint
 * gibt dem User eine "Jetzt pruefen"-Aktion fuer die UI.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireUserApi } from "@/lib/auth-guard";
import {
  getDomainImpact,
  getUserDomain,
} from "@/lib/db/queries/user-domains";
import { forceDomainRecheck } from "@/worker/jobs/domain-verifier";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requireUserApi();
  if (!auth.ok) return auth.response;
  const { id } = await params;

  const owned = await getUserDomain(id, auth.user.id);
  if (!owned) return NextResponse.json({ error: "Nicht gefunden." }, { status: 404 });

  const updated = await forceDomainRecheck(id);
  if (!updated) {
    return NextResponse.json(
      { error: "Re-Check fehlgeschlagen." },
      { status: 500 },
    );
  }

  const impact = await getDomainImpact(updated.id);
  return NextResponse.json({
    domain: {
      id: updated.id,
      hostname: updated.hostname,
      status: updated.status,
      verifiedAt: updated.verifiedAt,
      sslIssuedAt: updated.sslIssuedAt,
      sslExpiresAt: updated.sslExpiresAt,
      lastCheckedAt: updated.lastCheckedAt,
      lastError: updated.lastError,
    },
    impact,
  });
}
