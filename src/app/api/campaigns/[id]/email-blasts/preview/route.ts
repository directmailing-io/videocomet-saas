export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { requireUserApi } from "@/lib/auth-guard";
import { getCampaign } from "@/lib/db/queries/campaigns";
import { getRun } from "@/lib/db/queries/runs";
import { getMailboxConnection } from "@/lib/db/queries/mailboxes";
import { computeBlastPreview } from "@/lib/db/queries/email-blasts";
import { effectiveDailyLimit } from "@/lib/mailbox/presets";

/**
 * GET /api/campaigns/[id]/email-blasts/preview?runId=&mailboxId=
 *
 * Live-Zähler für den Blast-Wizard. Mit `mailboxId` zusätzlich
 * Credits + geschätzte Versanddauer (Werktage aus sendWindow.days).
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await requireUserApi();
  if (!auth.ok) return auth.response;

  let campaign;
  try {
    campaign = await getCampaign(params.id, auth.user.id);
  } catch {
    return NextResponse.json({ error: "Nicht gefunden." }, { status: 404 });
  }

  const runId = req.nextUrl.searchParams.get("runId");
  if (runId) {
    try {
      const run = await getRun(runId, auth.user.id);
      if (run.campaignId !== campaign.id) {
        return NextResponse.json(
          { error: "Runde gehört nicht zu dieser Kampagne." },
          { status: 400 },
        );
      }
    } catch {
      return NextResponse.json({ error: "Runde nicht gefunden." }, { status: 404 });
    }
  }

  const preview = await computeBlastPreview({
    userId: auth.user.id,
    campaignId: campaign.id,
    runId: runId ?? null,
  });

  const credits = Math.ceil(preview.sendable / 10);

  let schedule: {
    mailsPerDay: number;
    estimatedSendDays: number;
    sendWindow: unknown;
    timezone: string;
  } | null = null;
  const mailboxId = req.nextUrl.searchParams.get("mailboxId");
  if (mailboxId) {
    const mailbox = await getMailboxConnection(mailboxId, auth.user.id);
    if (mailbox) {
      const mailsPerDay = effectiveDailyLimit(mailbox.warmupStage, mailbox.dailyCap);
      schedule = {
        mailsPerDay,
        estimatedSendDays:
          preview.sendable > 0 ? Math.ceil(preview.sendable / mailsPerDay) : 0,
        sendWindow: mailbox.sendWindow,
        timezone: mailbox.timezone,
      };
    }
  }

  return NextResponse.json({ ...preview, credits, schedule });
}
