export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Custom-Domains: User-Endpoints.
 *
 *  GET  /api/domains       → Liste der eigenen Domains
 *  POST /api/domains       → neue Domain anlegen (hostname als JSON-Body)
 */

import { NextRequest, NextResponse } from "next/server";
import { requireUserApi } from "@/lib/auth-guard";
import {
  createUserDomain,
  listUserDomains,
} from "@/lib/db/queries/user-domains";
import { verifyRecordName, verifyRecordValue } from "@/lib/domain-utils";

export async function GET(): Promise<NextResponse> {
  const auth = await requireUserApi();
  if (!auth.ok) return auth.response;
  const domains = await listUserDomains(auth.user.id);
  return NextResponse.json({
    domains: domains.map((d) => ({
      id: d.id,
      hostname: d.hostname,
      kind: d.kind,
      status: d.status,
      verifiedAt: d.verifiedAt,
      sslExpiresAt: d.sslExpiresAt,
      lastCheckedAt: d.lastCheckedAt,
      lastError: d.lastError,
      rootRedirectUrl: d.rootRedirectUrl,
      createdAt: d.createdAt,
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
    })),
  });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const auth = await requireUserApi();
  if (!auth.ok) return auth.response;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Body muss JSON sein." },
      { status: 400 },
    );
  }
  const hostname = (body as { hostname?: unknown })?.hostname;
  if (typeof hostname !== "string" || hostname.trim() === "") {
    return NextResponse.json(
      { error: "Feld 'hostname' fehlt." },
      { status: 400 },
    );
  }

  const result = await createUserDomain(auth.user.id, hostname);
  if (!result.ok) {
    const status =
      result.code === "limit"
        ? 409
        : result.code === "duplicate"
          ? 409
          : 400;
    return NextResponse.json(
      { error: result.message, code: result.code },
      { status },
    );
  }

  const d = result.domain;
  return NextResponse.json(
    {
      domain: {
        id: d.id,
        hostname: d.hostname,
        kind: d.kind,
        status: d.status,
        createdAt: d.createdAt,
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
    },
    { status: 201 },
  );
}
