export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { requireUserApi } from "@/lib/auth-guard";
import { db } from "@/lib/db";
import { introCalibrations, voiceProfiles } from "@/lib/db/schema";
import { deleteVoiceModel } from "@/lib/fish-audio";
import { deleteIntroFileByUrl } from "@/lib/bunny/intro-storage";

/**
 * GET /api/voice-profile — Voice-Profil des Users + Kalibrierungen seiner
 * Webcam-Videos (neueste zuerst).
 */
export async function GET() {
  const auth = await requireUserApi();
  if (!auth.ok) return auth.response;

  const [profile] = await db
    .select()
    .from(voiceProfiles)
    .where(eq(voiceProfiles.userId, auth.user.id))
    .limit(1);

  const calibrations = await db
    .select()
    .from(introCalibrations)
    .where(eq(introCalibrations.userId, auth.user.id))
    .orderBy(desc(introCalibrations.createdAt));

  return NextResponse.json({
    profile: profile ?? null,
    calibrations,
  });
}

/**
 * DELETE /api/voice-profile — Widerruf: Fish-Model + Bunny-Dateien
 * (Sample, Raumtöne) best effort löschen, dann alle Rows entfernen.
 * `campaigns.intro_enabled` bleibt unangetastet — die Pipeline fällt ohne
 * ready-Profil automatisch auf das Original-Video zurück.
 */
export async function DELETE() {
  const auth = await requireUserApi();
  if (!auth.ok) return auth.response;

  const [profile] = await db
    .select()
    .from(voiceProfiles)
    .where(eq(voiceProfiles.userId, auth.user.id))
    .limit(1);

  const calibrations = await db
    .select()
    .from(introCalibrations)
    .where(eq(introCalibrations.userId, auth.user.id));

  if (profile?.fishModelId) {
    try {
      await deleteVoiceModel(profile.fishModelId);
    } catch (err) {
      console.warn(
        "[api/voice-profile] fish model delete failed (continuing):",
        (err as Error).message,
      );
    }
  }

  await deleteIntroFileByUrl(profile?.sampleUrl);
  for (const cal of calibrations) {
    await deleteIntroFileByUrl(cal.roomtoneUrl);
  }

  await db
    .delete(introCalibrations)
    .where(eq(introCalibrations.userId, auth.user.id));
  await db.delete(voiceProfiles).where(eq(voiceProfiles.userId, auth.user.id));

  return NextResponse.json({ ok: true });
}
