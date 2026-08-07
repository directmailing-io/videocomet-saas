/**
 * Voice-Training-Processor (Intro-Feature).
 *
 * Trainiert aus dem hochgeladenen Stimm-Sample des Users einen Fish-Audio-
 * Voice-Clone (train_mode=fast). Ablauf:
 *   1. Profil + sample_url laden, Sample nach tmp downloaden
 *   2. Quality-Gate via ffmpeg: Dauer >= 30s, Integrated-LUFS > -40
 *      (zwischen -40 und -25 wird vor dem Training auf ~-19 LUFS
 *      normalisiert)
 *   3. Material > 270s (Fish-Limit) wird auf 260s getrimmt
 *   4. createVoiceModel → fish_model_id, status='ready'
 *
 * Jeder Fehler landet als status='failed' + error-Code am Profil.
 */

import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { voiceProfiles } from "@/lib/db/schema";
import { runFfmpeg } from "../lib/ffmpeg";
import { trainVoiceFromWav, VoiceTrainError } from "../lib/voice-clone";
import { createTempDir, cleanupTempDir } from "../lib/temp";
import type { VoiceTrainingJobData } from "../intro-queue";

async function setFailed(voiceProfileId: string, error: string): Promise<void> {
  await db
    .update(voiceProfiles)
    .set({ status: "failed", error, updatedAt: new Date() })
    .where(eq(voiceProfiles.id, voiceProfileId));
}

export async function processVoiceTrainingJob(job: {
  data: VoiceTrainingJobData;
}): Promise<{ status: "ready" | "failed"; error?: string }> {
  const { voiceProfileId } = job.data;
  const [profile] = await db
    .select()
    .from(voiceProfiles)
    .where(eq(voiceProfiles.id, voiceProfileId))
    .limit(1);
  if (!profile) {
    return { status: "failed", error: "profile_not_found" };
  }
  if (!profile.sampleUrl) {
    await setFailed(voiceProfileId, "no_sample");
    return { status: "failed", error: "no_sample" };
  }

  const tmpDir = await createTempDir(`voice-${voiceProfileId.slice(0, 8)}`);
  try {
    // 1. Download
    const res = await fetch(profile.sampleUrl);
    if (!res.ok) {
      throw new Error(`sample download failed: HTTP ${res.status}`);
    }
    const rawPath = join(tmpDir, "sample-raw");
    await writeFile(rawPath, Buffer.from(await res.arrayBuffer()));

    // Auf mono 44.1k WAV bringen — normalisiert Container/Codec (User darf
    // auch ein Video hochladen; wir brauchen nur die Tonspur).
    const wavPath = join(tmpDir, "sample.wav");
    await runFfmpeg(["-y", "-i", rawPath, "-vn", "-ac", "1", "-ar", "44100", wavPath]);

    // 2.-4. Quality-Gate + Normalisierung + Fish-Training (voice-clone.ts)
    const trained = await trainVoiceFromWav({
      wavPath,
      tmpDir,
      title: `videocomet-${profile.userId}`,
      previousModelId: profile.fishModelId,
    });

    await db
      .update(voiceProfiles)
      .set({
        status: "ready",
        fishModelId: trained.modelId,
        sampleDurationSec: Math.round(trained.durationSec),
        error: null,
        updatedAt: new Date(),
      })
      .where(eq(voiceProfiles.id, voiceProfileId));

    return { status: "ready" };
  } catch (err) {
    const message =
      err instanceof VoiceTrainError
        ? err.code
        : ((err as Error).message?.slice(0, 500) ?? "unknown");
    await setFailed(voiceProfileId, message);
    return { status: "failed", error: message };
  } finally {
    await cleanupTempDir(tmpDir);
  }
}
