/**
 * Owner-API für einen einzelnen Feedback-Kommentar.
 *
 *   PATCH  → { resolved?: boolean, ownerReply?: string | null }
 *   DELETE → hart löschen (Empfänger sieht ihn beim nächsten Reload nicht mehr)
 *
 * Ownership via Sub-Select im UPDATE: der Kommentar muss zu einem Link
 * gehören, der wiederum dem eingeloggten User gehört. `campaign_id` im
 * Pfad wird nur als Kontext genutzt, echter Guard ist die Sub-Select-
 * Klausel — so ist ein IDOR über `commentId` sinnlos.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUserApi } from "@/lib/auth-guard";
import {
  COMMENT_REPLY_MAX,
  deleteComment,
  setOwnerReply,
  setResolved,
} from "@/lib/db/queries/video-feedback";

const patchSchema = z
  .object({
    resolved: z.boolean().optional(),
    ownerReply: z.string().max(COMMENT_REPLY_MAX).nullable().optional(),
  })
  .refine(
    (v) => v.resolved !== undefined || v.ownerReply !== undefined,
    { message: "Nichts zu ändern." },
  );

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string; commentId: string } },
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

  let touched = false;
  if (body.resolved !== undefined) {
    const ok = await setResolved(params.commentId, auth.user.id, body.resolved);
    if (!ok) {
      return NextResponse.json({ error: "Kommentar nicht gefunden." }, { status: 404 });
    }
    touched = true;
  }
  if (body.ownerReply !== undefined) {
    const ok = await setOwnerReply(params.commentId, auth.user.id, body.ownerReply);
    if (!ok) {
      return NextResponse.json({ error: "Kommentar nicht gefunden." }, { status: 404 });
    }
    touched = true;
  }
  if (!touched) {
    return NextResponse.json({ error: "Nichts zu ändern." }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { commentId: string } },
) {
  const auth = await requireUserApi();
  if (!auth.ok) return auth.response;
  const ok = await deleteComment(params.commentId, auth.user.id);
  if (!ok) {
    return NextResponse.json({ error: "Kommentar nicht gefunden." }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
