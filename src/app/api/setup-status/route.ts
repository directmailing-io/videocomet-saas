export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { requireUserApi } from "@/lib/auth-guard";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { getSetupStatus } from "@/lib/setup-status";

/**
 * GET /api/setup-status
 * Setup-Checkliste für Onboarding-Popup + Einstellungen-Setup-Tab.
 */
export async function GET() {
  const auth = await requireUserApi();
  if (!auth.ok) return auth.response;

  const status = await getSetupStatus(auth.user.id);
  return NextResponse.json(status);
}

/**
 * POST /api/setup-status
 * Body: { dismissForever: boolean } — Onboarding dauerhaft aus/wieder an.
 */
export async function POST(req: Request) {
  const auth = await requireUserApi();
  if (!auth.ok) return auth.response;

  const body = (await req.json().catch(() => ({}))) as {
    dismissForever?: boolean;
  };
  if (typeof body.dismissForever !== "boolean") {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  await db
    .update(users)
    .set({ onboardingDismissedAt: body.dismissForever ? new Date() : null })
    .where(eq(users.id, auth.user.id));

  return NextResponse.json({ ok: true });
}
