export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { requireUserApi } from "@/lib/auth-guard";
import {
  getEmailBlastForUser,
  listBlastMessages,
} from "@/lib/db/queries/email-blasts";

/** GET /api/email-blasts/[id]/messages?offset=&limit= — paginierte Message-Liste. */
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await requireUserApi();
  if (!auth.ok) return auth.response;

  const blast = await getEmailBlastForUser(params.id, auth.user.id);
  if (!blast) {
    return NextResponse.json({ error: "Nicht gefunden." }, { status: 404 });
  }

  const offset = Math.max(0, Number(req.nextUrl.searchParams.get("offset")) || 0);
  const limitRaw = Number(req.nextUrl.searchParams.get("limit")) || 50;
  const limit = Math.min(Math.max(1, limitRaw), 200);

  const { rows, total } = await listBlastMessages(blast.id, { offset, limit });
  return NextResponse.json({
    total,
    offset,
    limit,
    messages: rows.map((r) => ({
      id: r.id,
      leadId: r.leadId,
      toEmail: r.toEmail,
      status: r.status,
      sentAt: r.sentAt ? r.sentAt.toISOString() : null,
      repliedAt: r.repliedAt ? r.repliedAt.toISOString() : null,
      unsubscribedAt: r.unsubscribedAt ? r.unsubscribedAt.toISOString() : null,
      skipReason: r.skipReason,
      error: r.error,
      clicked: r.clicked,
      leadData: r.leadData,
      mailboxEmail: r.mailboxEmail,
      earliestSendAt: r.earliestSendAt ? r.earliestSendAt.toISOString() : null,
    })),
  });
}
