export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminApi } from "@/lib/auth-guard";
import { adminAdjust } from "@/lib/billing/credit-service";

/**
 * POST /api/admin/billing/adjust
 * Body: { userId: uuid, delta: int, reason: string }
 *
 * Admin-only. Manuelle Credit-Korrektur (Refund, Goodwill, Testing).
 * Alle Aktionen landen im Ledger mit adminUserId + Reason.
 */
const BODY = z.object({
  userId: z.string().uuid(),
  delta: z.number().int().refine((v) => v !== 0, "delta darf nicht 0 sein"),
  reason: z.string().trim().min(3, "Reason ist Pflicht (min 3 Zeichen)").max(500),
});

export async function POST(req: NextRequest) {
  const auth = await requireAdminApi();
  if (!auth.ok) return auth.response;

  const raw = await req.json().catch(() => null);
  const parsed = BODY.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Ungueltiger Body" },
      { status: 400 },
    );
  }

  try {
    const tx = await adminAdjust({
      userId: parsed.data.userId,
      adminUserId: auth.user.id,
      delta: parsed.data.delta,
      reason: parsed.data.reason,
    });
    return NextResponse.json({
      ok: true,
      transactionId: String(tx.id),
      balanceAfter: tx.balanceAfter,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "internal" },
      { status: 400 },
    );
  }
}
