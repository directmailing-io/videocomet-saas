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
import { createVoiceModel, deleteVoiceModel } from "@/lib/fish-audio";
import { probeVideoDuration } from "@/lib/ffprobe";
import { runFfmpeg } from "../lib/ffmpeg";
import { runFfmpegCaptureStderr, parseIntegratedLufs } from "../lib/intro-audio";
import { createTempDir, cleanupTempDir } from "../lib/temp";
import type { VoiceTrainingJobData } from "../intro-queue";

const MIN_SAMPLE_SECONDS = 30;
/** Fish-Limit 270s Gesamtmaterial — wir trimmen mit Puffer auf 260s. */
const TRIM_TO_SECONDS = 260;
const MAX_SAMPLE_SECONDS = 270;
const MIN_LUFS = -40;
const NORMALIZE_BELOW_LUFS = -25;
const TARGET_LUFS = -19;

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

    // 2. Quality-Gate
    const durationSec = await probeVideoDuration(wavPath);
    if (durationSec === null || durationSec < MIN_SAMPLE_SECONDS) {
      await setFailed(voiceProfileId, "too_short");
      return { status: "failed", error: "too_short" };
    }

    const lufsStderr = await runFfmpegCaptureStderr([
      "-i", wavPath, "-af", "ebur128", "-f", "null", "-",
    ]);
    const lufs = parseIntegratedLufs(lufsStderr);
    if (lufs === null || lufs <= MIN_LUFS) {
      await setFailed(voiceProfileId, "too_quiet");
      return { status: "failed", error: "too_quiet" };
    }

    let trainPath = wavPath;
    const filters: string[] = [];
    if (lufs < NORMALIZE_BELOW_LUFS) {
      const gainDb = Math.round((TARGET_LUFS - lufs) * 10) / 10;
      filters.push(`volume=${gainDb}dB`);
    }

    // 3. Trim aufs Fish-Limit
    const trimArgs: string[] =
      durationSec > MAX_SAMPLE_SECONDS ? ["-t", String(TRIM_TO_SECONDS)] : [];

    if (filters.length > 0 || trimArgs.length > 0) {
      const processedPath = join(tmpDir, "sample-train.wav");
      const args = ["-y", "-i", wavPath, ...trimArgs];
      if (filters.length > 0) args.push("-af", filters.join(","));
      args.push(processedPath);
      await runFfmpeg(args);
      trainPath = processedPath;
    }

    // 4. Fish-Model erstellen. Altes Model (Re-Training) best-effort löschen.
    if (profile.fishModelId) {
      await deleteVoiceModel(profile.fishModelId).catch((err) => {
        console.warn(
          `[voice-training] old model delete failed (continuing): ${(err as Error).message}`,
        );
      });
    }
    const model = await createVoiceModel({
      title: `videocomet-${profile.userId}`,
      audioFilePaths: [trainPath],
      totalDurationSec: Math.min(durationSec, TRIM_TO_SECONDS),
    });

    await db
      .update(voiceProfiles)
      .set({
        status: "ready",
        fishModelId: model._id,
        sampleDurationSec: Math.round(durationSec),
        error: null,
        updatedAt: new Date(),
      })
      .where(eq(voiceProfiles.id, voiceProfileId));

    return { status: "ready" };
  } catch (err) {
    const message = (err as Error).message?.slice(0, 500) ?? "unknown";
    await setFailed(voiceProfileId, message);
    return { status: "failed", error: message };
  } finally {
    await cleanupTempDir(tmpDir);
  }
}
