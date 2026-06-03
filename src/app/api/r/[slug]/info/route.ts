/**
 * Public-Endpoint (no auth): liefert Status + Anzeigeinfo zu einem Share-Link.
 *
 * Bewusst keine user_id im Output — der Empfänger sieht nur Owner-Name,
 * optionalen Titel, max-Duration und den Status.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { getShareLinkBySlugPublic } from "@/lib/db/queries/webcam-share";

export async function GET(
  _req: NextRequest,
  { params }: { params: { slug: string } },
) {
  const info = await getShareLinkBySlugPublic(params.slug);
  if (!info) {
    return NextResponse.json({ error: "Link nicht gefunden." }, { status: 404 });
  }
  return NextResponse.json(info, {
    headers: { "Cache-Control": "private, no-store" },
  });
}
