export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { requireUserApi } from "@/lib/auth-guard";
import {
  bulkApplyLetterAction,
  type LetterAction,
} from "@/lib/db/queries/letter-status";

/**
 * POST /api/runs/[id]/letter-status
 *
 * Bulk-Aktion der Versandzentrale für Leads einer Runde.
 *
 * Body:
 *   { leadIds: string[], action: "status", status: "open"|"in_progress"|"sent"|"discarded", sentAt?: ISO }
 *   { leadIds: string[], action: "returned", returned: boolean }
 *
 * Bei action=status + status=sent ist sentAt optional (Default: jetzt),
 * darf aber rückdatiert werden. Nur completed-Leads werden angefasst
 * (Race-Guard gegen laufende Regeneration) — Rest zählt als `skipped`.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await requireUserApi();
  if (!auth.ok) return auth.response;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Ungültiger Body." }, { status: 400 });
  }
  const b = body as Record<string, unknown>;

  const leadIds = Array.isArray(b.leadIds)
    ? b.leadIds.filter((v): v is string => typeof v === "string")
    : [];
  if (leadIds.length === 0 || leadIds.length > 5000) {
    return NextResponse.json(
      { error: "Bitte mindestens einen Lead auswählen." },
      { status: 400 },
    );
  }

  let action: LetterAction;
  if (b.action === "status") {
    const status = b.status;
    if (
      status !== "open" &&
      status !== "in_progress" &&
      status !== "sent" &&
      status !== "discarded"
    ) {
      return NextResponse.json({ error: "Ungültiger Status." }, { status: 400 });
    }
    let sentAt: Date | undefined;
    if (status === "sent" && typeof b.sentAt === "string") {
      const d = new Date(b.sentAt);
      if (Number.isNaN(d.getTime()) || d.getTime() > Date.now() + 86_400_000) {
        return NextResponse.json(
          { error: "Ungültiges Versanddatum." },
          { status: 400 },
        );
      }
      sentAt = d;
    }
    action = { action: "status", status, sentAt };
  } else if (b.action === "returned") {
    action = { action: "returned", returned: b.returned === true };
  } else {
    return NextResponse.json({ error: "Ungültige Aktion." }, { status: 400 });
  }

  try {
    const result = await bulkApplyLetterAction(
      params.id,
      auth.user.id,
      leadIds,
      action,
    );
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    if (err instanceof Error && err.message === "Not found") {
      return NextResponse.json({ error: "Nicht gefunden." }, { status: 404 });
    }
    // eslint-disable-next-line no-console
    console.error("[runs:letter-status] failed:", err);
    return NextResponse.json(
      { error: "Aktion fehlgeschlagen." },
      { status: 500 },
    );
  }
}
