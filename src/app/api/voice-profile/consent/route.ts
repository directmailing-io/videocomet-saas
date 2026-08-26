export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { requireUserApi } from "@/lib/auth-guard";
import { db } from "@/lib/db";
import { voiceProfiles } from "@/lib/db/schema";
import { CONSENT_TEXT_VERSION } from "@/lib/intro";

const bodySchema = z.object({
  consentVoice: z.literal(true),
  consentAi: z.literal(true),
});

function clientIp(req: NextRequest): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    "unknown"
  );
}

/**
 * POST /api/voice-profile/consent — Einwilligungen (Stimm-Klonen +
 * KI-Generierung) account-weit speichern, ohne ein Sample hochzuladen.
 *
 * Genutzt vom Wizard, wenn das Kampagnen-Video allein als Stimmquelle
 * reicht: Das per-Video-Training läuft dann in der Kalibrierung — es
 * braucht aber die am voice_profiles-Eintrag verankerte Einwilligung.
 */
export async function POST(req: NextRequest) {
  const auth = await requireUserApi();
  if (!auth.ok) return auth.response;

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      {
        error:
          "Beide Einwilligungen (Stimm-Klonen und KI-Generierung) sind erforderlich.",
      },
      { status: 400 },
    );
  }

  const now = new Date();
  const ip = clientIp(req);
  await db
    .insert(voiceProfiles)
    .values({
      userId: auth.user.id,
      status: "pending_sample",
      consentVoiceAt: now,
      consentAiAt: now,
      consentTextVersion: CONSENT_TEXT_VERSION,
      consentIp: ip,
    })
    .onConflictDoUpdate({
      target: voiceProfiles.userId,
      set: {
        consentVoiceAt: now,
        consentAiAt: now,
        consentTextVersion: CONSENT_TEXT_VERSION,
        consentIp: ip,
        updatedAt: sql`now()`,
      },
    });

  return NextResponse.json({ ok: true });
}
