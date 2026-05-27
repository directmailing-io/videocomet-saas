import { NextRequest, NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { passwordResets } from "@/lib/db/schema";
import { setUserPassword } from "@/lib/db/queries/users";
import { lucia } from "@/lib/auth";

const bodySchema = z.object({
  token: z.string().min(16, "Token fehlt."),
  newPassword: z.string().min(8, "Passwort muss mindestens 8 Zeichen lang sein."),
});

export async function POST(req: NextRequest) {
  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await req.json());
  } catch (err) {
    const msg = err instanceof z.ZodError ? (err.issues[0]?.message ?? "Ungültige Anfrage.") : "Ungültige Anfrage.";
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  const tokenHash = createHash("sha256").update(body.token).digest("hex");
  const now = new Date();

  const [reset] = await db
    .select()
    .from(passwordResets)
    .where(
      and(
        eq(passwordResets.tokenHash, tokenHash),
        gt(passwordResets.expiresAt, now),
        isNull(passwordResets.usedAt),
      ),
    )
    .limit(1);

  if (!reset) {
    return NextResponse.json({ error: "Token ungültig oder abgelaufen." }, { status: 401 });
  }

  try {
    await setUserPassword(reset.userId, body.newPassword);
    await db
      .update(passwordResets)
      .set({ usedAt: new Date() })
      .where(eq(passwordResets.id, reset.id));
    await lucia.invalidateUserSessions(reset.userId);
  } catch (err) {
    console.error("[password-reset:confirm] error", err);
    return NextResponse.json({ error: "Passwort konnte nicht aktualisiert werden." }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
