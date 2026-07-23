export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { and, eq, isNotNull, isNull, or } from "drizzle-orm";
import { requireUserApi } from "@/lib/auth-guard";
import { db } from "@/lib/db";
import { campaigns, leads, type CampaignEmailGifConfig } from "@/lib/db/schema";
import { getCampaign } from "@/lib/db/queries/campaigns";
import { computeEmailGifHash } from "@/lib/email/gif-hash";
import { emailGifJobId, emailGifQueue } from "@/worker/email-gif-queue";

/**
 * Leads dieser Kampagne, die ein Outreach-GIF bekommen: nicht aussortiert,
 * mit E-Mail-Adresse und mit Video-Quelle.
 */
async function selectGifLeads(campaignId: string) {
  return db
    .select({
      id: leads.id,
      videoContentHash: leads.videoContentHash,
      emailGifUrl: leads.emailGifUrl,
      emailGifHash: leads.emailGifHash,
    })
    .from(leads)
    .where(
      and(
        eq(leads.campaignId, campaignId),
        isNull(leads.removedAt),
        isNotNull(leads.normalizedEmail),
        or(isNotNull(leads.videoMp4Url), isNotNull(leads.videoUrl)),
      ),
    );
}

function countGifStatus(
  rows: Awaited<ReturnType<typeof selectGifLeads>>,
  config: CampaignEmailGifConfig,
) {
  let done = 0;
  for (const l of rows) {
    const expected = computeEmailGifHash(l.videoContentHash, config);
    if (l.emailGifHash === expected && l.emailGifUrl) done++;
  }
  return { total: rows.length, done, pending: rows.length - done };
}

/**
 * GET /api/campaigns/[id]/email-gif — Config + Encode-Status
 * (Zähler fertig/ausstehend via emailGifHash-Vergleich).
 */
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

  const rows = await selectGifLeads(campaign.id);
  const config = campaign.emailGifConfig ?? null;
  if (!config) {
    return NextResponse.json({
      config: null,
      total: rows.length,
      done: 0,
      pending: rows.length,
    });
  }
  return NextResponse.json({ config, ...countGifStatus(rows, config) });
}

const PostBody = z.object({
  startSec: z.number().min(0).max(3_600),
  durationSec: z
    .number()
    .min(2, "Dauer muss zwischen 2 und 4 Sekunden liegen.")
    .max(4, "Dauer muss zwischen 2 und 4 Sekunden liegen."),
});

/**
 * POST /api/campaigns/[id]/email-gif — Config speichern + Encode-Jobs
 * enqueuen. Leads mit unverändertem Hash überspringt der Worker selbst;
 * hier filtern wir sie zusätzlich vor, um die Queue klein zu halten.
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

  const config: CampaignEmailGifConfig = {
    startSec: Math.round(parsed.data.startSec * 10) / 10,
    durationSec: Math.round(parsed.data.durationSec),
  };

  await db
    .update(campaigns)
    .set({ emailGifConfig: config, updatedAt: new Date() })
    .where(eq(campaigns.id, campaign.id));

  const rows = await selectGifLeads(campaign.id);
  const stale = rows.filter((l) => {
    const expected = computeEmailGifHash(l.videoContentHash, config);
    return l.emailGifHash !== expected || !l.emailGifUrl;
  });

  if (stale.length > 0) {
    const queue = emailGifQueue();
    // Stale Job-IDs entfernen — BullMQ `addBulk` dedupt sonst still gegen
    // completed/failed-ZSETs (gleiches Muster wie worker/index.ts).
    await Promise.all(
      stale.map((l) =>
        queue.remove(emailGifJobId(l.id)).catch(() => undefined),
      ),
    );
    await queue.addBulk(
      stale.map((l) => ({
        name: "email-gif",
        data: {
          leadId: l.id,
          campaignId: campaign.id,
          userId: auth.user.id,
        },
        opts: { jobId: emailGifJobId(l.id) },
      })),
    );
  }

  return NextResponse.json({
    ok: true,
    config,
    enqueued: stale.length,
    ...countGifStatus(rows, config),
  });
}

/**
 * DELETE /api/campaigns/[id]/email-gif — Config entfernen („ohne GIF
 * fortfahren" im Blast-Wizard). Bereits encodete GIFs bleiben liegen,
 * werden aber ohne gifConfig im Snapshot nicht mehr gerendert.
 */
export async function DELETE(
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

  await db
    .update(campaigns)
    .set({ emailGifConfig: null, updatedAt: new Date() })
    .where(eq(campaigns.id, campaign.id));

  return NextResponse.json({ ok: true, config: null });
}
