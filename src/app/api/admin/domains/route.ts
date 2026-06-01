export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Custom-Domains: Admin-Endpoint.
 *
 *  GET /api/admin/domains → { domains, stats }
 *
 *  Liefert alle Domains aller Tenants sowie aggregierte Status-Zaehler für
 *  die Admin-Stat-Cards (Aktiv, In-Verifikation, Fehler >1h, Cert <14d).
 */

import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth-guard";
import { listAllDomainsForAdmin } from "@/lib/db/queries/user-domains";

interface AdminDomainStats {
  active: number;
  verifying: number;
  failedOver1h: number;
  certExpiresUnder14d: number;
  total: number;
}

export async function GET(): Promise<NextResponse> {
  const guard = await requireAdminApi();
  if (!guard.ok) return guard.response;

  const domains = await listAllDomainsForAdmin();
  const now = Date.now();
  const HOUR_MS = 60 * 60 * 1000;
  const DAY_MS = 24 * HOUR_MS;

  const stats: AdminDomainStats = {
    active: 0,
    verifying: 0,
    failedOver1h: 0,
    certExpiresUnder14d: 0,
    total: domains.length,
  };

  for (const d of domains) {
    if (d.status === "active") stats.active += 1;
    if (
      d.status === "pending" ||
      d.status === "verifying" ||
      d.status === "issuing_cert"
    ) {
      stats.verifying += 1;
    }
    if (d.status === "failed") {
      const lastTs = d.lastCheckedAt
        ? new Date(d.lastCheckedAt).getTime()
        : new Date(d.createdAt).getTime();
      if (now - lastTs > HOUR_MS) stats.failedOver1h += 1;
    }
    if (
      d.status === "active" &&
      d.sslExpiresAt &&
      new Date(d.sslExpiresAt).getTime() - now < 14 * DAY_MS
    ) {
      stats.certExpiresUnder14d += 1;
    }
  }

  return NextResponse.json({
    domains: domains.map((d) => ({
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
      userId: d.userId,
      userEmail: d.userEmail,
      userName: d.userName,
    })),
    stats,
  });
}
