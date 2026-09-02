export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 *  GET    /api/domains/:id  → detail inkl. Impact (affected campaigns/leads)
 *  PATCH  /api/domains/:id  → Root-Redirect-Ziel setzen/löschen
 *  DELETE /api/domains/:id  → löscht die Domain (Variante B: erlaubt mit
 *                              Warnung clientseitig). Reisst Custom-Domain-
 *                              URLs der zugehoerigen Leads aktiv ab.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireUserApi } from "@/lib/auth-guard";
import {
  deleteUserDomain,
  getDomainImpact,
  getUserDomain,
  updateDomainRootRedirect,
} from "@/lib/db/queries/user-domains";

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
      rootRedirectUrl: d.rootRedirectUrl,
      createdAt: d.createdAt,
    },
    impact,
  });
}

const MAX_REDIRECT_URL_LENGTH = 512;

/**
 * Validiert das Root-Redirect-Ziel. `null`/leer = Zurücksetzen auf die
 * 404-Default-Seite. Sonst: absolute http(s)-URL, nicht auf die Domain
 * selbst (Redirect-Loop auf "/").
 */
function normalizeRedirectUrl(
  input: unknown,
  ownHostname: string,
): { ok: true; value: string | null } | { ok: false; error: string } {
  if (input === null || input === undefined) return { ok: true, value: null };
  if (typeof input !== "string") {
    return { ok: false, error: "rootRedirectUrl muss ein String oder null sein." };
  }
  const trimmed = input.trim();
  if (trimmed === "") return { ok: true, value: null };
  if (trimmed.length > MAX_REDIRECT_URL_LENGTH) {
    return { ok: false, error: `URL darf maximal ${MAX_REDIRECT_URL_LENGTH} Zeichen lang sein.` };
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false, error: "Bitte eine vollständige URL angeben, z.B. https://ihre-firma.de" };
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return { ok: false, error: "Nur http(s)-URLs sind erlaubt." };
  }
  if (parsed.hostname.toLowerCase() === ownHostname.toLowerCase()) {
    return {
      ok: false,
      error: "Die Weiterleitung darf nicht auf die Domain selbst zeigen (Endlosschleife).",
    };
  }
  return { ok: true, value: parsed.toString() };
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requireUserApi();
  if (!auth.ok) return auth.response;
  const { id } = await params;

  const d = await getUserDomain(id, auth.user.id);
  if (!d) return NextResponse.json({ error: "Nicht gefunden." }, { status: 404 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body muss JSON sein." }, { status: 400 });
  }
  if (
    typeof body !== "object" ||
    body === null ||
    !("rootRedirectUrl" in body)
  ) {
    return NextResponse.json(
      { error: "Feld 'rootRedirectUrl' fehlt." },
      { status: 400 },
    );
  }

  const normalized = normalizeRedirectUrl(
    (body as { rootRedirectUrl?: unknown }).rootRedirectUrl,
    d.hostname,
  );
  if (!normalized.ok) {
    return NextResponse.json({ error: normalized.error }, { status: 400 });
  }

  await updateDomainRootRedirect(id, auth.user.id, normalized.value);
  return NextResponse.json({
    ok: true,
    domain: { id: d.id, hostname: d.hostname, rootRedirectUrl: normalized.value },
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

  // Die Traefik-YAML entfernt der Worker-Reconcile binnen 30 s. Der App-
  // Container hat seit 2026-09-02 keinen Traefik-Mount mehr (Security).
  return NextResponse.json({
    ok: true,
    deleted: { id: d.id, hostname: d.hostname },
    impact,
  });
}
