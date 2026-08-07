/**
 * Intro-Kalibrierungs-Processor.
 *
 * Analysiert die Audiospur eines Webcam-Videos und bestimmt die Parameter,
 * mit denen die Render-Pipeline (Phase 2) den ersten Satz durch eine KI-
 * personalisierte Begrüßung ersetzt.
 *
 * Erwartete Aufnahme-Struktur (der Guided-Flow instruiert die Kunden):
 *   Begrüßungswort(e) ~1-2s → bewusste Pause → erster Satz →
 *   natürliche Atempause → Rest des Videos.
 *
 * Die Struktur-Erkennung läuft über eine RMS-Hüllkurve mit ADAPTIVER
 * Schwelle (intro-structure.ts) statt silencedetect mit absoluter -35dB-
 * Schwelle: Webcam-AGC-Rauschteppiche liegen je nach Gerät zwischen -45
 * und -30 dB — die absolute Schwelle hat beim Incident 2026-08-07 eine
 * Rauschzone als „Anrede" kalibriert und das echte „Hi!" überlebte den
 * Cut (doppelte Begrüßung im fertigen Video).
 *
 * Ermittelt wird:
 *   - speech_start_ms   Beginn der echten Sprache (adaptive Schwelle)
 *   - greeting_end_ms   Ende der Anrede = Beginn der Trenn-Pause
 *   - sentence_start_ms Beginn des ersten Satzes
 *   - anchor_end_ms     Ende des ersten Satzes = Start der Atempause danach
 *   - resume_ms         anchor_end + ~120ms, AUFgerundet auf 30fps-Frame —
 *                       hier setzt das Original-Video wieder ein
 *   - lufs_ref          Integrated-LUFS des Referenzfensters
 *   - spectral_ref      Band → normalisiertes dB (TTS-EQ-Matching)
 *   - roomtone_url      Raumton aus der Mitte der bewussten Pause
 *   - transcript_sentence  via Fish-ASR (best effort, sonst NULL)
 */

import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { introCalibrations, mediaItems } from "@/lib/db/schema";
import { asr } from "@/lib/fish-audio";
import { uploadIntroFile } from "@/lib/bunny/intro-storage";
import { runFfmpeg } from "../lib/ffmpeg";
import {
  runFfmpegCaptureStderr,
  runFfmpegCaptureStdout,
  parseIntegratedLufs,
  computeSpectralRef,
} from "../lib/intro-audio";
import {
  computeEnvelopeDb,
  analyzeIntroStructure,
  IntroStructureError,
  type IntroStructure,
} from "../lib/intro-structure";
import { createTempDir, cleanupTempDir } from "../lib/temp";
import { DEFAULT_TTS_TEMPLATE } from "@/lib/intro";
import type { IntroCalibrationJobData } from "../intro-queue";

const SAMPLE_RATE = 48000;
/** Hüllkurven-Schrittweite für die Struktur-Analyse. */
const HOP_MS = 10;
/**
 * Nur die ersten ~40s werden analysiert — die Intro-Struktur liegt per
 * Definition am Anfang, und der PCM-Buffer bleibt klein (48k * 2B * 40s
 * ≈ 3,8 MB).
 */
const ANALYSIS_WINDOW_SEC = 40;
const RESUME_OFFSET_MS = 120;
const FPS = 30;
/** Mindestlänge des Roomtone-Schnipsels (Sekunden). */
const ROOMTONE_MIN_SEC = 0.15;

class CalibrationError extends Error {
  constructor(public code: string) {
    super(code);
  }
}

async function setStatus(
  calibrationId: string,
  patch: Partial<typeof introCalibrations.$inferInsert>,
): Promise<void> {
  await db
    .update(introCalibrations)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(introCalibrations.id, calibrationId));
}

/** Rundet auf die nächste 30fps-Frame-Grenze AUF (n/30 s in ms). */
export function roundUpToFrameMs(ms: number): number {
  const frameMs = 1000 / FPS;
  return Math.round(Math.ceil(ms / frameMs) * frameMs);
}

