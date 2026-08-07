/**
 * Gemeinsames Fish-Audio-Voice-Clone-Training aus einer WAV-Datei.
 * Genutzt vom Account-Profil (processors/voice-training.ts) und vom
 * per-Video-Training im Kalibrierungs-Processor (intro-calibration.ts).
 *
 * Quality-Gate: >= 30s Material, Integrated-LUFS > -40; zwischen -40 und
 * -25 wird vor dem Training auf ~-19 LUFS angehoben. Material über dem
 * Fish-Limit (270s) wird auf 260s getrimmt.
 */

import { join } from "node:path";
import { createVoiceModel, deleteVoiceModel } from "@/lib/fish-audio";
import { probeVideoDuration } from "@/lib/ffprobe";
import { runFfmpeg } from "./ffmpeg";
import { runFfmpegCaptureStderr, parseIntegratedLufs } from "./intro-audio";

const MIN_SAMPLE_SECONDS = 30;
const TRIM_TO_SECONDS = 260;
const MAX_SAMPLE_SECONDS = 270;
const MIN_LUFS = -40;
const NORMALIZE_BELOW_LUFS = -25;
const TARGET_LUFS = -19;

/** Fachlicher Trainings-Fehler mit stabilem Code (too_short, too_quiet). */
export class VoiceTrainError extends Error {
  constructor(public code: string) {
    super(code);
  }
}

export interface TrainVoiceInput {
  /** Mono-WAV (Samplerate egal — Fish akzeptiert 44.1k und 48k). */
  wavPath: string;
  /** Temp-Verzeichnis für die aufbereitete Trainingsdatei. */
  tmpDir: string;
  /** Fish-Model-Titel (nur intern sichtbar). */
  title: string;
  /** Bei Re-Training: altes Model wird best-effort gelöscht. */
  previousModelId?: string | null;
}

export async function trainVoiceFromWav(
  input: TrainVoiceInput,
): Promise<{ modelId: string; durationSec: number }> {
  const durationSec = await probeVideoDuration(input.wavPath);
  if (durationSec === null || durationSec < MIN_SAMPLE_SECONDS) {
    throw new VoiceTrainError("too_short");
  }

  const lufsStderr = await runFfmpegCaptureStderr([
    "-i", input.wavPath, "-af", "ebur128", "-f", "null", "-",
  ]);
  const lufs = parseIntegratedLufs(lufsStderr);
  if (lufs === null || lufs <= MIN_LUFS) {
    throw new VoiceTrainError("too_quiet");
  }

  const filters: string[] = [];
  if (lufs < NORMALIZE_BELOW_LUFS) {
    const gainDb = Math.round((TARGET_LUFS - lufs) * 10) / 10;
    filters.push(`volume=${gainDb}dB`);
  }
  const trimArgs: string[] =
    durationSec > MAX_SAMPLE_SECONDS ? ["-t", String(TRIM_TO_SECONDS)] : [];

  let trainPath = input.wavPath;
  if (filters.length > 0 || trimArgs.length > 0) {
    const processedPath = join(input.tmpDir, "voice-train.wav");
    const args = ["-y", "-i", input.wavPath, ...trimArgs];
    if (filters.length > 0) args.push("-af", filters.join(","));
    args.push(processedPath);
    await runFfmpeg(args);
    trainPath = processedPath;
  }

  if (input.previousModelId) {
    await deleteVoiceModel(input.previousModelId).catch((err) => {
      console.warn(
        `[voice-clone] old model delete failed (continuing): ${(err as Error).message}`,
      );
    });
  }

  const model = await createVoiceModel({
    title: input.title,
    audioFilePaths: [trainPath],
    totalDurationSec: Math.min(durationSec, TRIM_TO_SECONDS),
  });
  return { modelId: model._id, durationSec };
}
