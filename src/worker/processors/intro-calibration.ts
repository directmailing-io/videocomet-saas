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
import { introCalibrations, mediaItems, voiceProfiles } from "@/lib/db/schema";
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
import {
  asrSegmentsToWords,
  analyzeIntroStructureFromAsr,
  sentenceTranscriptFromWords,
  transcriptHead,
  findQuietestWindowMs,
  type AsrWord,
} from "../lib/intro-structure-asr";
import { createTempDir, cleanupTempDir } from "../lib/temp";
import { trainVoiceFromWav, VoiceTrainError } from "../lib/voice-clone";
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
  constructor(
    public code: string,
    /** Was die ASR gehört hat — fürs UI („Gehört haben wir: ‚…‘"). */
    public transcript: string | null = null,
  ) {
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

    // 2. Struktur-Analyse — ASR-first mit Envelope-Fallback.
    //
    // Primär entscheiden Wort-Timestamps der Fish-ASR über die Struktur
    // (Anrede/Pause/Satz): Sie sind pegel-unabhängig und erkennen die
    // bewusste Pause auch dann, wenn Webcam-AGC/Atmen sie akustisch
    // „füllt" (Incident 2026-08-21). Die Hüllkurve bleibt für Roomtone
    // und Pegel-Referenzen zuständig und ist Fallback, wenn die ASR
    // nicht antwortet.
    const pcmHead = await runFfmpegCaptureStdout([
      "-i", wavPath,
      "-t", String(ANALYSIS_WINDOW_SEC),
      "-f", "s16le", "-acodec", "pcm_s16le", "-ac", "1", "-ar", String(SAMPLE_RATE),
      "-",
    ]);
    const envDb = computeEnvelopeDb(pcmHead, SAMPLE_RATE, HOP_MS);

    const headPath = join(tmpDir, "head.wav");
    await runFfmpeg([
      "-y", "-i", wavPath, "-t", String(ANALYSIS_WINDOW_SEC), headPath,
    ]);
    const headAsr = await asr({ audioPath: headPath });
    const words: AsrWord[] = headAsr ? asrSegmentsToWords(headAsr.segments) : [];

    let structure: IntroStructure;
    let structureSource: "asr" | "envelope";
    if (words.length > 0) {
      try {
        structure = analyzeIntroStructureFromAsr(words, envDb, HOP_MS);
        structureSource = "asr";
      } catch (asrErr) {
        if (!(asrErr instanceof IntroStructureError)) throw asrErr;
        // Envelope als zweite Chance — findet sie eine gültige Struktur,
        // gewinnt sie. Sonst ist der ASR-Fehlercode aussagekräftiger
        // (er kann zitieren, was gehört wurde).
        try {
          structure = analyzeIntroStructure(envDb, HOP_MS);
          structureSource = "envelope";
        } catch {
          throw new CalibrationError(asrErr.code, transcriptHead(words));
        }
      }
    } else {
      try {
        structure = analyzeIntroStructure(envDb, HOP_MS);
        structureSource = "envelope";
      } catch (err) {
        if (err instanceof IntroStructureError) {
          throw new CalibrationError(err.code);
        }
        throw err;
      }
    }
    console.log(
      `[intro-calibration] structure via ${structureSource}: greeting ${structure.speechStartMs}–${structure.greetingEndMs}ms, pause →${structure.sentenceStartMs}ms, anchor ${structure.anchorEndMs}ms`,
    );

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

    // 3. Transkript des ersten Satzes: im ASR-Pfad direkt aus den
    // Wort-Timestamps (kein zweiter ASR-Call); im Envelope-Fallback wie
    // bisher per ASR auf dem Satz-Fenster (best effort).
    let transcriptSentence: string | null = null;
    if (structureSource === "asr") {
      transcriptSentence = sentenceTranscriptFromWords(
        words,
        structure.sentenceStartMs,
        structure.anchorEndMs,
      );
    }
    if (!transcriptSentence) {
      const sentencePath = join(tmpDir, "sentence.wav");
      await runFfmpeg([
        "-y",
        "-ss", sentenceStartSec.toFixed(3),
        "-t", (anchorEndSec - sentenceStartSec).toFixed(3),
        "-i", wavPath,
        sentencePath,
      ]);
      const asrResult = await asr({ audioPath: sentencePath });
      transcriptSentence = asrResult?.text?.trim() || null;
    }

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

    // 6. Raumton: leisestes Teilfenster der bewussten Pause (die Mitte
    // kann Atmer/AGC-Rauschen enthalten — das leiseste Fenster nicht).
    const pauseDur = (structure.pause.endMs - structure.pause.startMs) / 1000;
    const roomtoneLen = Math.min(1.0, Math.max(ROOMTONE_MIN_SEC, pauseDur));
    const roomtoneStart =
      findQuietestWindowMs(
        envDb,
        HOP_MS,
        structure.pause.startMs,
        structure.pause.endMs,
        roomtoneLen * 1000,
      ) / 1000;
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
      // Nonce gegen den Bunny-CDN-Cache bei Re-Kalibrierung.
      fileName: `roomtone-${row.calibration.mediaItemId}-${Date.now()}.wav`,
      buffer: await readFile(roomtonePath),
      contentType: "audio/wav",
    });

    // 7. Voice-Clone PRO VIDEO: gleiche Tonquelle wie das Video, an das
    // die TTS später nahtlos anschließen muss (je Kampagne können andere
    // Sprecher/Mikros im Spiel sein). Consent bleibt Account-weit am
    // voice_profiles-Eintrag verankert; ohne Consent kein Training.
    // Fehler hier lassen die Kalibrierung trotzdem ready werden — die
    // Pipeline fällt dann auf die Account-Stimme zurück.
    let voicePatch: Partial<typeof introCalibrations.$inferInsert>;
    const [consentProfile] = await db
      .select({
        consentVoiceAt: voiceProfiles.consentVoiceAt,
        consentAiAt: voiceProfiles.consentAiAt,
      })
      .from(voiceProfiles)
      .where(eq(voiceProfiles.userId, row.calibration.userId))
      .limit(1);
    if (!consentProfile?.consentVoiceAt || !consentProfile.consentAiAt) {
      voicePatch = { voiceStatus: "failed", voiceError: "consent_missing" };
    } else {
      // Zusatz-Sprachprobe (kurze Videos <90s): an den Video-Ton anhängen,
      // damit Fish genug Material bekommt. Best effort — schlägt der
      // Download fehl, trainieren wir nur mit dem Video (Quality-Gate
      // in trainVoiceFromWav fängt zu kurzes Material ab).
      let trainWavPath = wavPath;
      if (row.calibration.extraAudioUrl) {
        try {
          const extraRes = await fetch(row.calibration.extraAudioUrl);
          if (!extraRes.ok) throw new Error(`HTTP ${extraRes.status}`);
          const extraSrcPath = join(tmpDir, "extra-src");
          await writeFile(
            extraSrcPath,
            Buffer.from(await extraRes.arrayBuffer()),
          );
          const combinedPath = join(tmpDir, "train-combined.wav");
          await runFfmpeg([
            "-y",
            "-i", wavPath,
            "-i", extraSrcPath,
            "-filter_complex",
            `[1:a]aresample=${SAMPLE_RATE},aformat=channel_layouts=mono[x];[0:a][x]concat=n=2:v=0:a=1`,
            combinedPath,
          ]);
          trainWavPath = combinedPath;
        } catch (err) {
          console.warn(
            `[intro-calibration] extra audio unusable (${(err as Error).message}) — training with video only`,
          );
        }
      }
      try {
        const trained = await trainVoiceFromWav({
          wavPath: trainWavPath,
          tmpDir,
          title: `videocomet-${row.calibration.userId}-${row.calibration.mediaItemId.slice(0, 8)}`,
          previousModelId: row.calibration.voiceFishModelId,
        });
        voicePatch = {
          voiceStatus: "ready",
          voiceFishModelId: trained.modelId,
          voiceError: null,
        };
      } catch (err) {
        const voiceCode =
          err instanceof VoiceTrainError
            ? err.code
            : ((err as Error).message?.slice(0, 300) ?? "unknown");
        voicePatch = { voiceStatus: "failed", voiceError: voiceCode };
        console.warn(
          `[intro-calibration] per-video voice training failed (${voiceCode}) — Account-Stimme bleibt Fallback`,
        );
      }
    }

    await setStatus(calibrationId, {
      status: "ready",
      ...voicePatch,
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
    // Transkript auch im Fehlerfall speichern — das UI kann dann zitieren,
    // was gehört wurde („Dein Video beginnt mit ‚…‘").
    const transcript =
      err instanceof CalibrationError ? err.transcript : null;
    await setStatus(calibrationId, {
      status: "failed",
      error: code,
      transcriptSentence: transcript,
    });
    return { status: "failed", error: code };
  } finally {
    await cleanupTempDir(tmpDir);
  }
}
