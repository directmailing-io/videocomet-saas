/**
 * Custom-Landingpage templates — collection endpoint.
 *
 *   GET  /api/custom-lp        List the current user's templates.
 *   POST /api/custom-lp        Create an empty template (no files yet —
 *                              versions are uploaded via the versions route).
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUserApi } from "@/lib/auth-guard";
import {
  createTemplate,
  listTemplatesForUser,
} from "@/lib/db/queries/custom-lp";

const createSchema = z.object({
  name: z.string().min(1, "Name darf nicht leer sein.").max(120),
  description: z.string().max(2_000).nullish(),
});

export async function GET() {
  const auth = await requireUserApi();
  if (!auth.ok) return auth.response;

  const rows = await listTemplatesForUser(auth.user.id);
  const templates = rows.map((row) => ({
    id: row.template.id,
    name: row.template.name,
    description: row.template.description,
    thumbnailUrl: row.template.thumbnailUrl,
    activeVersion: row.activeVersion,
    versionCount: row.versionCount,
    createdAt: row.template.createdAt,
    updatedAt: row.template.updatedAt,
  }));
  return NextResponse.json({ templates });
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
        error: "Ungültige Eingabe.",
        details: err instanceof Error ? err.message : null,
      },
      { status: 400 },
    );
  }

  const template = await createTemplate(auth.user.id, {
    name: body.name,
    description: body.description ?? null,
  });
  return NextResponse.json({ template }, { status: 201 });
}
