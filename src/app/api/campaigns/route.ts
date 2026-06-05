export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUserApi } from "@/lib/auth-guard";
import {
  createCampaign,
  listUserCampaigns,
} from "@/lib/db/queries/campaigns";

const createSchema = z.object({
  name: z.string().min(1).max(120),
  mode: z.enum(["webcam-only", "with-presentation"]).default("webcam-only"),
  webcamMediaId: z.string().uuid().nullable().optional(),
  segments: z.array(z.unknown()).optional(),
  pipPosition: z.enum(["bottom-left", "bottom-right"]).optional(),
  pipShape: z.enum(["square", "rounded", "circle"]).optional(),
  landingPageTemplateId: z.string().uuid().nullable().optional(),
  customLpTemplateId: z.string().uuid().nullable().optional(),
  domainId: z.string().uuid().nullable().optional(),
  slugTemplate: z.string().min(1).max(120).nullable().optional(),
  /**
   * Optionaler Tenant-Suffix für Lead-Slugs (Migration 0014). Format identisch
   * zur DB-CHECK-Constraint: lowercase alphanumerisch + Bindestrich, 1-32 Zeichen.
   * `null` → SQL NULL setzen, `undefined` → Feld nicht ändern.
   */
  slugSuffix: z
    .string()
    .regex(/^[a-z0-9-]{1,32}$/, "Nur a-z, 0-9 und Bindestrich, max. 32 Zeichen.")
    .nullable()
    .optional(),
  pdfEnabled: z.boolean().optional(),
  pdfGoogleDocsUrl: z.string().url().nullable().optional(),
  pdfQrEnabled: z.boolean().optional(),
  pdfThumbnailEnabled: z.boolean().optional(),
  pdfThumbnailFrameMs: z.number().int().nonnegative().nullable().optional(),
});

export async function GET() {
  const auth = await requireUserApi();
  if (!auth.ok) return auth.response;
  const campaigns = await listUserCampaigns(auth.user.id);
  return NextResponse.json({ campaigns });
}

export async function POST(req: NextRequest) {
  const auth = await requireUserApi();
  if (!auth.ok) return auth.response;
  let body: z.infer<typeof createSchema>;
  try {
    body = createSchema.parse(await req.json());
  } catch (err) {
    return NextResponse.json(
      { error: "Ungültige Eingabe.", details: err instanceof Error ? err.message : null },
      { status: 400 },
    );
  }
  const campaign = await createCampaign(auth.user.id, body);
  return NextResponse.json({ campaign }, { status: 201 });
}