export async function processIntroCalibrationJob(job: {
  data: IntroCalibrationJobData;
}): Promise<{ status: "ready" | "failed"; error?: string }> {
  const { calibrationId } = job.data;

  const [row] = await db
    .select({
      calibration: introCalibrations,
      media: mediaItems,
    })
    .from(introCalibrations)
    .innerJoin(mediaItems, eq(mediaItems.id, introCalibrations.mediaItemId))
    .where(eq(introCalibrations.id, calibrationId))
    .limit(1);
  if (!row) {
    return { status: "failed", error: "calibration_not_found" };
  }

  await setStatus(calibrationId, { status: "running", error: null });

  const tmpDir = await createTempDir(`intro-cal-${calibrationId.slice(0, 8)}`);
  try {
    // Download des Webcam-Videos
    const res = await fetch(row.media.publicUrl);
    if (!res.ok) {
      throw new Error(`media download failed: HTTP ${res.status}`);
    }
    const videoPath = join(tmpDir, "source");
    await writeFile(videoPath, Buffer.from(await res.arrayBuffer()));

    // 1. Mono 48k WAV extrahieren
    const wavPath = join(tmpDir, "audio.wav");
    await runFfmpeg([
      "-y", "-i", videoPath, "-vn", "-ac", "1", "-ar", String(SAMPLE_RATE), wavPath,
    ]);

    // 2. Struktur-Analyse: Hüllkurve der ersten ~40s, adaptive Schwelle
    const pcmHead = await runFfmpegCaptureStdout([
      "-i", wavPath,
      "-t", String(ANALYSIS_WINDOW_SEC),
      "-f", "s16le", "-acodec", "pcm_s16le", "-ac", "1", "-ar", String(SAMPLE_RATE),
      "-",
    ]);
    const envDb = computeEnvelopeDb(pcmHead, SAMPLE_RATE, HOP_MS);
    let structure: IntroStructure;
    try {
      structure = analyzeIntroStructure(envDb, HOP_MS);
    } catch (err) {
      if (err instanceof IntroStructureError) {
        throw new CalibrationError(err.code);
      }
      throw err;
    }

    const sentenceStartSec = structure.sentenceStartMs / 1000;
    const anchorEndSec = structure.anchorEndMs / 1000;
    // Resume-Punkt muss IN der Atempause liegen: anchor+120ms, aber bei
    // knapper Pause auf (Pausen-Ende − 60ms) geclampt — sonst landet der
    // Wiedereinstieg im nächsten Wort (hörbarer Cut mitten im Wort).
    let resumeTargetMs = structure.anchorEndMs + RESUME_OFFSET_MS;
    if (structure.breathGapEndMs !== null) {
      resumeTargetMs = Math.min(
        resumeTargetMs,
        Math.max(structure.anchorEndMs + 40, structure.breathGapEndMs - 60),
      );
    }
    const resumeMs = roundUpToFrameMs(resumeTargetMs);

    // 3. Transkript des ersten Satzes via Fish-ASR (best effort)
    const sentencePath = join(tmpDir, "sentence.wav");
    await runFfmpeg([
      "-y",
      "-ss", sentenceStartSec.toFixed(3),
      "-t", (anchorEndSec - sentenceStartSec).toFixed(3),
      "-i", wavPath,
      sentencePath,
    ]);
    const asrResult = await asr({ audioPath: sentencePath });
    const transcriptSentence = asrResult?.text?.trim() || null;

    // 4. Loudness-Referenz über [sentence_start, min(+3.5s, anchor_end)]
    const refWindowLen = Math.min(3.5, anchorEndSec - sentenceStartSec);
    const lufsStderr = await runFfmpegCaptureStderr([
      "-ss", sentenceStartSec.toFixed(3),
      "-t", refWindowLen.toFixed(3),
      "-i", wavPath,
      "-af", "ebur128",
      "-f", "null", "-",
    ]);
    const lufsRef = parseIntegratedLufs(lufsStderr);

    // 5. Spektral-Referenz: gleiches Fenster als raw PCM → FFT-Bänder
    const pcm = await runFfmpegCaptureStdout([
      "-ss", sentenceStartSec.toFixed(3),
      "-t", refWindowLen.toFixed(3),
      "-i", wavPath,
      "-f", "s16le", "-acodec", "pcm_s16le", "-ac", "1", "-ar", String(SAMPLE_RATE),
      "-",
    ]);
    const spectralRef = computeSpectralRef(pcm, SAMPLE_RATE);

    // 6. Raumton aus der Mitte der bewussten Pause
    const pauseStartSec = structure.pause.startMs / 1000;
    const pauseDur = (structure.pause.endMs - structure.pause.startMs) / 1000;
    const roomtoneLen = Math.min(1.0, Math.max(ROOMTONE_MIN_SEC, pauseDur));
    const roomtoneStart = pauseStartSec + Math.max(0, (pauseDur - roomtoneLen) / 2);
    const roomtonePath = join(tmpDir, "roomtone.wav");
    await runFfmpeg([
      "-y",
      "-ss", roomtoneStart.toFixed(3),
      "-t", Math.min(roomtoneLen, pauseDur).toFixed(3),
      "-i", wavPath,
      roomtonePath,
    ]);
    const roomtoneUpload = await uploadIntroFile({
      userId: row.calibration.userId,
      fileName: `roomtone-${row.calibration.mediaItemId}.wav`,
      buffer: await readFile(roomtonePath),
      contentType: "audio/wav",
    });

    await setStatus(calibrationId, {
      status: "ready",
      transcriptSentence,
      ttsTemplate: row.calibration.ttsTemplate ?? DEFAULT_TTS_TEMPLATE,
      speechStartMs: structure.speechStartMs,
      anchorEndMs: structure.anchorEndMs,
      greetingEndMs: structure.greetingEndMs,
      sentenceStartMs: structure.sentenceStartMs,
      resumeMs,
      lufsRef,
      spectralRef,
      roomtoneUrl: roomtoneUpload.url,
      error: null,
    });
    return { status: "ready" };
  } catch (err) {
    const code =
      err instanceof CalibrationError
        ? err.code
        : ((err as Error).message?.slice(0, 500) ?? "unknown");
    await setStatus(calibrationId, { status: "failed", error: code });
    return { status: "failed", error: code };
  } finally {
    await cleanupTempDir(tmpDir);
  }
}
