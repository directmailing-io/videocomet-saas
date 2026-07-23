export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { requireUserApi } from "@/lib/auth-guard";
import { getMailboxConnection, serializeMailbox } from "@/lib/db/queries/mailboxes";
import {
  countBlastMessages,
  getBlastEngagement,
  getEmailBlastForUser,
  serializeEmailBlast,
} from "@/lib/db/queries/email-blasts";
import { effectiveDailyLimit } from "@/lib/mailbox/presets";

/** GET /api/email-blasts/[id] — Blast + Live-Zähler + Versand-Prognose. */
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await requireUserApi();
  if (!auth.ok) return auth.response;

  const blast = await getEmailBlastForUser(params.id, auth.user.id);
  if (!blast) {
    return NextResponse.json({ error: "Nicht gefunden." }, { status: 404 });
  }

  const [counts, engagement, mailbox] = await Promise.all([
    countBlastMessages(blast.id),
    getBlastEngagement(blast.id),
    getMailboxConnection(blast.mailboxConnectionId, auth.user.id),
  ]);

  const mailsPerDay = mailbox
    ? effectiveDailyLimit(mailbox.warmupStage, mailbox.dailyCap)
    : 0;
  const estimatedSendDays =
    mailsPerDay > 0 ? Math.ceil(counts.scheduled / mailsPerDay) : null;

  return NextResponse.json({
    blast: serializeEmailBlast(blast),
    counts,
    engagement,
    mailbox: mailbox ? serializeMailbox(mailbox) : null,
    estimatedSendDays,
  });
}
