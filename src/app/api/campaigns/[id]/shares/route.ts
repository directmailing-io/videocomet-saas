/**
 * Owner-API: Liste + Anlegen von Public-Share-Links für eine Kampagne.
 *
 *   GET   → `{ shares: [...] }` aller aktiven (nicht revoked) Shares.
 *   POST  → erstellt einen neuen Share. Body `{ password, label? }`.
 *           Mindestpasswortlänge 8 Zeichen.
 *
 * Tenant-Guard: `requireUserApi` + zusätzlich `getCampaign(id, userId)` als
 * Ownership-Check (wirft `Not found`, wenn die Kampagne nicht dem
 * angemeldeten User gehört).
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUserApi } from "@/lib/auth-guard";
import { getCampaign } from "@/lib/db/queries/campaigns";
import {
  createShare,
  listSharesForCampaign,
} from "@/lib/db/queries/campaign-shares";

const createSchema = z.object({
  password: z
    .string()
    .min(8, "Passwort muss mindestens 8 Zeichen haben.")
    .max(256),
  label: z.string().min(1).max(120).optional(),
});

function appUrl(): string {
  return (
    process.env.NEXT_PUBLIC_APP_URL ??
    process.env.APP_URL ??
    "https://app.videocomet.de"
  );
}

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await requireUserApi();
  if (!auth.ok) return auth.response;

  // Ownership-Check der Kampagne. Wirft "Not found" → 404.
  try {
    await getCampaign(params.id, auth.user.id);
  } catch {
    return NextResponse.json({ error: "Nicht gefunden." }, { status: 404 });
  }

  const shares = await listSharesForCampaign(params.id, auth.user.id);
  return NextResponse.json({ shares });
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await requireUserApi();
  if (!auth.ok) return auth.response;

  let body: z.infer<typeof createSchema>;
  try {
    body = createSchema.parse(await req.json());
  } catch (err) {
    return NextResponse.json(
      {
        error: "Ungültige Eingabe.",
        details: err instanceof Error ? err.message : null,
      },
      { status: 400 },
    );
  }

  try {
    const result = await createShare({
      campaignId: params.id,
      userId: auth.user.id,
      password: body.password,
      label: body.label ?? null,
    });
    return NextResponse.json(
      {
        id: result.id,
        token: result.token,
        url: `${appUrl()}/share/${result.token}`,
      },
      { status: 201 },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "";
    if (msg === "Not found") {
      return NextResponse.json({ error: "Nicht gefunden." }, { status: 404 });
    }
    return NextResponse.json(
      { error: "Share konnte nicht angelegt werden." },
      { status: 500 },
    );
  }
}
