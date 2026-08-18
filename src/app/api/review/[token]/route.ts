/**
 * Public-Endpoint: Video-Meta + Kommentar-Liste für einen Feedback-Link.
 *
 * Auth:
 *   - Link ohne Passwort → jeder mit Token darf lesen.
 *   - Link mit Passwort → nur mit signiertem Cookie (`/api/review/[token]/authenticate`).
 *
 * Wir bestätigen dem Client explizit `needsPassword: true` im 401er,
 * damit die Public-Page den Passwort-Prompt zeigen kann ohne im
 * Vorfeld ein separates "Ist Passwort gesetzt?"-API zu brauchen.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  getActiveLinkByToken,
  getFeedbackVideoMeta,
  listComments,
} from "@/lib/db/queries/video-feedback";
import { reviewCookieName, verifyReviewCookie } from "@/lib/feedback-cookie";

export async function GET(
  _req: NextRequest,
  { params }: { params: { token: string } },
) {
  const token = params.token;
  if (!token || typeof token !== "string") {
    return NextResponse.json({ error: "Ungültiger Link." }, { status: 400 });
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

  const video = await getFeedbackVideoMeta(link.campaignId);
  const comments = await listComments(link.id);

  return NextResponse.json(
    {
      video,
      comments,
      hasPassword: link.hasPassword,
      expiresAt: link.expiresAt,
    },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
