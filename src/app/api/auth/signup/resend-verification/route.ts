export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { randomBytes, createHash } from "node:crypto";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users, emailVerifications } from "@/lib/db/schema";
import { sendEmailVerificationMail } from "@/lib/mail";
import { marketingOrigin } from "@/lib/billing/signup-checkout";
import { checkRateLimit } from "@/lib/rate-limit";

/**
 * POST /api/auth/signup/resend-verification  { email }
 *
 * Schickt die Signup-Verifizierungsmail erneut. Enumeration-safe: immer
 * { ok: true }, egal ob das Konto existiert oder schon verifiziert ist.
 */
const BODY = z.object({
  email: z.string().trim().toLowerCase().email(),
});

export async function POST(req: NextRequest) {
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    "unknown";
  const rl = await checkRateLimit(`resend-verification:${ip}`, 5, 60 * 60);
  if (!rl.ok) {
    return NextResponse.json(
      { error: "Zu viele Versuche. Bitte später erneut probieren." },
      { status: 429 },
    );
  }

  const raw = await req.json().catch(() => null);
  const parsed = BODY.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ ok: true });
  }

  const [user] = await db
    .select({
      id: users.id,
      email: users.email,
      firstName: users.firstName,
      emailVerifiedAt: users.emailVerifiedAt,
      isActive: users.isActive,
    })
    .from(users)
    .where(eq(users.email, parsed.data.email))
    .limit(1);

  if (user && user.isActive && !user.emailVerifiedAt) {
    try {
      const token = randomBytes(32).toString("hex");
      const tokenHash = createHash("sha256").update(token).digest("hex");
      await db.insert(emailVerifications).values({
        userId: user.id,
        tokenHash,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      });
      await sendEmailVerificationMail({
        to: user.email,
        firstName: user.firstName,
        verifyUrl: `${marketingOrigin()}/api/auth/verify-email?token=${token}`,
      });
    } catch (err) {
      console.error("[resend-verification] mail error:", err);
      // Enumeration-safe: Fehler nicht nach aussen geben.
    }
  }

  return NextResponse.json({ ok: true });
}
