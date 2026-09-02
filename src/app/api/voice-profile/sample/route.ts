export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { requireUserApi } from "@/lib/auth-guard";
import { db } from "@/lib/db";
import { voiceProfiles } from "@/lib/db/schema";
import { uploadIntroFile } from "@/lib/bunny/intro-storage";
import { CONSENT_TEXT_VERSION } from "@/lib/intro";
import { voiceTrainingQueue } from "@/worker/intro-queue";
import { presentStorageUrl, presentStorageUrlOrNull } from "@/lib/bunny/private-storage";

const MAX_SAMPLE_BYTES = 25 * 1024 * 1024;

function clientIp(req: NextRequest): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    "unknown"
  );
}

function sampleExtension(file: File): string {
  const fromName = /\.([a-zA-Z0-9]{1,5})$/.exec(file.name ?? "")?.[1];
  if (fromName) return fromName.toLowerCase();
  if (file.type.startsWith("video/")) return "webm";
  return "wav";
}

/**
 * POST /api/voice-profile/sample — Stimm-Sample hochladen (multipart).
 *
 * Felder: `file` (audio/* oder video/*, max 25MB), `consentVoice=true`,
 * `consentAi=true`. Ohne beide Einwilligungen kein Upload (DSGVO). Upsert
 * des Profils auf status='processing' + Enqueue des Voice-Training-Jobs.
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
    return NextResponse.json({ error: "Datei fehlt." }, { status: 400 });
  }
  if (file.size === 0 || file.size > MAX_SAMPLE_BYTES) {
    return NextResponse.json(
      { error: "Datei ist leer oder größer als 25 MB." },
      { status: 400 },
    );
  }
  const mime = file.type || "";
  if (!mime.startsWith("audio/") && !mime.startsWith("video/")) {
    return NextResponse.json(
      { error: "Nur Audio- oder Video-Dateien sind erlaubt." },
      { status: 400 },
    );
  }

  const consentVoice = form.get("consentVoice") === "true";
  const consentAi = form.get("consentAi") === "true";
  if (!consentVoice || !consentAi) {
    return NextResponse.json(
      {
        error:
          "Beide Einwilligungen (Stimm-Klonen und KI-Generierung) sind erforderlich.",
      },
      { status: 400 },
    );
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  let upload: { url: string };
  try {
    upload = await uploadIntroFile({
      userId: auth.user.id,
      fileName: `sample-${Date.now()}.${sampleExtension(file)}`,
      buffer,
      contentType: mime,
    });
  } catch (err) {
    console.error("[api/voice-profile/sample] upload failed:", err);
    return NextResponse.json(
      { error: "Upload fehlgeschlagen. Bitte erneut versuchen." },
      { status: 502 },
    );
  }

  const now = new Date();
  const ip = clientIp(req);
  const [profile] = await db
    .insert(voiceProfiles)
    .values({
      userId: auth.user.id,
      status: "processing",
      sampleUrl: upload.url,
      consentVoiceAt: now,
      consentAiAt: now,
      consentTextVersion: CONSENT_TEXT_VERSION,
      consentIp: ip,
    })
    .onConflictDoUpdate({
      target: voiceProfiles.userId,
      set: {
        status: "processing",
        sampleUrl: upload.url,
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
    console.error("[api/voice-profile/sample] enqueue failed:", err);
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
