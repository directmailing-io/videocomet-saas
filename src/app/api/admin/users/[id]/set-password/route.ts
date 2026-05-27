import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminApi } from "@/lib/auth-guard";
import { getUserById, setUserPassword } from "@/lib/db/queries/users";
import { lucia } from "@/lib/auth";

const bodySchema = z.object({
  newPassword: z.string().min(8, "Passwort muss mindestens 8 Zeichen lang sein."),
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

  try {
    await getUserById(ctx.params.id);
  } catch {
    return NextResponse.json({ error: "Benutzer nicht gefunden." }, { status: 404 });
  }

  try {
    await setUserPassword(ctx.params.id, body.newPassword);
    // Force re-login for the target user.
    await lucia.invalidateUserSessions(ctx.params.id);
  } catch (err) {
    console.error("[admin:users:set-password] error", err);
    return NextResponse.json({ error: "Passwort konnte nicht gesetzt werden." }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
