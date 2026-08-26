export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { requireUserApi } from "@/lib/auth-guard";
import { db } from "@/lib/db";
import { introCalibrations, mediaItems, voiceProfiles } from "@/lib/db/schema";
import { uploadIntroFile } from "@/lib/bunny/intro-storage";
import { CONSENT_TEXT_VERSION, DEFAULT_TTS_TEMPLATE } from "@/lib/intro";
import { introCalibrationQueue } from "@/worker/intro-queue";

const MAX_AUDIO_BYTES = 25 * 1024 * 1024;

function clientIp(req: NextRequest): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    "unknown"
  );
}

function audioExtension(file: File): string {
  const fromName = /\.([a-zA-Z0-9]{1,5})$/.exec(file.name ?? "")?.[1];
  if (fromName) return fromName.toLowerCase();
  if (file.type.includes("webm")) return "webm";
  if (file.type.includes("ogg")) return "ogg";
  if (file.type.includes("mp4")) return "m4a";
  return "wav";
}

/**
 * POST /api/voice-profile/extra-audio — Zusatz-Sprachprobe für ein
 * (zu kurzes) Kampagnen-Video hochladen (multipart).
 *
 * Felder: `file` (audio/*, max 25MB), `mediaItemId`, `consentVoice=true`,
 * `consentAi=true`. Die Probe wird an der Kalibrierung des Videos
 * verankert; der Kalibrierungs-Processor trainiert die per-Video-Stimme
 * dann aus Video-Ton + Zusatz-Audio kombiniert. Einwilligungen werden
 * (wie bei from-media) account-weit am voice_profiles-Eintrag gespeichert
 * — ohne beide Einwilligungen kein Upload (DSGVO, biometrische Daten).
 */
export async function POST(req: NextRequest) {
  const auth = await requireUserApi();
  if (!auth.ok) return auth.response;

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json(
      { error: "Ungültiger Multipart-Body." },
      { status: 400 },
    );
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Aufnahme fehlt." }, { status: 400 });
  }
  if (file.size === 0 || file.size > MAX_AUDIO_BYTES) {
    return NextResponse.json(
      { error: "Aufnahme ist leer oder größer als 25 MB." },
      { status: 400 },
    );
  }
  const mime = file.type || "";
  if (!mime.startsWith("audio/") && !mime.startsWith("video/")) {
    return NextResponse.json(
      { error: "Nur Audio-Aufnahmen sind erlaubt." },
      { status: 400 },
    );
  }

  if (form.get("consentVoice") !== "true" || form.get("consentAi") !== "true") {
    return NextResponse.json(
      {
        error:
          "Beide Einwilligungen (Stimm-Klonen und KI-Generierung) sind erforderlich.",
      },
      { status: 400 },
    );
  }

  const mediaItemId = String(form.get("mediaItemId") ?? "");
  const [item] = await db
    .select()
    .from(mediaItems)
    .where(
      and(eq(mediaItems.id, mediaItemId), eq(mediaItems.userId, auth.user.id)),
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
      { error: "Nur Videos können eine Zusatz-Sprachprobe bekommen." },
      { status: 400 },
    );
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  let upload: { url: string };
  try {
    upload = await uploadIntroFile({
      userId: auth.user.id,
      // Nonce gegen den Bunny-CDN-Cache bei Neu-Aufnahme.
      fileName: `extra-${mediaItemId}-${Date.now()}.${audioExtension(file)}`,
      buffer,
      contentType: mime,
    });
  } catch (err) {
    console.error("[api/voice-profile/extra-audio] upload failed:", err);
    return NextResponse.json(
      { error: "Upload fehlgeschlagen. Bitte erneut versuchen." },
      { status: 502 },
    );
  }

  // Einwilligungen account-weit verankern, ohne ein evtl. vorhandenes
  // Account-Stimmprofil (Fallback) zurückzusetzen.
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

  // Zusatz-Audio an der Kalibrierung des Videos verankern (Row anlegen,
  // falls noch keine existiert) und das Voice-Training neu anstoßen.
  const [calibration] = await db
    .insert(introCalibrations)
    .values({
      mediaItemId,
      userId: auth.user.id,
      status: "pending",
      ttsTemplate: DEFAULT_TTS_TEMPLATE,
      extraAudioUrl: upload.url,
    })
    .onConflictDoUpdate({
      target: introCalibrations.mediaItemId,
      set: {
        extraAudioUrl: upload.url,
        updatedAt: sql`now()`,
      },
    })
    .returning();

  try {
    await introCalibrationQueue().add(
      "intro-calibration",
      { calibrationId: calibration.id },
      { jobId: `intro-calibration-${calibration.id}-${Date.now()}` },
    );
  } catch (err) {
    console.error("[api/voice-profile/extra-audio] enqueue failed:", err);
    return NextResponse.json(
      { error: "Training konnte nicht gestartet werden." },
      { status: 502 },
    );
  }

  return NextResponse.json({ ok: true, extraAudioUrl: upload.url });
}
