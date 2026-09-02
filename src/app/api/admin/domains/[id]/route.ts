export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 *  GET    /api/admin/domains/:id  → Detail inkl. Impact + Check-Log (20 letzte)
 *  DELETE /api/admin/domains/:id  → Loescht die Domain ohne Tenant-Filter.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth-guard";
import {
  deleteUserDomainAdmin,
  getDomainByIdAdmin,
  getDomainImpact,
  listDomainCheckLog,
} from "@/lib/db/queries/user-domains";
import { verifyRecordName, verifyRecordValue } from "@/lib/domain-utils";
import { logAdminAction } from "@/lib/admin-audit";

export async function GET(
  _req: NextRequest,
  ctx: { params: { id: string } },
): Promise<NextResponse> {
  const guard = await requireAdminApi();
  if (!guard.ok) return guard.response;

  const d = await getDomainByIdAdmin(ctx.params.id);
  if (!d) {
    return NextResponse.json({ error: "Nicht gefunden." }, { status: 404 });
  }

  const [impact, log] = await Promise.all([
    getDomainImpact(d.id),
    listDomainCheckLog(d.id, 20),
  ]);

  return NextResponse.json({
    domain: {
      id: d.id,
      hostname: d.hostname,
      kind: d.kind,
      status: d.status,
      verifyToken: d.verifyToken,
      verifiedAt: d.verifiedAt,
      sslIssuedAt: d.sslIssuedAt,
      sslExpiresAt: d.sslExpiresAt,
      lastCheckedAt: d.lastCheckedAt,
      lastError: d.lastError,
      createdAt: d.createdAt,
      userId: d.userId,
      dnsInstructions: {
        verifyRecord: {
          type: "TXT",
          name: verifyRecordName(d.hostname),
          value: verifyRecordValue(d.verifyToken),
        },
        pointing:
          d.kind === "subdomain"
            ? {
                type: "CNAME",
                name: d.hostname,
                value: process.env.CNAME_TARGET ?? "cname.videocomet.de",
              }
            : {
                type: "A",
                name: d.hostname,
                value: process.env.SERVER_IP ?? "178.105.208.68",
              },
      },
    },
    impact,
    log: log.map((row) => ({
      id: row.id,
      ts: row.ts,
      kind: row.kind,
      ok: row.ok,
      message: row.message,
    })),
  });
}

export async function DELETE(
  req: NextRequest,
  ctx: { params: { id: string } },
): Promise<NextResponse> {
  const guard = await requireAdminApi();
  if (!guard.ok) return guard.response;

  const d = await getDomainByIdAdmin(ctx.params.id);
  if (!d) {
    return NextResponse.json({ error: "Nicht gefunden." }, { status: 404 });
  }

  const impact = await getDomainImpact(d.id);
  const res = await deleteUserDomainAdmin(d.id);
  if (!res.deleted) {
    return NextResponse.json({ error: "Nicht gefunden." }, { status: 404 });
  }

  // Traefik-YAML räumt der Worker-Reconcile binnen 30 s weg (kein
  // Dateisystem-Zugriff aus dem App-Container seit 2026-09-02).
  await logAdminAction({
    admin: { id: guard.user.id, email: guard.user.email },
    action: "domain.delete",
    targetType: "domain",
    targetId: d.id,
    details: { hostname: d.hostname, userId: d.userId, impact },
    req,
  });
  return NextResponse.json({
    ok: true,
    deleted: { id: d.id, hostname: d.hostname },
    impact,
  });
}
