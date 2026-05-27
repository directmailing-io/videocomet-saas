export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { randomBytes, createHash } from "node:crypto";
import { requireAdminApi } from "@/lib/auth-guard";
import { db } from "@/lib/db";
import { passwordResets } from "@/lib/db/schema";
import { getUserById } from "@/lib/db/queries/users";
import { sendPasswordResetMail } from "@/lib/mail";

export async function POST(_req: NextRequest, ctx: { params: { id: string } }) {
  const guard = await requireAdminApi();
  if (!guard.ok) return guard.response;

  let user;
  try {
    user = await getUserById(ctx.params.id);
  } catch {
    return NextResponse.json({ error: "Benutzer nicht gefunden." }, { status: 404 });
  }

  const token = randomBytes(32).toString("hex");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000);

  await db.insert(passwordResets).values({
    userId: user.id,
    tokenHash,
    expiresAt,
  });

  try {
    await sendPasswordResetMail({
      to: user.email,
      token,
      firstName: user.firstName,
    });
  } catch (err) {
    console.error("[admin:users:send-reset] mail error", err);
    return NextResponse.json({ error: "Mail konnte nicht versendet werden." }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
