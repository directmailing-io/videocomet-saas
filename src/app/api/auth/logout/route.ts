import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { lucia, validateRequest } from "@/lib/auth";

export async function POST() {
  const { session } = await validateRequest();
  if (session) {
    await lucia.invalidateSession(session.id);
  }
  const blank = lucia.createBlankSessionCookie();
  (await cookies()).set(blank.name, blank.value, blank.attributes);
  return NextResponse.json({ ok: true });
}
