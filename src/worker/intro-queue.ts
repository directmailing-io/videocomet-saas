/**
 * BullMQ queues für das Intro-Feature (personalisierte Video-Begrüßung).
 *
 * Drei getrennte Queues:
 *   - `voice-training`     — Fish-Audio-Voice-Clone aus dem User-Sample
 *   - `intro-calibration`  — Audio-Analyse eines Webcam-Videos (erster
 *                            Satz, Schnittpunkte, Loudness/Spektrum,
 *                            Raumton-Extraktion)
 *   - `intro-preview`      — Vorschau-Videos (bis 3 Leads) nach Preflight-
 *                            Abschluss, damit der User die KI-Begrüßung
 *                            VOR der Freigabe hören/sehen kann. Läuft
 *                            asynchron NACH der awaiting_approval-
 *                            Promotion (UI pollt `runs.intro_preview`).
 *
 * Alle Jobs laufen im selben Worker-Prozess wie die Render-Pipeline;
 * eigene Queues halten sie aus den langlaufenden Lead-Renders raus.
 * Reuses the shared Redis connection (see `./queue.ts`).
 */

import { Queue, Worker, type ConnectionOptions, type Processor } from "bullmq";
import { getRedisConnection } from "./queue";

export const VOICE_TRAINING_QUEUE_NAME = "voice-training";
export const INTRO_CALIBRATION_QUEUE_NAME = "intro-calibration";
export const INTRO_PREVIEW_QUEUE_NAME = "intro-preview";

export interface VoiceTrainingJobData {
  voiceProfileId: string;
}

export interface IntroCalibrationJobData {
  calibrationId: string;
}

export interface IntroPreviewJobData {
  runId: string;
  /** Zähler für Warte-Retries (Kalibrierung noch nicht ready). */
  waitAttempt?: number;
}

function getConnectionOpts(): ConnectionOptions {
  return getRedisConnection() as unknown as ConnectionOptions;
}

let _voiceTrainingQueue: Queue<VoiceTrainingJobData> | null = null;

export function voiceTrainingQueue(): Queue<VoiceTrainingJobData> {
  if (_voiceTrainingQueue) return _voiceTrainingQueue;
  _voiceTrainingQueue = new Queue<VoiceTrainingJobData>(
    VOICE_TRAINING_QUEUE_NAME,
    {
      connection: getConnectionOpts(),
      defaultJobOptions: {
        // 2 Attempts: ein transienter Retry (Bunny-Download, Fish-Hiccup);
        // dauerhafte Fehler landen als status='failed' am Profil.
        attempts: 2,
        backoff: { type: "exponential", delay: 5_000 },
        removeOnComplete: 50,
        removeOnFail: 200,
      },
    },
  );
  return _voiceTrainingQueue;
}

export function voiceTrainingWorker(
  processor: Processor<VoiceTrainingJobData>,
): Worker<VoiceTrainingJobData> {
  const concurrency = Number(process.env.VOICE_TRAINING_WORKER_CONCURRENCY ?? "1");
  return new Worker<VoiceTrainingJobData>(VOICE_TRAINING_QUEUE_NAME, processor, {
    connection: getConnectionOpts(),
    concurrency,
    maxStalledCount: 2,
    // Fish-Fast-Training + Sample-Download + ffmpeg-Gate: großzügig 5 min.
    lockDuration: 5 * 60 * 1000,
    lockRenewTime: 100 * 1000,
    removeOnComplete: { count: 50 },
    removeOnFail: { count: 200 },
  });
}

let _introCalibrationQueue: Queue<IntroCalibrationJobData> | null = null;

export function introCalibrationQueue(): Queue<IntroCalibrationJobData> {
  if (_introCalibrationQueue) return _introCalibrationQueue;
  _introCalibrationQueue = new Queue<IntroCalibrationJobData>(
    INTRO_CALIBRATION_QUEUE_NAME,
    {
      connection: getConnectionOpts(),
      defaultJobOptions: {
        attempts: 2,
        backoff: { type: "exponential", delay: 5_000 },
        removeOnComplete: 50,
        removeOnFail: 200,
      },
    },
  );
  return _introCalibrationQueue;
}

let _introPreviewQueue: Queue<IntroPreviewJobData> | null = null;

export function introPreviewQueue(): Queue<IntroPreviewJobData> {
  if (_introPreviewQueue) return _introPreviewQueue;
  _introPreviewQueue = new Queue<IntroPreviewJobData>(
    INTRO_PREVIEW_QUEUE_NAME,
    {
      connection: getConnectionOpts(),
      defaultJobOptions: {
        attempts: 2,
        backoff: { type: "exponential", delay: 5_000 },
        removeOnComplete: 50,
        removeOnFail: 200,
      },
    },
  );
  return _introPreviewQueue;
}

/**
 * Enqueue best-effort: Previews duerfen die awaiting_approval-Promotion
 * niemals blockieren. Dedup via jobId pro Run — Retries/Nachzügler brauchen
 * einen `jobIdSuffix`, weil BullMQ auch gegen completed Jobs dedupt.
 */
export async function enqueueIntroPreviewJob(
  runId: string,
  opts?: { delayMs?: number; jobIdSuffix?: string; waitAttempt?: number },
): Promise<void> {
  await introPreviewQueue().add(
    "intro-preview",
    { runId, waitAttempt: opts?.waitAttempt },
    {
      jobId: `intro-preview-${runId}${opts?.jobIdSuffix ?? ""}`,
      delay: opts?.delayMs,
    },
  );
}

export function introPreviewWorker(
  processor: Processor<IntroPreviewJobData>,
): Worker<IntroPreviewJobData> {
  const concurrency = Number(
    process.env.INTRO_PREVIEW_WORKER_CONCURRENCY ?? "1",
  );
  return new Worker<IntroPreviewJobData>(INTRO_PREVIEW_QUEUE_NAME, processor, {
    connection: getConnectionOpts(),
    concurrency,
    maxStalledCount: 2,
    // Bis zu 3 Engine-Durchlaeufe (TTS + lipsync-Polling bis 6 min):
    // grosszuegige 10 min Lock, Renewal weit davor.
    lockDuration: 10 * 60 * 1000,
    lockRenewTime: 60 * 1000,
    removeOnComplete: { count: 50 },
    removeOnFail: { count: 200 },
  });
}

export function introCalibrationWorker(
  processor: Processor<IntroCalibrationJobData>,
): Worker<IntroCalibrationJobData> {
  const concurrency = Number(
    process.env.INTRO_CALIBRATION_WORKER_CONCURRENCY ?? "2",
  );
  return new Worker<IntroCalibrationJobData>(
    INTRO_CALIBRATION_QUEUE_NAME,
    processor,
    {
      connection: getConnectionOpts(),
      concurrency,
      maxStalledCount: 2,
      // Download + mehrere ffmpeg-Pässe + ASR: 3 min sind großzügig.
      lockDuration: 3 * 60 * 1000,
      lockRenewTime: 60 * 1000,
      removeOnComplete: { count: 50 },
      removeOnFail: { count: 200 },
    },
  );
}
