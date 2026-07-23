export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUserApi } from "@/lib/auth-guard";
import {
  createEmailTemplate,
  isEmailTemplateComplete,
  listEmailTemplates,
  serializeEmailTemplate,
} from "@/lib/db/queries/email-templates";

/** GET /api/email-templates — Liste aller E-Mail-Vorlagen des Users. */
export async function GET() {
  const auth = await requireUserApi();
  if (!auth.ok) return auth.response;

  const rows = await listEmailTemplates(auth.user.id);
  return NextResponse.json({
    templates: rows.map((t) => ({
      id: t.id,
      name: t.name,
      subject: t.subject,
      isComplete: isEmailTemplateComplete(t),
      updatedAt: t.updatedAt,
    })),
  });
}

const CreateBody = z.object({
  name: z.string().trim().min(1, "Name fehlt.").max(120),
});

/** POST /api/email-templates — Neue (leere) Vorlage anlegen. */
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

  const row = await createEmailTemplate(auth.user.id, {
    name: parsed.data.name,
  });
  return NextResponse.json({ template: serializeEmailTemplate(row) });
}
