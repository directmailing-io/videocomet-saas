export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUserApi } from "@/lib/auth-guard";
import { db } from "@/lib/db";
import { emailBlasts } from "@/lib/db/schema";
import { getCampaign } from "@/lib/db/queries/campaigns";
import { getRun } from "@/lib/db/queries/runs";
import { getMailboxConnection } from "@/lib/db/queries/mailboxes";
import {
  getEmailTemplate,
  isEmailTemplateComplete,
} from "@/lib/db/queries/email-templates";
import {
  buildContentSnapshot,
  listCampaignEmailBlasts,
  serializeEmailBlast,
} from "@/lib/db/queries/email-blasts";

/** GET /api/campaigns/[id]/email-blasts — Liste der Blasts der Kampagne. */
export async function GET(
  _req: NextRequest,
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

  const blasts = await listCampaignEmailBlasts(campaign.id, auth.user.id);
  return NextResponse.json({ blasts: blasts.map(serializeEmailBlast) });
}

const PostBody = z.object({
  templateId: z.string().uuid(),
  mailboxConnectionId: z.string().uuid(),
  runId: z.string().uuid().nullish(),
});

/**
 * POST /api/campaigns/[id]/email-blasts — Draft anlegen. Snapshot wird
 * hier initial gefüllt (Spalte NOT NULL) und beim Start neu eingefroren.
 */
export async function POST(
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

  const raw = await req.json().catch(() => null);
  const parsed = PostBody.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Ungueltiger Body" },
      { status: 400 },
    );
  }

  if (parsed.data.runId) {
    try {
      const run = await getRun(parsed.data.runId, auth.user.id);
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

  const mailbox = await getMailboxConnection(
    parsed.data.mailboxConnectionId,
    auth.user.id,
  );
  if (!mailbox) {
    return NextResponse.json({ error: "Postfach nicht gefunden." }, { status: 404 });
  }
  if (mailbox.status !== "connected") {
    return NextResponse.json(
      { error: "Das Postfach ist nicht verbunden. Bitte erst neu verbinden." },
      { status: 400 },
    );
  }

  const template = await getEmailTemplate(parsed.data.templateId, auth.user.id);
  if (!template) {
    return NextResponse.json({ error: "Vorlage nicht gefunden." }, { status: 404 });
  }
  if (!isEmailTemplateComplete(template)) {
    return NextResponse.json(
      { error: "Die Vorlage ist unvollständig (Betreff und Text sind Pflicht; Impressum bei kompletter Signatur)." },
      { status: 400 },
    );
  }

  const [blast] = await db
    .insert(emailBlasts)
    .values({
      userId: auth.user.id,
      campaignId: campaign.id,
      runId: parsed.data.runId ?? null,
      mailboxConnectionId: mailbox.id,
      templateId: template.id,
      status: "draft",
      contentSnapshot: buildContentSnapshot(template, campaign.emailGifConfig ?? null),
    })
    .returning();

  return NextResponse.json({ blast: serializeEmailBlast(blast!) }, { status: 201 });
}
