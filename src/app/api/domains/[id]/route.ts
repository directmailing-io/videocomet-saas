export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 *  GET    /api/domains/:id  → detail inkl. Impact (affected campaigns/leads)
 *  DELETE /api/domains/:id  → loescht die Domain (Variante B: erlaubt mit
 *                              Warnung clientseitig). Reisst Custom-Domain-
 *                              URLs der zugehoerigen Leads aktiv ab.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireUserApi } from "@/lib/auth-guard";
import {
  deleteUserDomain,
  getDomainImpact,
  getUserDomain,
} from "@/lib/db/queries/user-domains";
import { cleanupDeletedDomain } from "@/worker/jobs/domain-verifier";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requireUserApi();
  if (!auth.ok) return auth.response;
  const { id } = await params;

  const d = await getUserDomain(id, auth.user.id);
  if (!d) return NextResponse.json({ error: "Nicht gefunden." }, { status: 404 });

  const impact = await getDomainImpact(d.id);
  return NextResponse.json({
    domain: {
      id: d.id,
      hostname: d.hostname,
      kind: d.kind,
      status: d.status,
      verifiedAt: d.verifiedAt,
      sslIssuedAt: d.sslIssuedAt,
      sslExpiresAt: d.sslExpiresAt,
      lastCheckedAt: d.lastCheckedAt,
      lastError: d.lastError,
      createdAt: d.createdAt,
    },
    impact,
  });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requireUserApi();
  if (!auth.ok) return auth.response;
  const { id } = await params;

  const d = await getUserDomain(id, auth.user.id);
  if (!d) return NextResponse.json({ error: "Nicht gefunden." }, { status: 404 });

  const impact = await getDomainImpact(d.id);
  const res = await deleteUserDomain(id, auth.user.id);
  if (!res.deleted) {
    return NextResponse.json({ error: "Nicht gefunden." }, { status: 404 });
  }

  // Best-effort: Traefik-YAML loeschen, damit die Domain sofort nicht mehr
  // routet (sonst wartet Traefik bis zum Watch-Reload).
  if (res.hostname) {
    await cleanupDeletedDomain(res.hostname);
  }

  return NextResponse.json({
    ok: true,
    deleted: { id: d.id, hostname: d.hostname },
    impact,
  });
}
