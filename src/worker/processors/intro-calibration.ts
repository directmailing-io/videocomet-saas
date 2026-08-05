/**
 * Intro-Kalibrierungs-Processor.
 *
 * Analysiert die Audiospur eines Webcam-Videos und bestimmt die Parameter,
 * mit denen die Render-Pipeline (Phase 2) den ersten Satz durch eine KI-
 * personalisierte Begrüßung ersetzt.
 *
 * Erwartete Aufnahme-Struktur (der Guided-Flow instruiert die Kunden):
 *   Begrüßungswort(e) ~1-2s → bewusste Pause >= 0.8s → erster Satz →
 *   natürliche Atempause → Rest des Videos.
 *
 * Ermittelt wird:
 *   - speech_start_ms   erster Nicht-Stille-Punkt
 *   - anchor_end_ms     Ende des ersten Satzes = Start der Atempause danach
 *                       (TTS muss genau hier ENDEN)
 *   - resume_ms         anchor_end + ~120ms, AUFgerundet auf 30fps-Frame —
 *                       hier setzt das Original-Audio wieder ein
 *   - lufs_ref          Integrated-LUFS des Referenzfensters
 *   - spectral_ref      Band → normalisiertes dB (TTS-EQ-Matching)
 *   - roomtone_url      0.8-1.0s Raumton aus der Mitte der bewussten Pause
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
  parseSilenceIntervals,
  parseIntegratedLufs,
  computeSpectralRef,
  type SilenceInterval,
} from "../lib/intro-audio";
import { createTempDir, cleanupTempDir } from "../lib/temp";
import { DEFAULT_TTS_TEMPLATE } from "@/lib/intro";
import type { IntroCalibrationJobData } from "../intro-queue";

const SAMPLE_RATE = 48000;
/**
 * Bewusste Pause nach der Begrüßung: mindestens 0.6s Stille. Bewusst
 * kürzer als „zähle bis 2" — ein natürlicher Atem-Beat nach dem „Hi!"
 * reicht dem Detektor, damit User keine unnötig-lange Pause machen müssen.
 */
const DELIBERATE_PAUSE_MIN_SEC = 0.6;
/**
 * Anrede muss mindestens so lang sein, bevor die bewusste Pause zählt.
 * Ohne diese Untergrenze picken kleine Initial-Stillen im Recorder (73ms
 * Silence bei Aufnahme-Start, ehe der User „Hi" sagt) als „Anrede-Ende"
 * → greeting_end_ms wäre für TTS unbrauchbar klein. „Hi" braucht mind.
 * ~300ms Silben-Dauer.
 */
const GREETING_MIN_SEC = 0.3;
/** Erster Satz muss mindestens so lang sein, bevor eine Atempause zählt. */
const SENTENCE_MIN_SEC = 1.5;
/**
 * Der erste Satz darf länger sein, wenn der User etwas mehr Kontext gibt
 * („Ich habe dir kurz ein Video aufgenommen, weil ich..." mit ~10-12s).
 * Nur der Legacy-Volltext-Modus schneidet bis anchor_end; im greeting-only-
 * Modus reicht das Anrede-Ende und ein längerer erster Satz stört nicht.
 */
const SENTENCE_MAX_SEC = 15;
/** Atempause nach dem Satz: erste Stille >= 80ms. */
const BREATH_GAP_MIN_SEC = 0.08;
/**
 * anchor_end (Satz-Ende) muss vor dieser Sekunde liegen. Erhöht von 20s
 * auf 30s — im greeting-only-Modus wird dieser Wert ohnehin nicht als
 * Cut-Punkt genutzt (dann greift greeting_end_ms).
 */
const ANCHOR_MAX_SEC = 30;
const RESUME_OFFSET_MS = 120;
const FPS = 30;

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

