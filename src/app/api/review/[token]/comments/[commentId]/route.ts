/**
 * Guest-Endpoints für einen einzelnen Feedback-Kommentar.
 *
 *   PATCH   → Body: { body: string, sessionId: string }
 *   DELETE  → Body: { sessionId: string }
 *
 * Auth via `sessionId` (client-generierte UUID im LocalStorage). Der Kommentar
 * muss zu genau diesem Link UND zu genau dieser Session gehören — sonst 404.
 * So kann ein Reviewer seine eigenen Kommentare editieren/löschen, ohne dass
 * ein anderer Besucher fremde Kommentare anfassen kann.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { z } from "zod";
import {
  COMMENT_BODY_MAX,
  getActiveLinkByToken,
  guestDeleteComment,
  guestUpdateComment,
} from "@/lib/db/queries/video-feedback";
import { reviewCookieName, verifyReviewCookie } from "@/lib/feedback-cookie";

const sessionSchema = z
  .string()
  .regex(/^[a-f0-9-]{16,64}$/i, "Ungültige Session-ID.");

const patchSchema = z.object({
  body: z.string().trim().min(1, "Kommentar darf nicht leer sein.").max(COMMENT_BODY_MAX),
  sessionId: sessionSchema,
});

const deleteSchema = z.object({
  sessionId: sessionSchema,
});

async function ensureLinkAccessible(token: string) {
  const link = await getActiveLinkByToken(token);
  if (!link) return { link: null as null, error: NextResponse.json({ error: "Link nicht gefunden." }, { status: 404 }) };
  if (link.hasPassword) {
    const raw = (await cookies()).get(reviewCookieName(token))?.value ?? null;
    if (!verifyReviewCookie(token, raw)) {
      return {
        link: null as null,
        error: NextResponse.json(
          { error: "Passwort erforderlich.", needsPassword: true },
          { status: 401 },
        ),
      };
    }
  }
  return { link, error: null as null };
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { token: string; commentId: string } },
) {
  const acc = await ensureLinkAccessible(params.token);
  if (!acc.link) return acc.error;

  let body: z.infer<typeof patchSchema>;
  try {
    body = patchSchema.parse(await req.json());
  } catch (err) {
    const msg = err instanceof z.ZodError ? (err.issues[0]?.message ?? "Ungültige Anfrage.") : "Ungültige Anfrage.";
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  try {
    const row = await guestUpdateComment({
      linkId: acc.link.id,
      commentId: params.commentId,
      sessionId: body.sessionId,
      body: body.body,
    });
    if (!row) {
      return NextResponse.json({ error: "Dieser Kommentar gehört nicht dir." }, { status: 404 });
    }
    return NextResponse.json({ ok: true, comment: row });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Konnte nicht speichern.";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { token: string; commentId: string } },
) {
  const acc = await ensureLinkAccessible(params.token);
  if (!acc.link) return acc.error;

  let body: z.infer<typeof deleteSchema>;
  try {
    body = deleteSchema.parse(await req.json().catch(() => ({})));
  } catch (err) {
    const msg = err instanceof z.ZodError ? (err.issues[0]?.message ?? "Ungültige Anfrage.") : "Ungültige Anfrage.";
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  const ok = await guestDeleteComment({
    linkId: acc.link.id,
    commentId: params.commentId,
    sessionId: body.sessionId,
  });
  if (!ok) {
    return NextResponse.json({ error: "Dieser Kommentar gehört nicht dir." }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
