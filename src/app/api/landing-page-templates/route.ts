export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUserApi } from "@/lib/auth-guard";
import { createTpl, listUserTpls } from "@/lib/db/queries/landingPageTemplates";

const THEME_IDS = ["noir", "clean", "gradient", "warm"] as const;

const createSchema = z.object({
  name: z.string().min(1).max(120),
  themeId: z.enum(THEME_IDS),
  content: z.record(z.string(), z.unknown()),
});

export async function GET() {
  const auth = await requireUserApi();
  if (!auth.ok) return auth.response;

  const rows = await listUserTpls(auth.user.id);
  const items = rows.map((row) => ({
    id: row.id,
    name: row.name,
    themeId: row.themeId,
    content: row.content,
    createdAt: row.createdAt,
  }));
  return NextResponse.json({ items });
}

export async function POST(req: NextRequest) {
  const auth = await requireUserApi();
  if (!auth.ok) return auth.response;

  let body: z.infer<typeof createSchema>;
  try {
    body = createSchema.parse(await req.json());
  } catch (err) {
    return NextResponse.json(
      {
        error: "Ungueltige Eingabe.",
        details: err instanceof Error ? err.message : null,
      },
      { status: 400 },
    );
  }

  const tpl = await createTpl(auth.user.id, {
    name: body.name,
    themeId: body.themeId,
    content: body.content as Record<string, unknown>,
  });
  return NextResponse.json({ template: tpl }, { status: 201 });
}
