/**
 * DELETE /api/api-keys/:id — Key revoken (soft-delete).
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { requireUserApi } from "@/lib/auth-guard";
import { revokeApiKey } from "@/lib/db/queries/api-keys";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await requireUserApi();
  if (!auth.ok) return auth.response;
  const ok = await revokeApiKey({ userId: auth.user.id, id: params.id });
  if (!ok) return NextResponse.json({ error: "Nicht gefunden." }, { status: 404 });
  return NextResponse.json({ ok: true });
}
