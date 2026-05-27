import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUserApi } from "@/lib/auth-guard";
import {
  deleteCampaign,
  getCampaign,
  updateCampaign,
} from "@/lib/db/queries/campaigns";

const patchSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  mode: z.enum(["webcam-only", "with-presentation"]).optional(),
  webcamMediaId: z.string().uuid().nullable().optional(),
  segments: z.array(z.unknown()).optional(),
  pipPosition: z.enum(["bottom-left", "bottom-right"]).optional(),
  pipShape: z.enum(["square", "rounded", "circle"]).optional(),
  landingPageTemplateId: z.string().uuid().nullable().optional(),
  pdfEnabled: z.boolean().optional(),
  pdfGoogleDocsUrl: z.string().url().nullable().optional(),
  pdfQrEnabled: z.boolean().optional(),
  pdfThumbnailEnabled: z.boolean().optional(),
  pdfThumbnailFrameMs: z.number().int().nonnegative().nullable().optional(),
});

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireUserApi();
  if (!auth.ok) return auth.response;
  try {
    const campaign = await getCampaign(params.id, auth.user.id);
    return NextResponse.json({ campaign });
  } catch {
    return NextResponse.json({ error: "Nicht gefunden." }, { status: 404 });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireUserApi();
  if (!auth.ok) return auth.response;
  let body: z.infer<typeof patchSchema>;
  try {
    body = patchSchema.parse(await req.json());
  } catch (err) {
    return NextResponse.json(
      { error: "Ungueltige Eingabe.", details: err instanceof Error ? err.message : null },
      { status: 400 },
    );
  }
  try {
    const campaign = await updateCampaign(params.id, auth.user.id, body);
    return NextResponse.json({ campaign });
  } catch {
    return NextResponse.json({ error: "Nicht gefunden." }, { status: 404 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireUserApi();
  if (!auth.ok) return auth.response;
  try {
    await deleteCampaign(params.id, auth.user.id);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Nicht gefunden." }, { status: 404 });
  }
}
