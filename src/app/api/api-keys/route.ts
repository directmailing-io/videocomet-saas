/**
 * API-Key-Management (Mini-CRM Etappe 6b).
 *
 *   GET  /api/api-keys        — alle Keys des Users (Prefix + Metadaten)
 *   POST /api/api-keys        — neuen Key anlegen (Klartext EINMAL zurück)
 *   Das Löschen läuft über /api/api-keys/:id.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { requireUserApi } from "@/lib/auth-guard";
import { createApiKey, listApiKeys } from "@/lib/db/queries/api-keys";

export async function GET(_req: NextRequest) {
  const auth = await requireUserApi();
  if (!auth.ok) return auth.response;
  const keys = await listApiKeys(auth.user.id);
  return NextResponse.json({ keys });
}

export async function POST(req: NextRequest) {
  const auth = await requireUserApi();
  if (!auth.ok) return auth.response;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Ungültiges JSON." }, { status: 400 });
  }
  const name = typeof (body as { name?: unknown })?.name === "string"
    ? String((body as { name: string }).name).trim()
    : "";
  if (!name) {
    return NextResponse.json(
      { error: "Bitte einen Namen für den Key vergeben (z.B. 'Zapier')." },
      { status: 400 },
    );
  }
  if (name.length > 60) {
    return NextResponse.json({ error: "Name max. 60 Zeichen." }, { status: 400 });
  }

  const key = await createApiKey({ userId: auth.user.id, name });
  return NextResponse.json({ key }, { status: 201 });
}
