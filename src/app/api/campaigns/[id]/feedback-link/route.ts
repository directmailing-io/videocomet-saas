/**
 * Owner-API für den Video-Feedback-Link einer Kampagne.
 *
 *   GET     → aktueller aktiver Link + Kommentare (oder null)
 *   POST    → Link erstellen ODER rotieren. Body: { ttlDays?, password? }
 *   PATCH   → Passwort/Ablauf am aktiven Link ändern. Body: { ttlDays?, password? | null }
 *   DELETE  → aktiven Link revoken (Kommentare bleiben erhalten)
 *
 * Tenant-Guard: requireUserApi + ownership-scoping in jeder Query.
 * Kampagne muss existieren und darf nicht soft-deleted sein.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUserApi } from "@/lib/auth-guard";
import {
  createLinkForCampaign,
  getOwnerLinkForCampaign,
  revokeLinkForCampaign,
  updateLink,
} from "@/lib/db/queries/video-feedback";

const createSchema = z.object({
  ttlDays: z.number().int().min(1).max(90).optional(),
  password: z.string().min(4).max(128).optional().nullable(),
});

const patchSchema = z.object({
  ttlDays: z.number().int().min(1).max(90).optional(),
  // `null` = Passwort entfernen; `undefined` = unverändert; string = setzen/ersetzen.
  password: z.string().min(4).max(128).nullable().optional(),
});

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await requireUserApi();
  if (!auth.ok) return auth.response;
  const link = await getOwnerLinkForCampaign(params.id, auth.user.id);
  return NextResponse.json({ link });
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await requireUserApi();
  if (!auth.ok) return auth.response;

  let body: z.infer<typeof createSchema>;
  try {
    body = createSchema.parse(await req.json().catch(() => ({})));
  } catch (err) {
    const msg = err instanceof z.ZodError ? (err.issues[0]?.message ?? "Ungültige Anfrage.") : "Ungültige Anfrage.";
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  try {
    const result = await createLinkForCampaign({
      campaignId: params.id,
      userId: auth.user.id,
      ttlDays: body.ttlDays ?? 7,
      password: body.password ?? null,
    });
    const view = await getOwnerLinkForCampaign(params.id, auth.user.id);
    return NextResponse.json({ ok: true, id: result.id, token: result.token, link: view });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Fehler beim Erstellen.";
    const status = msg === "Not found" ? 404 : 400;
    return NextResponse.json(
      { error: msg === "Not found" ? "Kampagne nicht gefunden." : msg },
      { status },
    );
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
    body = patchSchema.parse(await req.json().catch(() => ({})));
  } catch (err) {
    const msg = err instanceof z.ZodError ? (err.issues[0]?.message ?? "Ungültige Anfrage.") : "Ungültige Anfrage.";
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  // Wir nutzen die Ownership-Guard-Route über getOwnerLinkForCampaign, um
  // die link.id für updateLink zu bekommen. Kein direktes updateLinkByCampaign,
  // damit die WHERE-Klausel eng auf id + userId ist.
  const view = await getOwnerLinkForCampaign(params.id, auth.user.id);
  if (!view) {
    return NextResponse.json({ error: "Kein aktiver Feedback-Link." }, { status: 404 });
  }
  try {
    const updated = await updateLink(view.id, auth.user.id, {
      password: body.password === undefined ? undefined : body.password,
      ttlDays: body.ttlDays,
    });
    if (!updated) {
      return NextResponse.json({ error: "Kein aktiver Feedback-Link." }, { status: 404 });
    }
    const next = await getOwnerLinkForCampaign(params.id, auth.user.id);
    return NextResponse.json({ ok: true, link: next });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Fehler beim Speichern.";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await requireUserApi();
  if (!auth.ok) return auth.response;
  const revoked = await revokeLinkForCampaign(params.id, auth.user.id);
  if (!revoked) {
    return NextResponse.json({ error: "Kein aktiver Feedback-Link." }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