interface SilenceAnalysis {
  speechStartSec: number;
  pause: SilenceInterval;
  sentenceStartSec: number;
  anchorEndSec: number;
  /**
   * Ende der Anrede — genauer: Start der bewussten Pause nach „Hi!".
   * Für kurze TTS-Templates („Hi {vorname}") wird bis hier gecuttet,
   * NICHT bis zum Ende des ersten Satzes. Alter Modus (langer Satz-
   * Template) nutzt weiter `anchorEndSec`.
   */
  greetingEndSec: number;
}

/**
 * Leitet aus den Silence-Listen die Struktur ab. `coarse` (d>=0.25s) liefert
 * Sprachbeginn + bewusste Pause; `fine` (d>=0.08s) die Atempause nach dem
 * ersten Satz — silencedetect meldet nur Stillen oberhalb seiner
 * Mindestdauer, deshalb zwei Pässe.
 */
export function analyzeSilenceStructure(
  coarse: SilenceInterval[],
  fine: SilenceInterval[],
): SilenceAnalysis {
  // Sprachbeginn: endet die Datei-eröffnende Stille bei t, startet Sprache
  // dort; sonst bei 0.
  let speechStartSec = 0;
  const leading = coarse.find((s) => s.start <= 0.05);
  if (leading && Number.isFinite(leading.end)) {
    speechStartSec = leading.end;
  }

  // Bewusste Pause: erste Stille >= 0.8s, die NACH dem Sprachbeginn UND
  // mindestens `GREETING_MIN_SEC` in die Sprache hinein startet. Die
  // 300ms-Untergrenze filtert False-Positives durch Aufnahme-Start-
  // Artefakte (kurze Initial-Stille zwischen Recorder-Start und dem
  // ersten Wort des Users).
  const pause = coarse.find(
    (s) =>
      s.start >= speechStartSec + GREETING_MIN_SEC &&
      Number.isFinite(s.end) &&
      s.end - s.start >= DELIBERATE_PAUSE_MIN_SEC,
  );
  if (!pause) {
    throw new CalibrationError("no_pause_detected");
  }

  const sentenceStartSec = pause.end;

  // Satzende: erste Stille >= 80ms nach mindestens 1.5s Sprache.
  // WICHTIG: der greeting-only-Modus (kurzes „Hi {vorname}"-Template)
  // braucht den Satz-Ende-Punkt NICHT — er cuttet bis greeting_end_ms
  // (= pause.start). Also darf ein fehlender/später breath-gap NICHT
  // die ganze Kalibrierung failen lassen. Wir setzen einen best-guess
  // synthetic `anchorEndSec` und markieren die Kalibrierung als ready.
  // Legacy-Volltext-Templates würden mit dem synthetic Wert schlechtere
  // Ergebnisse liefern; der Engine-Fallback greift dann.
  const breath = fine.find(
    (s) =>
      s.start >= sentenceStartSec + SENTENCE_MIN_SEC &&
      (Number.isFinite(s.end) ? s.end - s.start : Infinity) >= BREATH_GAP_MIN_SEC,
  );
  let anchorEndSec: number;
  if (breath) {
    anchorEndSec = breath.start;
    const sentenceLen = anchorEndSec - sentenceStartSec;
    if (sentenceLen < SENTENCE_MIN_SEC) {
      // Zu kurzer Satz zwischen Pause und Atempause = wahrscheinlich noch
      // eine False-Positive-Silence, greeting-only-Modus wäre okay, aber
      // der Legacy-Modus wäre kaputt. Wir setzen synthetic anchor damit
      // die Kalibrierung ready wird.
      anchorEndSec = sentenceStartSec + SENTENCE_MIN_SEC;
    } else if (sentenceLen > SENTENCE_MAX_SEC || anchorEndSec >= ANCHOR_MAX_SEC) {
      // Satz zu lang für Legacy — für greeting-only reicht die Pause.
      // Wir cappen anchor auf ein synthetic Ende nach SENTENCE_MAX.
      anchorEndSec = Math.min(
        sentenceStartSec + SENTENCE_MAX_SEC,
        ANCHOR_MAX_SEC - 0.5,
      );
    }
  } else {
    // Kein breath-gap gefunden (User spricht lang durch): synthetic
    // anchor als sentenceStart + 5s. Für greeting-only irrelevant, für
    // Legacy fällt Engine ohnehin zurück.
    anchorEndSec = Math.min(
      sentenceStartSec + Math.min(SENTENCE_MAX_SEC, 5),
      ANCHOR_MAX_SEC - 0.5,
    );
  }

  return {
    speechStartSec,
    pause,
    sentenceStartSec,
    anchorEndSec,
    // Anrede endet mit dem Beginn der bewussten Pause.
    greetingEndSec: pause.start,
  };
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

    // 2. Silence-Analyse (zwei Pässe: grob für Struktur, fein für Atempause)
    const coarseStderr = await runFfmpegCaptureStderr([
      "-i", wavPath, "-af", "silencedetect=noise=-35dB:d=0.25", "-f", "null", "-",
    ]);
    const fineStderr = await runFfmpegCaptureStderr([
      "-i", wavPath, "-af", "silencedetect=noise=-35dB:d=0.08", "-f", "null", "-",
    ]);
    const structure = analyzeSilenceStructure(
      parseSilenceIntervals(coarseStderr),
      parseSilenceIntervals(fineStderr),
    );

    const speechStartMs = Math.round(structure.speechStartSec * 1000);
    const anchorEndMs = Math.round(structure.anchorEndSec * 1000);
    const resumeMs = roundUpToFrameMs(anchorEndMs + RESUME_OFFSET_MS);

    // 3. Transkript des ersten Satzes via Fish-ASR (best effort)
    const sentencePath = join(tmpDir, "sentence.wav");
    await runFfmpeg([
      "-y",
      "-ss", structure.sentenceStartSec.toFixed(3),
      "-t", (structure.anchorEndSec - structure.sentenceStartSec).toFixed(3),
      "-i", wavPath,
      sentencePath,
    ]);
    const asrResult = await asr({ audioPath: sentencePath });
    const transcriptSentence = asrResult?.text?.trim() || null;

    // 4. Loudness-Referenz über [sentence_start, min(+3.5s, anchor_end)]
    const refWindowLen = Math.min(
      3.5,
      structure.anchorEndSec - structure.sentenceStartSec,
    );
    const lufsStderr = await runFfmpegCaptureStderr([
      "-ss", structure.sentenceStartSec.toFixed(3),
      "-t", refWindowLen.toFixed(3),
      "-i", wavPath,
      "-af", "ebur128",
      "-f", "null", "-",
    ]);
    const lufsRef = parseIntegratedLufs(lufsStderr);

    // 5. Spektral-Referenz: gleiches Fenster als raw PCM → FFT-Bänder
    const pcm = await runFfmpegCaptureStdout([
      "-ss", structure.sentenceStartSec.toFixed(3),
      "-t", refWindowLen.toFixed(3),
      "-i", wavPath,
      "-f", "s16le", "-acodec", "pcm_s16le", "-ac", "1", "-ar", String(SAMPLE_RATE),
      "-",
    ]);
    const spectralRef = computeSpectralRef(pcm, SAMPLE_RATE);

    // 6. Raumton aus der Mitte der bewussten Pause (0.8-1.0s)
    const pauseDur = structure.pause.end - structure.pause.start;
    const roomtoneLen = Math.min(1.0, Math.max(DELIBERATE_PAUSE_MIN_SEC, pauseDur) );
    const roomtoneStart =
      structure.pause.start + Math.max(0, (pauseDur - roomtoneLen) / 2);
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
      speechStartMs,
      anchorEndMs,
      greetingEndMs: Math.round(structure.greetingEndSec * 1000),
      sentenceStartMs: Math.round(structure.sentenceStartSec * 1000),
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
