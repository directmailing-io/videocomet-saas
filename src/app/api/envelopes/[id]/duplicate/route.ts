export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { and, eq, isNull } from "drizzle-orm";
import { requireUserApi } from "@/lib/auth-guard";
import { db } from "@/lib/db";
import { envelopeTemplates } from "@/lib/db/schema";

/** POST /api/envelopes/[id]/duplicate — Kopie einer Vorlage anlegen. */
export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await requireUserApi();
  if (!auth.ok) return auth.response;

  const [source] = await db
    .select()
    .from(envelopeTemplates)
    .where(
      and(
        eq(envelopeTemplates.id, params.id),
        eq(envelopeTemplates.userId, auth.user.id),
        isNull(envelopeTemplates.deletedAt),
      ),
    )
    .limit(1);

  if (!source) {
    return NextResponse.json({ error: "Nicht gefunden." }, { status: 404 });
  }

  const copyName = `${source.name} (Kopie)`.slice(0, 120);
  const [row] = await db
    .insert(envelopeTemplates)
    .values({
      userId: auth.user.id,
      name: copyName,
      format: source.format,
      fields: source.fields,
      sender: source.sender,
    })
    .returning();

  return NextResponse.json({ template: row });
}
