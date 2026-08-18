/**
 * Public-Endpoint: Kommentar-Insert für einen Feedback-Link.
 *
 * Body: { atSec?: number|null, atEndSec?: number|null, authorName: string, body: string }
 *
 * Rate-Limit: max 30 Kommentare pro (token, ipHash) in 15 min → 429.
 * Auth: bei Passwort-Link Cookie verpflichtend, sonst öffentlich.
 * Sanitization: Trim + Length-Deckel + Sub-Second-Präzision in insertComment.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { cookies } from "next/headers";
import { z } from "zod";
import {
  COMMENT_AUTHOR_MAX,
  COMMENT_BODY_MAX,
  countRecentAttempts,
  getActiveLinkByToken,
  insertComment,
  recordAttempt,
} from "@/lib/db/queries/video-feedback";
import { reviewCookieName, verifyReviewCookie } from "@/lib/feedback-cookie";
import { getClientIp } from "@/lib/tracking";

const RATE_LIMIT_MAX = 30;

const bodySchema = z.object({
  atSec: z.number().finite().min(0).max(7200).nullable().optional(),
  atEndSec: z.number().finite().min(0).max(7200).nullable().optional(),
  authorName: z.string().trim().min(1, "Bitte Namen angeben.").max(COMMENT_AUTHOR_MAX),
  body: z.string().trim().min(1, "Kommentar darf nicht leer sein.").max(COMMENT_BODY_MAX),
});

function hashIp(ip: string): string {
  return createHash("sha256").update(ip).digest("hex").slice(0, 16);
}

export async function POST(
  req: NextRequest,
  { params }: { params: { token: string } },
) {
  const token = params.token;
  if (!token || typeof token !== "string") {
    return NextResponse.json({ error: "Ungültiger Link." }, { status: 400 });
  }

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await req.json());
  } catch (err) {
    const msg = err instanceof z.ZodError ? (err.issues[0]?.message ?? "Ungültige Anfrage.") : "Ungültige Anfrage.";
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  const link = await getActiveLinkByToken(token);
  if (!link) {
    return NextResponse.json({ error: "Link nicht gefunden." }, { status: 404 });
  }
  if (link.hasPassword) {
    const raw = (await cookies()).get(reviewCookieName(token))?.value ?? null;
    if (!verifyReviewCookie(token, raw)) {
      return NextResponse.json(
        { error: "Passwort erforderlich.", needsPassword: true },
        { status: 401 },
      );
    }
  }

  const ipHash = hashIp(getClientIp(req));
  const recent = await countRecentAttempts(token, ipHash, "comment");
  if (recent >= RATE_LIMIT_MAX) {
    return NextResponse.json(
      { error: "Zu viele Kommentare in kurzer Zeit. Bitte kurz warten." },
      { status: 429 },
    );
  }

  try {
    const row = await insertComment({
      linkId: link.id,
      atSec: body.atSec ?? null,
      atEndSec: body.atEndSec ?? null,
      authorName: body.authorName,
      body: body.body,
    });
    try {
      await recordAttempt(token, ipHash, "comment", true);
    } catch {
      // ignore
    }
    return NextResponse.json({ ok: true, comment: row });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Konnte den Kommentar nicht speichern.";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
