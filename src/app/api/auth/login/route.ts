export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { cookies } from "next/headers";
import argon2 from "argon2";
import { z } from "zod";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { lucia } from "@/lib/auth";

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
  const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);

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

  await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));

  const session = await lucia.createSession(user.id, {});
  const cookie = lucia.createSessionCookie(session.id);
  (await cookies()).set(cookie.name, cookie.value, cookie.attributes);

  return NextResponse.json({ ok: true, role: user.role });
}
