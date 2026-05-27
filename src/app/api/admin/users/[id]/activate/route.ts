export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth-guard";
import { activateUser } from "@/lib/db/queries/users";

export async function POST(_req: NextRequest, ctx: { params: { id: string } }) {
  const guard = await requireAdminApi();
  if (!guard.ok) return guard.response;

  try {
    const user = await activateUser(ctx.params.id);
    const { passwordHash: _ph, ...rest } = user;
    return NextResponse.json({ user: rest });
  } catch (err) {
    console.error("[admin:users:activate] error", err);
    return NextResponse.json({ error: "Benutzer nicht gefunden." }, { status: 404 });
  }
}
