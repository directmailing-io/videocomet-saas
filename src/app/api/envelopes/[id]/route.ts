export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { and, eq, isNull } from "drizzle-orm";
import { requireUserApi } from "@/lib/auth-guard";
import { db } from "@/lib/db";
import { envelopeTemplates, type EnvelopeField } from "@/lib/db/schema";

const FIELD = z.object({
  id: z.string(),
  label: z.string(),
  content: z.string(),
  x: z.number().min(0).max(100),
  y: z.number().min(0).max(100),
  width: z.number().min(1).max(100),
  fontSize: z.number().min(4).max(96),
  lineHeight: z.number().min(0.8).max(4.0),
  font: z.enum(["LiebeHeideFineliner", "BiroScript", "Helvetica"]),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
});

const UpdateBody = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  format: z.enum(["DIN_LANG", "C4", "C5", "C6"]).optional(),
  fields: z.array(FIELD).optional(),
  sender: z
    .object({
      name: z.string().optional(),
      street: z.string().optional(),
      zip: z.string().optional(),
      city: z.string().optional(),
    })
    .optional(),
});

/** GET /api/envelopes/[id] — Detail eines Templates. */
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await requireUserApi();
  if (!auth.ok) return auth.response;

  const [row] = await db
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

  if (!row) {
    return NextResponse.json({ error: "Nicht gefunden." }, { status: 404 });
  }
  return NextResponse.json({ template: row });
}

/** PUT /api/envelopes/[id] — Template aktualisieren. */
export async function PUT(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await requireUserApi();
  if (!auth.ok) return auth.response;

  const raw = await req.json().catch(() => null);
  const parsed = UpdateBody.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Ungueltiger Body" },
      { status: 400 },
    );
  }

  const update: Record<string, unknown> = { updatedAt: new Date() };
  if (parsed.data.name !== undefined) update.name = parsed.data.name;
  if (parsed.data.format !== undefined) update.format = parsed.data.format;
  if (parsed.data.fields !== undefined)
    update.fields = parsed.data.fields as EnvelopeField[];
  if (parsed.data.sender !== undefined) update.sender = parsed.data.sender;

  const [row] = await db
    .update(envelopeTemplates)
    .set(update)
    .where(
      and(
        eq(envelopeTemplates.id, params.id),
        eq(envelopeTemplates.userId, auth.user.id),
      ),
    )
    .returning();

  if (!row) {
    return NextResponse.json({ error: "Nicht gefunden." }, { status: 404 });
  }
  return NextResponse.json({ template: row });
}

/** DELETE /api/envelopes/[id] — Soft-Delete. */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await requireUserApi();
  if (!auth.ok) return auth.response;

  await db
    .update(envelopeTemplates)
    .set({ deletedAt: new Date() })
    .where(
      and(
        eq(envelopeTemplates.id, params.id),
        eq(envelopeTemplates.userId, auth.user.id),
      ),
    );
  return NextResponse.json({ ok: true });
}
