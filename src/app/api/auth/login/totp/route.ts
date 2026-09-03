export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/auth/login/totp — zweiter Login-Schritt für Admins mit 2FA.
 * Body: { mfaToken, code }. Das mfaToken stammt aus /api/auth/login
 * (Passwort bereits geprüft, 5 Minuten gültig). Bei korrektem Code wird
 * die Session erzeugt. Fehlversuche: 6 je 15 Minuten pro Konto.
 */

import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { z } from "zod";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { luciaAdmin } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { decryptTotpSecret, verifyShortToken, verifyTotp } from "@/lib/totp";

const bodySchema = z.object({
  mfaToken: z.string().min(10),
  code: z.string().min(6).max(8),
});

export async function POST(req: NextRequest) {
  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "Ungültige Anfrage." }, { status: 400 });
  }

  const token = verifyShortToken<{ uid: string }>(body.mfaToken, "mfa-login");
  if (!token || typeof token.uid !== "string") {
    return NextResponse.json(
      { error: "Die Anmeldung ist abgelaufen. Bitte noch einmal mit Passwort anmelden." },
      { status: 401 },
    );
  }

  const rl = await checkRateLimit(`mfa:${token.uid}`, 6, 15 * 60);
  if (!rl.ok) {
    return NextResponse.json(
      { error: "Zu viele falsche Codes. Bitte 15 Minuten warten." },
      { status: 429 },
    );
  }

  const [user] = await db
    .select({
      id: users.id,
      role: users.role,
      isActive: users.isActive,
      totpSecretEnc: users.totpSecretEnc,
      totpEnabledAt: users.totpEnabledAt,
    })
    .from(users)
    .where(eq(users.id, token.uid))
    .limit(1);

  if (!user || !user.isActive || user.role !== "admin" || !user.totpSecretEnc || !user.totpEnabledAt) {
    return NextResponse.json({ error: "Anmeldung nicht möglich." }, { status: 401 });
  }

  const secret = decryptTotpSecret(user.totpSecretEnc);
  if (!verifyTotp(secret, body.code)) {
    return NextResponse.json({ error: "Der Code ist falsch oder abgelaufen." }, { status: 401 });
  }

  await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));
  const session = await luciaAdmin.createSession(user.id, {});
  const cookie = luciaAdmin.createSessionCookie(session.id);
  (await cookies()).set(cookie.name, cookie.value, cookie.attributes);
  return NextResponse.json({ ok: true, role: user.role });
}
