export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { allValidSessions, lucia, luciaAdmin } from "@/lib/auth";

async function destroySession() {
  // Alle Sitzungen abmelden, die der Browser mitschickt (Kunde UND Admin),
  // und beide Cookie-Namen leeren.
  for (const { inst, session } of await allValidSessions()) {
    await inst.invalidateSession(session.id);
  }
  const jar = await cookies();
  for (const inst of [lucia, luciaAdmin]) {
    const blank = inst.createBlankSessionCookie();
    jar.set(blank.name, blank.value, blank.attributes);
  }
}

export async function POST() {
  await destroySession();
  return NextResponse.json({ ok: true });
}

// Die "Abmelden"-Links in AppShell/AdminShell sind normale <Link>-
// Navigationen (GET). Ohne GET-Handler antwortet Next mit 405.
export async function GET(req: NextRequest) {
  await destroySession();
  // Hinter Traefik ist req.nextUrl.origin die Container-Adresse
  // (0.0.0.0:3000) — deshalb APP_URL als Basis.
  const base = process.env.APP_URL ?? req.nextUrl.origin;
  return NextResponse.redirect(new URL("/login", base), { status: 302 });
}
