/**
 * Public-Endpoint: Passwort-Login für einen Feedback-Link.
 *
 * Setzt bei Erfolg ein signiertes HttpOnly-Cookie (Pfad `/review/<token>`,
 * TTL 24 h). Rate-Limit: ≥10 fehlgeschlagene Versuche pro (token, ipHash)
 * in 15 min → 429. Constant-Time-Delay bei Misserfolg.
 *
 * Links OHNE Passwort dürfen diese Route nicht aufrufen — 400 statt 200,
 * damit der Empfänger nicht "irgendein Passwort" tippen kann und einfach
 * durchkommt (Verwirrung im UI).
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { cookies } from "next/headers";
import { z } from "zod";
import {
  countRecentFailedAttempts,
  getActiveLinkByToken,
  recordAttempt,
  updateLinkLastAccessed,
  verifyLinkPassword,
} from "@/lib/db/queries/video-feedback";
import { signReviewCookie } from "@/lib/feedback-cookie";
import { requireShareCookieSecret } from "@/lib/share-cookie";
import { getClientIp } from "@/lib/tracking";

requireShareCookieSecret();

const RATE_LIMIT_MAX_FAILS = 10;
const FAILURE_DELAY_MS = 200;
const COOKIE_TTL_SEC = 24 * 60 * 60;

const bodySchema = z.object({
  password: z
    .string()
    .transform((s) => s.trim())
    .pipe(z.string().min(1, "Passwort fehlt.").max(256)),
});

function hashIp(ip: string): string {
  return createHash("sha256").update(ip).digest("hex").slice(0, 16);
}
async function delay(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
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
  } catch {
    return NextResponse.json({ error: "Ungültige Anfrage." }, { status: 400 });
  }

  const ipHash = hashIp(getClientIp(req));

  const fails = await countRecentFailedAttempts(token, ipHash, "auth");
  if (fails >= RATE_LIMIT_MAX_FAILS) {
    await delay(FAILURE_DELAY_MS);
    return NextResponse.json(
      { error: "Zu viele Versuche. Bitte in 15 Minuten erneut probieren." },
      { status: 429 },
    );
  }

  const link = await getActiveLinkByToken(token);
  if (!link) {
    await delay(FAILURE_DELAY_MS);
    return NextResponse.json({ error: "Link nicht gefunden." }, { status: 404 });
  }
  if (!link.hasPassword) {
    // Kein Passwort erwartet — Client sollte nicht hier landen.
    return NextResponse.json(
      { error: "Dieser Link braucht kein Passwort." },
      { status: 400 },
    );
  }

  const ok = await verifyLinkPassword(link.passwordHash, body.password);
  try {
    await recordAttempt(token, ipHash, "auth", ok);
  } catch {
    // ignore
  }

  if (!ok) {
    await delay(FAILURE_DELAY_MS);
    return NextResponse.json({ error: "Passwort ist falsch." }, { status: 401 });
  }

  try {
    await updateLinkLastAccessed(link.id);
  } catch {
    // ignore
  }

  const signed = signReviewCookie(token, COOKIE_TTL_SEC);
  (await cookies()).set(signed.name, signed.value, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: signed.maxAge,
    path: signed.path,
  });
  return NextResponse.json({ ok: true }, {
    headers: { "Cache-Control": "private, no-store" },
  });
}
