export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { lucia, validateRequest } from "@/lib/auth";

async function destroySession() {
  const { session } = await validateRequest();
  if (session) {
    await lucia.invalidateSession(session.id);
  }
  const blank = lucia.createBlankSessionCookie();
  (await cookies()).set(blank.name, blank.value, blank.attributes);
}

export async function POST() {
  await destroySession();
  return NextResponse.json({ ok: true });
}

// Die "Abmelden"-Links in AppShell/AdminShell sind normale <Link>-
// Navigationen (GET). Ohne GET-Handler antwortet Next mit 405.
export async function GET(req: NextRequest) {
  await destroySession();
  return NextResponse.redirect(new URL("/login", req.nextUrl.origin), {
    status: 302,
  });
}
