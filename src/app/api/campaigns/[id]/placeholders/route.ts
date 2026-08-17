/**
 * GET /api/campaigns/:id/placeholders?envelopeTemplateId=uuid
 *
 * Liefert alle Platzhalter, die in den Assets der Kampagne (Slides, Text,
 * Google-Docs, PDF-Brief, Landingpage, Umschlag, Slug-Template) verwendet
 * werden — jeweils mit Quellen-Info (welches Asset, Label).
 *
 * Wird vom neuen Runden-Wizard v4 in Step 4 aufgerufen. Kein Run nötig.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { requireUserApi } from "@/lib/auth-guard";
import { collectCampaignPlaceholders } from "@/lib/placeholders/collector";

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await requireUserApi();
  if (!auth.ok) return auth.response;

  const envelopeTemplateId =
    req.nextUrl.searchParams.get("envelopeTemplateId") ?? null;

  try {
    const placeholders = await collectCampaignPlaceholders(
      params.id,
      auth.user.id,
      { envelopeTemplateId },
    );
    return NextResponse.json({ placeholders });
  } catch (err) {
    console.error("[campaigns/placeholders] failed:", err);
    return NextResponse.json(
      { error: "Die Platzhalter konnten wir gerade nicht laden. Bitte in einem Moment nochmal probieren." },
      { status: 500 },
    );
  }
}
