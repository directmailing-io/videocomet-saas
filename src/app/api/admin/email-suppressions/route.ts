export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth-guard";
import { searchSuppressionsForAdmin } from "@/lib/db/queries/email-blasts";

/** GET /api/admin/email-suppressions?email= — Suche über alle User. */
export async function GET(req: NextRequest) {
  const auth = await requireAdminApi();
  if (!auth.ok) return auth.response;

  const email = req.nextUrl.searchParams.get("email") ?? "";
  if (!email.trim()) {
    return NextResponse.json({ suppressions: [] });
  }

  const rows = await searchSuppressionsForAdmin(email);
  return NextResponse.json({
    suppressions: rows.map((r) => ({
      id: r.id,
      email: r.email,
      reason: r.reason,
      userEmail: r.userEmail,
      createdAt: r.createdAt.toISOString(),
    })),
  });
}
