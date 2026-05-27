export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUserApi } from "@/lib/auth-guard";
import {
  deleteTpl,
  getTpl,
  updateTpl,
} from "@/lib/db/queries/landingPageTemplates";

const THEME_IDS = ["noir", "clean", "gradient", "warm"] as const;

const patchSchema = z
  .object({
    name: z.string().min(1).max(120).optional(),
    themeId: z.enum(THEME_IDS).optional(),
    content: z.record(z.string(), z.unknown()).optional(),
  })
  .refine(
    (data) =>
      data.name !== undefined ||
      data.themeId !== undefined ||
      data.content !== undefined,
    { message: "Mindestens ein Feld muss angegeben werden." },
  );

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await requireUserApi();
  if (!auth.ok) return auth.response;
  try {
    const tpl = await getTpl(params.id, auth.user.id);
    return NextResponse.json({ template: tpl });
  } catch {
    return NextResponse.json({ error: "Nicht gefunden." }, { status: 404 });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await requireUserApi();
  if (!auth.ok) return auth.response;

  let body: z.infer<typeof patchSchema>;
  try {
    body = patchSchema.parse(await req.json());
  } catch (err) {
    return NextResponse.json(
      {
        error: "Ungültige Eingabe.",
        details: err instanceof Error ? err.message : null,
      },
      { status: 400 },
    );
  }

  try {
    const tpl = await updateTpl(params.id, auth.user.id, {
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.themeId !== undefined ? { themeId: body.themeId } : {}),
      ...(body.content !== undefined
        ? { content: body.content as Record<string, unknown> }
        : {}),
    });
    return NextResponse.json({ template: tpl });
  } catch {
    return NextResponse.json({ error: "Nicht gefunden." }, { status: 404 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await requireUserApi();
  if (!auth.ok) return auth.response;
  try {
    await deleteTpl(params.id, auth.user.id);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Nicht gefunden." }, { status: 404 });
  }
}
