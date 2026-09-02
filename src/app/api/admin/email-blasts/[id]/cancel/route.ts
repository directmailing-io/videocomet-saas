export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth-guard";
import {
  cancelEmailBlast,
  getEmailBlastAdmin,
} from "@/lib/db/queries/email-blasts";
import { logAdminAction } from "@/lib/admin-audit";

/**
 * POST /api/admin/email-blasts/[id]/cancel — Kill-Switch: bricht den
 * Blast eines beliebigen Users ab.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await requireAdminApi();
  if (!auth.ok) return auth.response;

  const blast = await getEmailBlastAdmin(params.id);
  if (!blast) {
    return NextResponse.json({ error: "Nicht gefunden." }, { status: 404 });
  }

  const result = await cancelEmailBlast(blast.id, blast.userId);
  if (!result.ok) {
    return NextResponse.json(
      { error: "Nur laufende oder pausierte Blasts können abgebrochen werden." },
      { status: 409 },
    );
  }
  await logAdminAction({
    admin: { id: auth.user.id, email: auth.user.email },
    action: "email_blast.cancel",
    targetType: "email_blast",
    targetId: blast.id,
    details: { userId: blast.userId, cancelledMessages: result.cancelledMessages },
    req,
  });
  return NextResponse.json({
    ok: true,
    cancelledMessages: result.cancelledMessages,
  });
}
