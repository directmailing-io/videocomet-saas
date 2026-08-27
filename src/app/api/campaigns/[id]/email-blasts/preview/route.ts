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
 * GET /api/campaigns/[id]/email-blasts/preview?runId=&mailboxIds=a,b,c
 *
 * Live-Zähler für den Blast-Wizard. Mit `mailboxIds` zusätzlich die
 * geschätzte Versanddauer über alle gewählten Postfächer (Rotation).
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

  let schedule: {
    mailsPerDay: number;
    estimatedSendDays: number;
    mailboxCount: number;
    sendWindow: unknown;
    timezone: string;
  } | null = null;
  const mailboxIdsParam =
    req.nextUrl.searchParams.get("mailboxIds") ??
    req.nextUrl.searchParams.get("mailboxId");
  if (mailboxIdsParam) {
    const ids = Array.from(
      new Set(mailboxIdsParam.split(",").map((s) => s.trim()).filter(Boolean)),
    );
    let mailsPerDay = 0;
    let first = null;
    for (const id of ids) {
      const mailbox = await getMailboxConnection(id, auth.user.id);
      if (!mailbox) continue;
      first = first ?? mailbox;
      mailsPerDay += effectiveDailyLimit(mailbox.warmupStage, mailbox.dailyCap);
    }
    if (first && mailsPerDay > 0) {
      schedule = {
        mailsPerDay,
        estimatedSendDays:
          preview.sendable > 0 ? Math.ceil(preview.sendable / mailsPerDay) : 0,
        mailboxCount: ids.length,
        sendWindow: first.sendWindow,
        timezone: first.timezone,
      };
    }
  }

  return NextResponse.json({ ...preview, schedule });
}
