export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUserApi } from "@/lib/auth-guard";
import { markLeadsRemoved } from "@/lib/db/queries/leads";
import {
  getRunForPreflight,
  updateRunCounts,
} from "@/lib/db/queries/runs";

const BodySchema = z.object({
  leadIds: z.array(z.string().uuid()).min(1),
});

/**
 * POST /api/runs/[id]/preflight/reject
 *
 * Soft-Delete einer Liste von Leads (User-Trigger im Grid: "Entfernen").
 * Idempotent — bereits entfernte Leads werden silent geskipt. Die
 * Aggregat-Counter auf dem Run werden nach jedem Aufruf neu gesetzt.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await requireUserApi();
  if (!auth.ok) return auth.response;

  let bodyRaw: unknown;
  try {
    bodyRaw = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Body muss JSON sein.", details: null },
      { status: 400 },
    );
  }
  const parsed = BodySchema.safeParse(bodyRaw);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Ungültige Anfrage.",
        details: parsed.error.message,
      },
      { status: 400 },
    );
  }

  let run;
  try {
    run = await getRunForPreflight(params.id, auth.user.id);
  } catch {
    return NextResponse.json(
      { error: "Run nicht gefunden.", details: null },
      { status: 404 },
    );
  }

  const rejectedCount = await markLeadsRemoved(
    parsed.data.leadIds,
    params.id,
    auth.user.id,
    "user_rejected",
  );

  if (rejectedCount > 0) {
    await updateRunCounts(params.id, auth.user.id, {
      rejectedLeadCount: (run.rejectedLeadCount ?? 0) + rejectedCount,
    });
  }

  return NextResponse.json({ ok: true, rejectedCount });
}
