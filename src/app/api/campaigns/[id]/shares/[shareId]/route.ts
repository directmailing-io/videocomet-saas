/**
 * Owner-API: Sperrt einen Public-Share-Link (`revoked_at = now()`).
 *
 * Idempotent: gibt 200 zurück, auch wenn der Share bereits revoked ist.
 * Tenant-Guard läuft via `revokeShare(shareId, userId)` — ein User kann
 * niemals einen Fremd-Share revoken.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { requireUserApi } from "@/lib/auth-guard";
import { revokeShare } from "@/lib/db/queries/campaign-shares";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string; shareId: string } },
) {
  const auth = await requireUserApi();
  if (!auth.ok) return auth.response;

  const revoked = await revokeShare(params.shareId, auth.user.id);
  // Idempotent: revoked=true (eben gesperrt) und revoked=false (war schon
  // gesperrt oder gehört nicht dem User) liefern beide 200. Das vermeidet,
  // dass der UI-Layer zwischen "war schon weg" und "ist gerade weg"
  // unterscheiden muss.
  return NextResponse.json({ ok: true, revoked });
}
