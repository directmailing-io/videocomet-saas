export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { and, desc, eq, isNull } from "drizzle-orm";
import { requireUserApi } from "@/lib/auth-guard";
import { db } from "@/lib/db";
import { envelopeTemplates } from "@/lib/db/schema";
import { getDefaultFieldsForFormat } from "@/worker/lib/envelope-pdf";

/** GET /api/envelopes — Liste aller Umschlag-Vorlagen des Users. */
export async function GET() {
  const auth = await requireUserApi();
  if (!auth.ok) return auth.response;

  const rows = await db
    .select({
      id: envelopeTemplates.id,
      name: envelopeTemplates.name,
      format: envelopeTemplates.format,
      updatedAt: envelopeTemplates.updatedAt,
    })
    .from(envelopeTemplates)
    .where(
      and(
        eq(envelopeTemplates.userId, auth.user.id),
        isNull(envelopeTemplates.deletedAt),
      ),
    )
    .orderBy(desc(envelopeTemplates.updatedAt));

  return NextResponse.json({ templates: rows });
}

/** POST /api/envelopes — Neue Vorlage anlegen mit Default-Layout. */
const CreateBody = z.object({
  name: z.string().trim().min(1).max(120),
  format: z.enum(["DIN_LANG", "C4", "C5", "C6"]).default("DIN_LANG"),
});

export async function POST(req: NextRequest) {
  const auth = await requireUserApi();
  if (!auth.ok) return auth.response;

  const raw = await req.json().catch(() => null);
  const parsed = CreateBody.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Ungueltiger Body" },
      { status: 400 },
    );
  }

  const [row] = await db
    .insert(envelopeTemplates)
    .values({
      userId: auth.user.id,
      name: parsed.data.name,
      format: parsed.data.format,
      fields: getDefaultFieldsForFormat(parsed.data.format),
      sender: {},
    })
    .returning();

  return NextResponse.json({ template: row });
}
