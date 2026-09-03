export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { cookies } from "next/headers";
import argon2 from "argon2";
import { z } from "zod";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { luciaFor } from "@/lib/auth";
import { signShortToken } from "@/lib/totp";
import { checkRateLimit } from "@/lib/rate-limit";
import { getClientIp } from "@/lib/tracking";

const bodySchema = z.object({
  email: z.string().email("Ungültige E-Mail-Adresse."),
  password: z.string().min(1, "Passwort fehlt."),
  expectedRole: z.enum(["admin", "user"]),
});

export async function POST(req: NextRequest) {
  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "Ungültige Anfrage." }, { status: 400 });
  }

  const email = body.email.trim().toLowerCase();

  const ip = getClientIp(req);
  const [ipLimit, emailLimit] = await Promise.all([
    checkRateLimit(`login:ip:${ip}`, 20, 15 * 60),
    checkRateLimit(`login:email:${email}`, 10, 15 * 60),
  ]);
  if (!ipLimit.ok || !emailLimit.ok) {
    return NextResponse.json(
      { error: "Zu viele Anmeldeversuche. Bitte warte ein paar Minuten." },
      { status: 429 },
    );
  }

  const [user] = await db
    .select({
      id: users.id,
      passwordHash: users.passwordHash,
      isActive: users.isActive,
      role: users.role,
      totpEnabledAt: users.totpEnabledAt,
    })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  if (!user) {
    return NextResponse.json({ error: "E-Mail oder Passwort ist falsch." }, { status: 401 });
  }

  const valid = await argon2.verify(user.passwordHash, body.password);
  if (!valid) {
    return NextResponse.json({ error: "E-Mail oder Passwort ist falsch." }, { status: 401 });
  }

  if (!user.isActive) {
    return NextResponse.json(
      { error: "Dein Konto ist deaktiviert. Bitte wende dich an den Administrator." },
      { status: 403 },
    );
  }

  if (user.role !== body.expectedRole) {
    const msg = body.expectedRole === "admin"
      ? "Dieser Account hat keinen Administrator-Zugang."
      : "Bitte nutze den Administrator-Login.";
    return NextResponse.json({ error: msg }, { status: 403 });
  }

  // Zwei-Faktor (nur Admin-Konten mit aktiviertem TOTP, seit 2026-09-02):
  // Passwort stimmt, aber es gibt noch keine Session. Der Client bekommt
  // ein 5 Minuten gueltiges, signiertes Token und schickt es zusammen mit
  // dem 6-stelligen Code an /api/auth/login/totp.
  if (user.role === "admin" && user.totpEnabledAt) {
    const mfaToken = signShortToken({ uid: user.id }, 5 * 60, "mfa-login");
    return NextResponse.json({ ok: false, mfaRequired: true, mfaToken });
  }

  await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));

  // Admin und Kunde haben getrennte Cookie-Namen (seit 2026-09-03), damit
  // beide Sitzungen im selben Browser nebeneinander bestehen koennen.
  const inst = luciaFor(user.role);
  const session = await inst.createSession(user.id, {});
  const cookie = inst.createSessionCookie(session.id);
  // Hinweis: Das alte domain-weite Cookie (.videocomet.de, bis 2026-09-02)
  // raeumt die Middleware beim naechsten Seitenaufruf weg (Set-Cookie mit
  // Max-Age=0). Hier geht das nicht: cookies().set() ist per Name gekeyt.
  (await cookies()).set(cookie.name, cookie.value, cookie.attributes);

  return NextResponse.json({ ok: true, role: user.role });
}
