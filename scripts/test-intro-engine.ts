/**
 * End-to-End-Test der Intro-Engine gegen das echte PoC-Material.
 *
 * KOSTET GELD (Fish-TTS + sync.so-Lipsync, wenige Cent) — nur manuell
 * ausführen: npx tsx scripts/test-intro-engine.ts
 *
 * Verwendet:
 *   - intro-poc/daniel-base.mp4           als Webcam-Video
 *   - intro-poc/ref-first-sentence.wav    → spectral_ref (live berechnet)
 *   - intro-poc/roomtone.wav              als lokaler Raumton-Override
 *   - Fake-Kalibrierung mit den validierten PoC-Werten
 *
 * Ergebnis wird nach ~/Desktop/videocomet-engine-test-sabine.mp4 kopiert.
 */

import { config } from "dotenv";
config({ path: ".env.local" });
config();

// ffmpeg/ffprobe: .env.local setzt keine Pfade; die Worker-Defaults zeigen
// auf /usr/bin (Linux-Container). Auf macOS liegt beides unter homebrew.
process.env.FFMPEG_PATH ??= "/opt/homebrew/bin/ffmpeg";
process.env.FFPROBE_PATH ??= "/opt/homebrew/bin/ffprobe";

import { copyFile, mkdtemp, readdir, stat } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";

const FISH_MODEL_ID = "3de66597aca44a008d80db10986d3873";
const FIRST_NAME = "Sabine";
const POC_DIR = resolve(__dirname, "..", "intro-poc");

async function main(): Promise<void> {
  // Dynamische Imports NACH dem Env-Setup (Module lesen env teils beim Load).
  const { generatePersonalizedWebcam } = await import(
    "../src/worker/lib/intro-engine"
  );
  const {
    runFfmpegCaptureStdout,
    runFfmpegCaptureStderr,
    computeSpectralRef,
    parseIntegratedLufs,
  } = await import("../src/worker/lib/intro-audio");
  const { probeVideoDuration } = await import("../src/lib/ffprobe");

  // spectral_ref live aus dem Referenz-Satz berechnen (wie die Kalibrierung).
  const refWav = join(POC_DIR, "ref-first-sentence.wav");
  const pcm = await runFfmpegCaptureStdout([
    "-i", refWav,
    "-f", "s16le", "-acodec", "pcm_s16le", "-ac", "1", "-ar", "48000",
    "-",
  ]);
  const spectralRef = computeSpectralRef(pcm, 48000);
  console.log("spectral_ref (aus ref-first-sentence.wav):");
  console.log(JSON.stringify(spectralRef, null, 2));

  const calibration = {
    ttsTemplate: null, // Engine fällt auf DEFAULT_TTS_TEMPLATE zurück
    speechStartMs: 2150,
    anchorEndMs: 8240,
    resumeMs: 8367,
    lufsRef: -19.0,
    spectralRef,
    roomtoneUrl: null, // lokaler Override unten
  };

  const workDir = await mkdtemp(join(tmpdir(), "intro-engine-test-"));
  console.log(`workDir: ${workDir}`);

  const webcamLocalPath = join(POC_DIR, "daniel-base.mp4");
  const webcamDur = await probeVideoDuration(webcamLocalPath);
  console.log(`webcam duration: ${webcamDur?.toFixed(3)}s`);

  const t0 = Date.now();
  const result = await generatePersonalizedWebcam({
    userId: "engine-test",
    tag: "sabine",
    firstName: FIRST_NAME,
    calibration,
    fishModelId: FISH_MODEL_ID,
    webcamLocalPath,
    workDir,
    roomtoneLocalPath: join(POC_DIR, "roomtone.wav"),
  });
  const elapsedSec = ((Date.now() - t0) / 1000).toFixed(1);

  if (!result.ok) {
    console.error(`ENGINE FALLBACK nach ${elapsedSec}s: ${result.reason}`);
    console.error(`Zwischendateien liegen in: ${workDir}`);
    process.exitCode = 1;
    return;
  }

  console.log(`ENGINE OK nach ${elapsedSec}s → ${result.outputPath}`);

  // ── QA-Messungen ──────────────────────────────────────────────────────
  const outDur = await probeVideoDuration(result.outputPath);
  const ttsDur = await probeVideoDuration(join(workDir, "tts-raw-sabine.wav"));
  const outSize = (await stat(result.outputPath)).size;

  const anchorEndMs = calibration.anchorEndMs;
  const ttsDurMs = (ttsDur ?? 0) * 1000;
  const frameMs = 1000 / 30;
  const startTrimMs =
    Math.floor(Math.max(0, anchorEndMs - ttsDurMs - 1200) / frameMs) * frameMs;
  const ttsAtMs = anchorEndMs - ttsDurMs - startTrimMs;
  const expectedDur = (webcamDur ?? 0) - startTrimMs / 1000;

  // LUFS im Begrüßungs-Fenster des Endergebnisses
  const windowStderr = await runFfmpegCaptureStderr([
    "-ss", (ttsAtMs / 1000).toFixed(3),
    "-t", (ttsDur ?? 0).toFixed(3),
    "-i", result.outputPath,
    "-af", "ebur128",
    "-f", "null", "-",
  ]);
  const windowLufs = parseIntegratedLufs(windowStderr);

  // Gesamter Output-LUFS zur Einordnung
  const fullStderr = await runFfmpegCaptureStderr([
    "-i", result.outputPath, "-af", "ebur128", "-f", "null", "-",
  ]);
  const fullLufs = parseIntegratedLufs(fullStderr);

  console.log("── QA ────────────────────────────────────────────");
  console.log(`tts duration:        ${ttsDur?.toFixed(3)}s`);
  console.log(`startTrim:           ${(startTrimMs / 1000).toFixed(3)}s`);
  console.log(`ttsAt:               ${(ttsAtMs / 1000).toFixed(3)}s`);
  console.log(`webcam duration:     ${webcamDur?.toFixed(3)}s`);
  console.log(`expected out dur:    ${expectedDur.toFixed(3)}s`);
  console.log(`actual out dur:      ${outDur?.toFixed(3)}s  (Δ ${(Math.abs((outDur ?? 0) - expectedDur)).toFixed(3)}s)`);
  console.log(`lufs_ref:            ${calibration.lufsRef.toFixed(1)} LUFS`);
  console.log(`window LUFS:         ${windowLufs?.toFixed(1)} LUFS  (Δ ${windowLufs !== null ? Math.abs(windowLufs - calibration.lufsRef).toFixed(1) : "?"} LU)`);
  console.log(`full-output LUFS:    ${fullLufs?.toFixed(1)} LUFS`);
  console.log(`file size:           ${(outSize / 1024 / 1024).toFixed(2)} MB`);

  const dest = join(homedir(), "Desktop", "videocomet-engine-test-sabine.mp4");
  await copyFile(result.outputPath, dest);
  console.log(`kopiert nach: ${dest}`);
  console.log(`Zwischendateien (nicht gelöscht): ${workDir}`);
  console.log((await readdir(workDir)).join("\n"));
}

main().catch((err) => {
  console.error("test-intro-engine failed:", err);
  process.exitCode = 1;
});
