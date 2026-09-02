export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { requireUserApi } from "@/lib/auth-guard";
import { db } from "@/lib/db";
import { mediaItems, voiceProfiles } from "@/lib/db/schema";
import { CONSENT_TEXT_VERSION } from "@/lib/intro";
import { voiceTrainingQueue } from "@/worker/intro-queue";
import { presentStorageUrl, presentStorageUrlOrNull } from "@/lib/bunny/private-storage";

const MIN_VIDEO_SECONDS = 30;

const bodySchema = z.object({
  mediaItemId: z.string().uuid(),
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
 * POST /api/voice-profile/from-media — KI-Stimme aus einem vorhandenen
 * Mediathek-Video erstellen (empfohlener Weg: gleiches Mikro, gleicher
 * Raum, gleiche Sprechweise wie im späteren Video).
 *
 * Der Voice-Training-Worker extrahiert die Tonspur selbst (ffmpeg -vn)
 * und trimmt aufs Fish-Limit — hier wird nur validiert, das Profil auf
 * status='processing' gesetzt und der Job enqueued. Ohne beide
 * Einwilligungen (DSGVO, biometrische Daten) kein Training.
 */
export async function POST(req: NextRequest) {
  const auth = await requireUserApi();
  if (!auth.ok) return auth.response;

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      {
        error:
          "Ungültige Anfrage. Beide Einwilligungen (Stimm-Klonen und KI-Generierung) sind erforderlich.",
      },
      { status: 400 },
    );
  }

  const [item] = await db
    .select()
    .from(mediaItems)
    .where(
      and(
        eq(mediaItems.id, parsed.data.mediaItemId),
        eq(mediaItems.userId, auth.user.id),
      ),
    )
    .limit(1);
  if (!item) {
    return NextResponse.json(
      { error: "Video nicht gefunden." },
      { status: 404 },
    );
  }
  if (item.type !== "webcam" && item.type !== "video") {
    return NextResponse.json(
      { error: "Nur Videos können als Stimmquelle verwendet werden." },
      { status: 400 },
    );
  }
  if (item.durationSec !== null && item.durationSec < MIN_VIDEO_SECONDS) {
    return NextResponse.json(
      {
        error:
          "Das Video ist zu kurz. Für das Stimm-Training brauchen wir mindestens 30 Sekunden Ton.",
      },
      { status: 400 },
    );
  }

  const now = new Date();
  const ip = clientIp(req);
  const [profile] = await db
    .insert(voiceProfiles)
    .values({
      userId: auth.user.id,
      status: "processing",
      sampleUrl: item.publicUrl,
      consentVoiceAt: now,
      consentAiAt: now,
      consentTextVersion: CONSENT_TEXT_VERSION,
      consentIp: ip,
    })
    .onConflictDoUpdate({
      target: voiceProfiles.userId,
      set: {
        status: "processing",
        sampleUrl: item.publicUrl,
        sampleDurationSec: null,
        consentVoiceAt: now,
        consentAiAt: now,
        consentTextVersion: CONSENT_TEXT_VERSION,
        consentIp: ip,
        error: null,
        updatedAt: sql`now()`,
      },
    })
    .returning();

  try {
    await voiceTrainingQueue().add(
      "voice-training",
      { voiceProfileId: profile.id },
      { jobId: `voice-training-${profile.id}-${Date.now()}` },
    );
  } catch (err) {
    console.error("[api/voice-profile/from-media] enqueue failed:", err);
    return NextResponse.json(
      { error: "Training konnte nicht gestartet werden." },
      { status: 502 },
    );
  }

  return NextResponse.json({
    ok: true,
    profile: { ...profile, sampleUrl: presentStorageUrlOrNull(profile.sampleUrl) },
  });
}
