export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { eq, and, ne } from "drizzle-orm";
import { db } from "@/lib/db";
import { sessions } from "@/lib/db/schema";
import { getUserById, setUserPassword, verifyPassword } from "@/lib/db/queries/users";
import { requireAnyUserApi } from "@/lib/auth-guard";

const bodySchema = z.object({
  currentPassword: z.string().min(1, "Aktuelles Passwort fehlt."),
  newPassword: z.string().min(8, "Neues Passwort muss mindestens 8 Zeichen lang sein."),
});

export async function POST(req: NextRequest) {
  const guard = await requireAnyUserApi();
  if (!guard.ok) return guard.response;

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await req.json());
  } catch (err) {
    const msg = err instanceof z.ZodError ? (err.issues[0]?.message ?? "Ungültige Anfrage.") : "Ungültige Anfrage.";
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  const user = await getUserById(guard.user.id);
  const valid = await verifyPassword(user.passwordHash, body.currentPassword);
  if (!valid) {
    return NextResponse.json({ error: "Aktuelles Passwort ist falsch." }, { status: 403 });
  }

  await setUserPassword(user.id, body.newPassword);

  // Invalidate all OTHER sessions of this user, but keep the current one.
  await db
    .delete(sessions)
    .where(and(eq(sessions.userId, user.id), ne(sessions.id, guard.session.id)));

  return NextResponse.json({ ok: true });
}
