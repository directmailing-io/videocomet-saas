export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth-guard";
import { listAllEmailBlastsForAdmin } from "@/lib/db/queries/email-blasts";

/** GET /api/admin/email-blasts — alle Blasts (alle User) für die Konsole. */
export async function GET() {
  const auth = await requireAdminApi();
  if (!auth.ok) return auth.response;

  const blasts = await listAllEmailBlastsForAdmin();
  return NextResponse.json({
    blasts: blasts.map((b) => ({
      id: b.id,
      userEmail: b.userEmail,
      campaignName: b.campaignName,
      status: b.status,
      sentCount: b.sentCount,
      totalCount: b.totalCount,
      bouncedCount: b.bouncedCount,
      repliedCount: b.repliedCount,
      startedAt: b.startedAt ? b.startedAt.toISOString() : null,
      createdAt: b.createdAt.toISOString(),
    })),
  });
}
