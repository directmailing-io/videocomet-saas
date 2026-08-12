export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUserApi } from "@/lib/auth-guard";
import { getCampaign } from "@/lib/db/queries/campaigns";
import { createRun } from "@/lib/db/queries/runs";

const createSchema = z.object({
  campaignId: z.string().uuid(),
  name: z.string().min(1).max(120),
});

/**
 * POST /api/runs — creates a draft Run for the given campaign.
 * The wizard then drives the upload + mapping + start flow.
 */
export async function POST(req: NextRequest) {
  const auth = await requireUserApi();
  if (!auth.ok) return auth.response;

  let body: z.infer<typeof createSchema>;
  try {
    body = createSchema.parse(await req.json());
  } catch (err) {
    return NextResponse.json(
      {
        error: "Ungültige Eingabe.",
        details: err instanceof Error ? err.message : null,
      },
      { status: 400 },
    );
  }

  // Tenant-Guard: verify the campaign belongs to the user.
  let campaign;
  try {
    campaign = await getCampaign(body.campaignId, auth.user.id);
  } catch {
    return NextResponse.json(
      { error: "Kampagne nicht gefunden." },
      { status: 404 },
    );
  }

  // Entwürfe können keine Runden starten — erst fertigstellen.
  if (campaign.status === "draft") {
    return NextResponse.json(
      {
        error:
          "Diese Kampagne ist noch ein Entwurf. Bitte stelle sie zuerst im Wizard fertig.",
      },
      { status: 422 },
    );
  }

  const run = await createRun(auth.user.id, {
    campaignId: body.campaignId,
    name: body.name,
    status: "draft",
  });

  return NextResponse.json(
    {
      run,
      redirectUrl: `/kampagnen/${body.campaignId}/runs/neu?runId=${run.id}`,
    },
    { status: 201 },
  );
}
