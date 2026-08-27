export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUserApi } from "@/lib/auth-guard";
import { getCampaign } from "@/lib/db/queries/campaigns";
import { getRun } from "@/lib/db/queries/runs";
import { getMailboxConnection } from "@/lib/db/queries/mailboxes";
import { computeBlastPreview } from "@/lib/db/queries/email-blasts";
import { effectiveDailyLimit } from "@/lib/mailbox/presets";

/**
 * Live-Zähler für den Blast-Wizard.
 *  - GET  ?runId=&mailboxIds=a,b,c — Standard.
 *  - POST {runId?, mailboxIds?, leadIds?} — mit expliziter Lead-Auswahl
 *    (Versandzentrale); die IDs passen nicht in eine URL.
 * Mit Postfächern zusätzlich die geschätzte Versanddauer (Rotation).
 */
async function buildPreview(input: {
  userId: string;
  campaignId: string;
  runId: string | null;
  mailboxIds: string[];
  leadIds: string[] | null;
}) {
  const preview = await computeBlastPreview({
    userId: input.userId,
    campaignId: input.campaignId,
    runId: input.runId,
    leadIds: input.leadIds,
  });

  let schedule: {
    mailsPerDay: number;
    estimatedSendDays: number;
    mailboxCount: number;
    sendWindow: unknown;
    timezone: string;
  } | null = null;
  if (input.mailboxIds.length > 0) {
    const ids = Array.from(new Set(input.mailboxIds));
    let mailsPerDay = 0;
    let first = null;
    for (const id of ids) {
      const mailbox = await getMailboxConnection(id, input.userId);
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

  return { ...preview, schedule };
}

async function resolveCampaignAndRun(
  campaignId: string,
  userId: string,
  runId: string | null,
): Promise<{ ok: true; campaignId: string } | { ok: false; response: NextResponse }> {
  let campaign;
  try {
    campaign = await getCampaign(campaignId, userId);
  } catch {
    return {
      ok: false,
      response: NextResponse.json({ error: "Nicht gefunden." }, { status: 404 }),
    };
  }
  if (runId) {
    try {
      const run = await getRun(runId, userId);
      if (run.campaignId !== campaign.id) {
        return {
          ok: false,
          response: NextResponse.json(
            { error: "Runde gehört nicht zu dieser Kampagne." },
            { status: 400 },
          ),
        };
      }
    } catch {
      return {
        ok: false,
        response: NextResponse.json(
          { error: "Runde nicht gefunden." },
          { status: 404 },
        ),
      };
    }
  }
  return { ok: true, campaignId: campaign.id };
}

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await requireUserApi();
  if (!auth.ok) return auth.response;

  const runId = req.nextUrl.searchParams.get("runId");
  const resolved = await resolveCampaignAndRun(params.id, auth.user.id, runId);
  if (!resolved.ok) return resolved.response;

  const mailboxIdsParam =
    req.nextUrl.searchParams.get("mailboxIds") ??
    req.nextUrl.searchParams.get("mailboxId");
  const mailboxIds = mailboxIdsParam
    ? mailboxIdsParam.split(",").map((s) => s.trim()).filter(Boolean)
    : [];

  const result = await buildPreview({
    userId: auth.user.id,
    campaignId: resolved.campaignId,
    runId: runId ?? null,
    mailboxIds,
    leadIds: null,
  });
  return NextResponse.json(result);
}

const PostBody = z.object({
  runId: z.string().uuid().nullish(),
  mailboxIds: z.array(z.string().uuid()).max(20).optional(),
  leadIds: z.array(z.string().uuid()).min(1).max(5000).nullish(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await requireUserApi();
  if (!auth.ok) return auth.response;

  const raw = await req.json().catch(() => null);
  const parsed = PostBody.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "Ungueltiger Body" }, { status: 400 });
  }

  const runId = parsed.data.runId ?? null;
  const resolved = await resolveCampaignAndRun(params.id, auth.user.id, runId);
  if (!resolved.ok) return resolved.response;

  const result = await buildPreview({
    userId: auth.user.id,
    campaignId: resolved.campaignId,
    runId,
    mailboxIds: parsed.data.mailboxIds ?? [],
    leadIds: parsed.data.leadIds ?? null,
  });
  return NextResponse.json(result);
}
