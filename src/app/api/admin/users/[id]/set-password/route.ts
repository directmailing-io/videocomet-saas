export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminApi } from "@/lib/auth-guard";
import { getUserById, setUserPassword } from "@/lib/db/queries/users";
import { lucia } from "@/lib/auth";
import { logAdminAction } from "@/lib/admin-audit";
import { requireAdminPassword } from "@/lib/admin-reauth";

const bodySchema = z.object({
  newPassword: z.string().min(8, "Passwort muss mindestens 8 Zeichen lang sein."),
  adminPassword: z.string().optional(),
});

export async function POST(req: NextRequest, ctx: { params: { id: string } }) {
  const guard = await requireAdminApi();
  if (!guard.ok) return guard.response;

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await req.json());
  } catch (err) {
    const msg = err instanceof z.ZodError ? (err.issues[0]?.message ?? "Ungültige Anfrage.") : "Ungültige Anfrage.";
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  const reauth = await requireAdminPassword(guard.user.id, body.adminPassword);
  if (!reauth.ok) return reauth.response;

  let target;
  try {
    target = await getUserById(ctx.params.id);
  } catch {
    return NextResponse.json({ error: "Benutzer nicht gefunden." }, { status: 404 });
  }

  try {
    await setUserPassword(ctx.params.id, body.newPassword);
    await logAdminAction({
      admin: { id: guard.user.id, email: guard.user.email },
      action: "user.set_password",
      targetType: "user",
      targetId: target.id,
      details: { targetEmail: target.email },
      req,
    });
    // Force re-login for the target user.
    await lucia.invalidateUserSessions(ctx.params.id);
  } catch (err) {
    console.error("[admin:users:set-password] error", err);
    return NextResponse.json({ error: "Passwort konnte nicht gesetzt werden." }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
