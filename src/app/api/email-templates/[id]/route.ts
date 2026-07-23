export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUserApi } from "@/lib/auth-guard";
import {
  getEmailTemplate,
  serializeEmailTemplate,
  softDeleteEmailTemplate,
  updateEmailTemplate,
} from "@/lib/db/queries/email-templates";

/** GET /api/email-templates/[id] — Detail einer Vorlage. */
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await requireUserApi();
  if (!auth.ok) return auth.response;

  const row = await getEmailTemplate(params.id, auth.user.id);
  if (!row) {
    return NextResponse.json({ error: "Nicht gefunden." }, { status: 404 });
  }
  return NextResponse.json({ template: serializeEmailTemplate(row) });
}

const PatchBody = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  subject: z.string().max(500).optional(),
  bodyJson: z.unknown().optional(),
  bodyHtml: z.string().max(100_000).optional(),
  ctaLabel: z.string().max(120).optional(),
  ctaUrl: z.string().max(2_000).optional(),
  signatureHtml: z.string().max(20_000).nullable().optional(),
  impressumHtml: z.string().max(20_000).optional(),
});

/**
 * PATCH /api/email-templates/[id] — Vorlage aktualisieren.
 *
 * Speichern ist auch OHNE Impressum erlaubt (Draft) — die Blast-Nutzung
 * wird über `isComplete` in der Antwort gesteuert (Step 3 prüft das
 * beim Start serverseitig erneut).
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await requireUserApi();
  if (!auth.ok) return auth.response;

  const raw = await req.json().catch(() => null);
  const parsed = PatchBody.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Ungueltiger Body" },
      { status: 400 },
    );
  }

  const row = await updateEmailTemplate(params.id, auth.user.id, parsed.data);
  if (!row) {
    return NextResponse.json({ error: "Nicht gefunden." }, { status: 404 });
  }
  return NextResponse.json({ template: serializeEmailTemplate(row) });
}

/** DELETE /api/email-templates/[id] — Soft-Delete. */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await requireUserApi();
  if (!auth.ok) return auth.response;

  await softDeleteEmailTemplate(params.id, auth.user.id);
  return NextResponse.json({ ok: true });
}
