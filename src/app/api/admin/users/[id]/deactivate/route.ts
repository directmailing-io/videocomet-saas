export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth-guard";
import { deactivateUser } from "@/lib/db/queries/users";
import { lucia } from "@/lib/auth";

export async function POST(_req: NextRequest, ctx: { params: { id: string } }) {
  const guard = await requireAdminApi();
  if (!guard.ok) return guard.response;

  if (guard.user.id === ctx.params.id) {
    return NextResponse.json({ error: "Du kannst dich nicht selbst deaktivieren." }, { status: 400 });
  }

  try {
    const user = await deactivateUser(ctx.params.id);
    // Drop all sessions of the deactivated user immediately.
    await lucia.invalidateUserSessions(ctx.params.id);
    const { passwordHash: _ph, ...rest } = user;
    return NextResponse.json({ user: rest });
  } catch (err) {
    console.error("[admin:users:deactivate] error", err);
    return NextResponse.json({ error: "Benutzer nicht gefunden." }, { status: 404 });
  }
}
