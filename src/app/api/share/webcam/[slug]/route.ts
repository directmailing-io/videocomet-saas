/**
 * Auth-Endpoint: einen eigenen Share-Link sperren (DELETE → revoked_at).
 *
 * Wir löschen den Eintrag bewusst NICHT: so bleibt sichtbar, dass es den
 * Link mal gab, und ein bereits verwendetes Media-Item bleibt zuordenbar.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { requireUserApi } from "@/lib/auth-guard";
import { revokeShareLink } from "@/lib/db/queries/webcam-share";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { slug: string } },
) {
  const auth = await requireUserApi();
  if (!auth.ok) return auth.response;

  const ok = await revokeShareLink(params.slug, auth.user.id);
  if (!ok) {
    return NextResponse.json(
      { error: "Link nicht gefunden oder bereits gesperrt." },
      { status: 404 },
    );
  }
  return NextResponse.json({ ok: true });
}
