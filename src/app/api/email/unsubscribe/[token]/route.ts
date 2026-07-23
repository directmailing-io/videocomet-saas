export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { performUnsubscribe } from "@/lib/db/queries/email-blasts";

/**
 * POST /api/email/unsubscribe/[token] — programmatische Abmeldung
 * (wird vom Bestätigungs-Button auf /abmelden/[token] genutzt).
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: { token: string } },
) {
  const result = await performUnsubscribe(params.token);
  if (!result.ok) {
    return NextResponse.json({ error: "Ungültiger Link." }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
