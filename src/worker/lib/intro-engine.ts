/**
 * Intro-Engine: erzeugt pro Lead ein personalisiertes Webcam-Video, in dem
 * der erste Satz des Original-Videos durch eine KI-Begrüßung in der
 * geklonten Stimme des Kunden ersetzt ist (Fish Audio TTS `s2.1-pro` +
 * sync.so `lipsync-2`), schnittfrei zusammengesetzt.
 *
 * Rezept = validierter PoC (intro-poc/, 2026-08-03). Schritte:
 *   1. TTS ("Hallo {vorname}! …") → Länge muss vor anchor_end enden
 *   2. Auto-EQ (9-Band-FFT-Match gegen spectral_ref) + LUFS-Angleich
 *   3. Timing: startTrim/ttsAt/segEnd frame-aligned (30fps)
 *   4. Raumton-Bett loopen + TTS via adelay einmischen
 *   5. Video-Segment [startTrim, resume] schneiden (re-encode, CRF18)
 *   6. Segment + Audio zu Bunny (sync.so braucht öffentliche URLs)
 *   7. sync.so Lip-Sync (Poll bis 6 min)
 *   8. Cut-freie Assembly: concat-Filter in EINEM Encode (Video+Audio)
 *   9. QA-Gates (Dauer, LUFS-Fenster, Dateigröße)
 *
 * Qualitäts-/Transient-Fehler werden NIE geworfen — Rückgabe
 * `{ok:false, reason}` und die Pipeline spielt das Original aus
 * (`intro_status='fallback_error'`). Geworfen wird nur bei
 * Programmierfehlern (fehlende Pflicht-Optionen).
 */

import { readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tts } from "@/lib/fish-audio";
import { createGeneration, getGeneration } from "@/lib/syncso";
import {
  uploadIntroFile,
  deleteIntroFileByUrl,
} from "@/lib/bunny/intro-storage";
import { DEFAULT_TTS_TEMPLATE, parseGreetingTemplate } from "@/lib/intro";
import { probeVideoDuration } from "@/lib/ffprobe";
import { runFfmpeg } from "./ffmpeg";
import {
  runFfmpegCaptureStderr,
  runFfmpegCaptureStdout,
  parseIntegratedLufs,
  computeSpectralRef,
  SPECTRAL_BAND_CENTERS_HZ,
} from "./intro-audio";

const SAMPLE_RATE = 48000;
const FPS = 30;
const FRAME_MS = 1000 / FPS;
/** Vorlauf vor der TTS-Begrüßung (Original-Video ohne Sprache). */
const LEAD_IN_MS = 1200;
/** TTS muss mindestens so viel Luft vor anchor_end lassen. */
const TTS_HEADROOM_MS = 300;
/** sync.so Poll-Intervall / Gesamt-Timeout. */
const SYNCSO_POLL_INTERVAL_MS = 10_000;
const SYNCSO_TIMEOUT_MS = 6 * 60 * 1000;

/**
 * Struktureller Kalibrierungs-Ausschnitt — kompatibel mit der DB-Row
 * (`IntroCalibration`), aber auch mit Fake-Objekten im Test-Script.
 */
export interface IntroEngineCalibration {
  ttsTemplate: string | null;
  speechStartMs: number | null;
  anchorEndMs: number | null;
  /**
   * Ende der Anrede (Start der bewussten Pause). Für kurze Templates
   * wird bis hier gecuttet — beim Fehlen (Altbestand) fällt die Engine
   * auf `anchorEndMs` zurück.
   */
  greetingEndMs: number | null;
  /**
   * Start des ersten Satzes (Ende der bewussten Pause). Engine trimmt
   * im greeting-only-Modus die Rest-Pause auf ~300ms, damit die
   * Übergangs-Atempause im Preview nicht als Loch wirkt.
   */
  sentenceStartMs: number | null;
  resumeMs: number | null;
  lufsRef: number | null;
  spectralRef: Record<string, number> | null;
  roomtoneUrl: string | null;
}

export interface GeneratePersonalizedWebcamOpts {
  userId: string;
  /** Eindeutiger Tag für Dateinamen (Lead-ID oder Test-Tag). */
  tag: string;
  /**
   * Fertig geprüfte Substitutionen für die Template-Platzhalter. Enthält
   * `vorname` (für Templates mit `{vorname}`) ODER `anrede`+`nachname`
   * (für die formale Variante) — die Kette entscheidet ausschließlich
   * anhand des Templates, welche Keys gebraucht werden. Alle Werte sind
   * bereits normalisiert (siehe intro-name-check).
   */
  substitutions: Record<string, string>;
  calibration: IntroEngineCalibration;
  fishModelId: string;
  /** Lokaler Pfad zum Original-Webcam-Video. */
  webcamLocalPath: string;
  /** Arbeitsverzeichnis (existiert; Caller räumt auf). */
  workDir: string;
  /**
   * Lokaler Raumton-Override (Test-Script) — wenn gesetzt, wird
   * `calibration.roomtoneUrl` nicht heruntergeladen.
   */
  roomtoneLocalPath?: string;
  /** Preview-Modus: Endergebnis nach der Assembly auf N Sekunden kürzen. */
  trimToSec?: number;
}

export type GeneratePersonalizedWebcamResult =
  | {
      ok: true;
      outputPath: string;
      /**
       * Um wieviel ms der Anfang des Original-Videos getrimmt wurde. Das
       * Output-Video ist um genau diesen Betrag kürzer — alle Sprech-
       * Zeitpunkte nach dem Resume liegen entsprechend früher. Der
       * Presentation-Renderer kompensiert das über die Segment-Dauern.
       */
      startTrimMs: number;
    }
  | { ok: false; reason: string };

const clamp = (v: number, lo: number, hi: number): number =>
  Math.min(hi, Math.max(lo, v));

/** Fail-Ergebnis mit Log — zentrale Stelle für alle Quality-Fallbacks. */
function fail(tag: string, reason: string): { ok: false; reason: string } {
  console.warn(`[intro-engine:${tag}] fallback: ${reason}`);
  return { ok: false, reason };
}

/** Misst Integrated-LUFS einer Audio-Datei (ganze Datei). */
async function measureLufs(path: string): Promise<number | null> {
  const stderr = await runFfmpegCaptureStderr([
    "-i", path, "-af", "ebur128", "-f", "null", "-",
  ]);
  return parseIntegratedLufs(stderr);
}

/** 9-Band-Spektrum (dB, lautestes Band = 0) — gleiches Verfahren wie Kalibrierung. */
async function measureSpectrum(path: string): Promise<Record<string, number>> {
  const pcm = await runFfmpegCaptureStdout([
    "-i", path,
    "-f", "s16le", "-acodec", "pcm_s16le", "-ac", "1", "-ar", String(SAMPLE_RATE),
    "-",
  ]);
  return computeSpectralRef(pcm, SAMPLE_RATE);
}

/**
 * Baut die Auto-EQ-Filterkette aus (spectral_ref − tts_spectrum) pro Band.
 *   - 80 Hz wird übersprungen (Rumpel-Risiko beim Anheben)
 *   - 160…10000 Hz → parametrischer equalizer (q=1), Gain ±12 dB
 *   - 16000 Hz → highshelf bei 11 kHz, Gain ±8 dB
 */
export function buildEqFilterChain(
  ref: Record<string, number>,
  measured: Record<string, number>,
): string {
  const parts: string[] = [];
  for (const band of SPECTRAL_BAND_CENTERS_HZ) {
    if (band === 80) continue;
    const refDb = ref[String(band)];
    const ttsDb = measured[String(band)];
    if (typeof refDb !== "number" || typeof ttsDb !== "number") continue;
    const gain = clamp(refDb - ttsDb, -12, 12);
    if (band === 16000) {
      const shelfGain = clamp(gain, -8, 8);
      parts.push(`highshelf=f=11000:g=${shelfGain.toFixed(1)}`);
    } else {
      parts.push(`equalizer=f=${band}:t=q:w=1:g=${gain.toFixed(1)}`);
    }
  }
  return parts.join(",");
}

async function downloadTo(url: string, outPath: string): Promise<void> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`download failed: HTTP ${res.status} ${url.slice(0, 120)}`);
  }
  await writeFile(outPath, Buffer.from(await res.arrayBuffer()));
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Erzeugt das personalisierte Webcam-Video. Siehe Modul-Kommentar.
 * Output: `{workDir}/intro-out-{tag}.mp4` (bzw. getrimmte Preview-Variante).
 */
export async function generatePersonalizedWebcam(
  opts: GeneratePersonalizedWebcamOpts,
): Promise<GeneratePersonalizedWebcamResult> {
  // Programmierfehler → throw (nicht {ok:false}).
  if (!opts.userId || !opts.tag || !opts.webcamLocalPath || !opts.workDir) {
    throw new Error("[intro-engine] missing required opts");
  }
  if (Object.keys(opts.substitutions).length === 0) {
    throw new Error("[intro-engine] substitutions must contain at least one key");
  }
  if (!opts.fishModelId) {
    throw new Error("[intro-engine] fishModelId is required");
  }

  const cal = opts.calibration;
  const lufsRef = cal.lufsRef;
  if (
    typeof cal.anchorEndMs !== "number" ||
    typeof cal.resumeMs !== "number" ||
    typeof lufsRef !== "number" ||
    !cal.spectralRef ||
    (!cal.roomtoneUrl && !opts.roomtoneLocalPath)
  ) {
    return fail(opts.tag, "calibration_incomplete");
  }

  // Template-Modus: bei kurzem Anrede-Template („Hi {vorname}") cutten wir
  // NUR die Anrede raus und lassen die bewusste Pause + den ersten Satz
  // des Users stehen. Bei einem klassischen Volltext-Template
  // (Legacy, „Hallo {vorname}! Schön, dass ...") ersetzt der TTS den
  // ganzen ersten Satz — Anker bleibt dann anchorEndMs.
  //
  // KEIN silent-Sentence-Fallback mehr: wenn der User „Hi {vorname}"
  // gewählt hat und die Kalibrierung liefert einen zu kleinen Anker
  // (False-Positive am Aufnahme-Start), skippen wir das Intro komplett
  // (Fallback auf Original-Video, 1 Credit). Andernfalls würden wir
  // heimlich den ganzen ersten Satz des Users ersetzen — semantisch
  // eine Lüge gegenüber der UI-Wahl. Die Kalibrierung ist Nutzer-sichtbar
  // reparierbar (deutliche Pause nach „Hi!" bei Neu-Aufnahme).
  const template = cal.ttsTemplate?.trim() || DEFAULT_TTS_TEMPLATE;
  const wantsGreeting = parseGreetingTemplate(template) !== null;
  if (wantsGreeting) {
    if (cal.greetingEndMs === null) {
      return fail(opts.tag, "greeting_anchor_missing");
    }
    // Untergrenze bewusst niedrig: 300ms sind das absolute Minimum für
    // ein natürlich gesprochenes „Hi". Alles darunter ist ein
    // Silence-False-Positive. Wenn die TTS länger ist als greeting_end,
    // wird sie unten via atempo auf die Ziel-Länge beschleunigt.
    if ((cal.greetingEndMs as number) < 300) {
      return fail(
        opts.tag,
        `greeting_anchor_too_small_${cal.greetingEndMs}ms`,
      );
    }
  }
  const isGreetingOnly = wantsGreeting;
  // Initialer anchorEndMs — kann in der TTS-Phase noch nach hinten
  // wandern, wenn Fish TTS länger als die Original-Anrede-Zone spricht
  // (siehe unten „effectiveAnchorMs"). Als let, damit die Assembly-
  // Berechnung unten den angepassten Wert verwendet.
  let anchorEndMs = isGreetingOnly
    ? (cal.greetingEndMs as number)
    : cal.anchorEndMs;
  let resumeMs = 0; // wird nach TTS-Länge unten korrekt gesetzt
  const RESIDUAL_PAUSE_MS = 300;

  const dir = opts.workDir;
  const tag = opts.tag.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 40);
  // Bunny-Uploads, die im Erfolgs- wie Fehlerfall best-effort gelöscht werden.
  const uploadedUrls: string[] = [];

  try {
    // ── 1. TTS ──────────────────────────────────────────────────────────
    let text = template;
    for (const [key, value] of Object.entries(opts.substitutions)) {
      text = text.replaceAll(`{${key}}`, value.trim());
    }
    const ttsRawPath = join(dir, `tts-raw-${tag}.wav`);
    const ttsBuffer = await tts({ text, referenceId: opts.fishModelId });
    await writeFile(ttsRawPath, ttsBuffer);

    const ttsRawDurSec = await probeVideoDuration(ttsRawPath);
    if (!ttsRawDurSec || ttsRawDurSec <= 0.2) {
      return fail(tag, "tts_unmeasurable");
    }

    // Konzeptioneller Umbau: Statt die TTS an eine feste Original-Zone
    // zu quetschen (via Speed-up → hektisch), erweitern wir die Cut-Zone
    // dynamisch auf die TTS-Länge. Das bedeutet: bei greeting-only
    // schneidet die Engine mehr vom Original weg als greeting_end_ms
    // vorgibt, damit die TTS in natürlicher Geschwindigkeit spielen kann.
    // Nachteil: der Video-Content startet ein paar 100ms später —
    // meistens fällt das in die Original-Mikro-Pause + evtl. Anfang des
    // ersten Wortes, was für den Zuhörer nicht störend ist.
    //
    // Grenze: der erweiterte Cut darf NICHT über anchor_end_ms hinaus
    // (das wäre der ganze erste Satz, Legacy-Modus), sonst ist die
    // TTS zu lang für die Aufnahme.
    let ttsDurMs = ttsRawDurSec * 1000;
    const HEADROOM_MS = 50;
    // Ziel-Zone berechnen. Wenn sentence_start_ms bekannt ist, dürfen
    // wir bis DORT cutten (Ende der bewussten Pause im Original) — die
    // TTS-Sprache ersetzt dann Anrede + die kurze User-Pause. Original-
    // Content bleibt unversehrt (im Gegensatz zum „mitten ins Wort
    // schneiden"-Bug).
    let extendedAnchorMs = anchorEndMs;
    if (isGreetingOnly && typeof cal.sentenceStartMs === "number") {
      extendedAnchorMs = Math.max(anchorEndMs, cal.sentenceStartMs);
      anchorEndMs = extendedAnchorMs;
    }
    const targetMs = extendedAnchorMs - HEADROOM_MS;
    let ttsAdjustedPath = ttsRawPath;
    if (ttsDurMs > targetMs) {
      const speedFactor = ttsDurMs / targetMs;
      // 1.5x ist die Grenze wo Deutsch noch als „etwas flott" durchgeht,
      // darüber wird's als „unnatürlich schnell" wahrgenommen.
      if (speedFactor > 1.5) {
        return fail(
          tag,
          `tts_too_long: ${ttsDurMs.toFixed(0)}ms für ${targetMs}ms Anrede-Zone (Faktor ${speedFactor.toFixed(2)}, max 1.5)`,
        );
      }
      const spedPath = join(dir, `tts-sped-${tag}.wav`);
      await runFfmpeg([
        "-y", "-i", ttsRawPath,
        "-filter:a", `atempo=${speedFactor.toFixed(3)}`,
        "-ac", "1", "-ar", String(SAMPLE_RATE),
        spedPath,
      ]);
      ttsAdjustedPath = spedPath;
      const spedDur = await probeVideoDuration(spedPath);
      ttsDurMs = (spedDur ?? ttsRawDurSec) * 1000;
    }
    // Resume auf sentence_start (Ende der User-Pause) — dort setzt der
    // Original-Content sauber ein. Ohne dynamische Anchor-Erweiterung.
    if (isGreetingOnly) {
      const base =
        typeof cal.sentenceStartMs === "number"
          ? Math.max(anchorEndMs + 120, cal.sentenceStartMs - RESIDUAL_PAUSE_MS)
          : anchorEndMs + 120;
      resumeMs = Math.round(Math.ceil(base / FRAME_MS) * FRAME_MS);
    } else {
      resumeMs = cal.resumeMs;
    }

    // ── 2. Auto-EQ + Loudness-Match ─────────────────────────────────────
    const ttsSpectrum = await measureSpectrum(ttsAdjustedPath);
    const eqChain = buildEqFilterChain(cal.spectralRef, ttsSpectrum);
    const ttsEqPath = join(dir, `tts-eq-${tag}.wav`);
    await runFfmpeg([
      "-y", "-i", ttsAdjustedPath,
      ...(eqChain ? ["-af", eqChain] : []),
      "-ac", "1", "-ar", String(SAMPLE_RATE),
      ttsEqPath,
    ]);

    const eqLufs = await measureLufs(ttsEqPath);
    if (eqLufs === null) return fail(tag, "tts_lufs_unmeasurable");
    let ttsFinalPath = join(dir, `tts-final-${tag}.wav`);
    await runFfmpeg([
      "-y", "-i", ttsEqPath,
      "-af", `volume=${(lufsRef - eqLufs).toFixed(2)}dB`,
      "-ac", "1", "-ar", String(SAMPLE_RATE),
      ttsFinalPath,
    ]);
    // Verifikation + max. ein Korrektur-Pass (volume ist linear, aber
    // ebur128-Gating kann bei großen Sprüngen leicht abweichen).
    const finalLufs = await measureLufs(ttsFinalPath);
    if (finalLufs !== null && Math.abs(finalLufs - lufsRef) > 0.5) {
      const corrPath = join(dir, `tts-final2-${tag}.wav`);
      await runFfmpeg([
        "-y", "-i", ttsFinalPath,
        "-af", `volume=${(lufsRef - finalLufs).toFixed(2)}dB`,
        "-ac", "1", "-ar", String(SAMPLE_RATE),
        corrPath,
      ]);
      ttsFinalPath = corrPath;
    }

    // ── 3. Timing (ms, 30fps-frame-aligned) ─────────────────────────────
    const startTrimMs =
      Math.floor(Math.max(0, anchorEndMs - ttsDurMs - LEAD_IN_MS) / FRAME_MS) *
      FRAME_MS;
    const ttsAtMs = anchorEndMs - ttsDurMs - startTrimMs;
    const segEndMs = resumeMs - startTrimMs;
    if (ttsAtMs < 0 || segEndMs <= 0) {
      return fail(tag, "timing_invalid");
    }

    // ── 4. Raumton-Bett + TTS-Mix ───────────────────────────────────────
    const roomtonePath = opts.roomtoneLocalPath ?? join(dir, `roomtone-${tag}.wav`);
    if (!opts.roomtoneLocalPath) {
      await downloadTo(cal.roomtoneUrl!, roomtonePath);
    }
    const bedPath = join(dir, `bed-${tag}.wav`);
    await runFfmpeg([
      "-y",
      "-stream_loop", "-1",
      "-i", roomtonePath,
      "-t", (segEndMs / 1000).toFixed(3),
      "-ac", "1", "-ar", String(SAMPLE_RATE),
      bedPath,
    ]);
    const segmentAudioPath = join(dir, `segment-audio-${tag}.wav`);
    await runFfmpeg([
      "-y",
      "-i", bedPath,
      "-i", ttsFinalPath,
      "-filter_complex",
      `[1:a]adelay=${Math.round(ttsAtMs)}:all=1[g];[0:a][g]amix=inputs=2:duration=first:normalize=0[a]`,
      "-map", "[a]",
      "-ac", "1", "-ar", String(SAMPLE_RATE),
      segmentAudioPath,
    ]);

    // ── 5. Video-Segment schneiden ──────────────────────────────────────
    // trim-`end` ist ABSOLUT in der Quelle (= resume), nicht relativ.
    const segmentVideoPath = join(dir, `segment-video-${tag}.mp4`);
    await runFfmpeg([
      "-y",
      "-i", opts.webcamLocalPath,
      "-vf",
      `trim=start=${(startTrimMs / 1000).toFixed(4)}:end=${(resumeMs / 1000).toFixed(4)},setpts=PTS-STARTPTS,fps=${FPS}`,
      "-an",
      "-c:v", "libx264",
      "-preset", "medium",
      "-crf", "18",
      "-pix_fmt", "yuv420p",
      "-movflags", "+faststart",
      segmentVideoPath,
    ]);
    const segVideoDurSec = await probeVideoDuration(segmentVideoPath);
    if (
      segVideoDurSec === null ||
      Math.abs(segVideoDurSec * 1000 - segEndMs) > 40
    ) {
      return fail(
        tag,
        `segment_duration_mismatch (got=${segVideoDurSec}s want=${(segEndMs / 1000).toFixed(3)}s)`,
      );
    }

    // ── 6. Segment-Upload (sync.so braucht öffentliche URLs) ────────────
    const segVideoUpload = await uploadIntroFile({
      userId: opts.userId,
      fileName: `seg-${tag}.mp4`,
      buffer: await readFile(segmentVideoPath),
      contentType: "video/mp4",
    });
    uploadedUrls.push(segVideoUpload.url);
    const segAudioUpload = await uploadIntroFile({
      userId: opts.userId,
      fileName: `seg-${tag}.wav`,
      buffer: await readFile(segmentAudioPath),
      contentType: "audio/wav",
    });
    uploadedUrls.push(segAudioUpload.url);

    // ── 7. sync.so Lip-Sync ─────────────────────────────────────────────
    const generation = await createGeneration({
      videoUrl: segVideoUpload.url,
      audioUrl: segAudioUpload.url,
    });
    if (!generation.id) return fail(tag, "lipsync_create_failed");

    const deadline = Date.now() + SYNCSO_TIMEOUT_MS;
    let outputUrl: string | null = null;
    for (;;) {
      await sleep(SYNCSO_POLL_INTERVAL_MS);
      const status = await getGeneration(generation.id);
      if (status.status === "COMPLETED" && status.outputUrl) {
        outputUrl = status.outputUrl;
        break;
      }
      if (status.status === "FAILED" || status.status === "REJECTED") {
        return fail(
          tag,
          `lipsync_${status.status.toLowerCase()}${status.error ? `: ${status.error.slice(0, 200)}` : ""}`,
        );
      }
      if (Date.now() > deadline) {
        return fail(tag, "lipsync_timeout");
      }
    }

    const syncedPath = join(dir, `synced-${tag}.mp4`);
    await downloadTo(outputUrl, syncedPath);
    const syncedDurSec = await probeVideoDuration(syncedPath);
    if (
      syncedDurSec === null ||
      Math.abs(syncedDurSec * 1000 - segEndMs) > 300
    ) {
      return fail(
        tag,
        `lipsync_duration_mismatch (got=${syncedDurSec}s want=${(segEndMs / 1000).toFixed(3)}s)`,
      );
    }

    // ── 8. Cut-freie Assembly (ein einziger Encode) ─────────────────────
    // Kritisch: Original-Audio startet EXAKT bei resumeSec — nicht davor,
    // sonst zieht sich die Original-Anrede („Hey!") zurück in den Mix und
    // der Zuhörer hört zweimal die Anrede („Hi Test. Hey, ich nehm...").
    // Der Übergang nutzt statt acrossfade (das überlappt) getrennte
    // afade-in/out an den beiden Segment-Rändern.
    const outPath = join(dir, `intro-out-${tag}.mp4`);
    const resumeSec = (resumeMs / 1000).toFixed(4);
    const FADE_MS = 60;
    const fadeOutStartSec = ((segEndMs - FADE_MS) / 1000).toFixed(4);
    await runFfmpeg([
      "-y",
      "-i", syncedPath,
      "-i", segmentAudioPath,
      "-i", opts.webcamLocalPath,
      "-filter_complex",
      `[0:v]fps=${FPS},setpts=PTS-STARTPTS[v0];` +
        `[2:v]trim=start=${resumeSec},fps=${FPS},setpts=PTS-STARTPTS[v1];` +
        `[v0][v1]concat=n=2:v=1:a=0[v];` +
        `[1:a]afade=t=out:st=${fadeOutStartSec}:d=${(FADE_MS / 1000).toFixed(3)},aresample=${SAMPLE_RATE},pan=mono|c0=c0[a0];` +
        `[2:a]atrim=start=${resumeSec},asetpts=PTS-STARTPTS,aresample=${SAMPLE_RATE},pan=mono|c0=c0,afade=t=in:st=0:d=${(FADE_MS / 1000).toFixed(3)}[a1];` +
        `[a0][a1]concat=n=2:v=0:a=1[a]`,
      "-map", "[v]",
      "-map", "[a]",
      "-c:v", "libx264",
      "-preset", "medium",
      "-crf", "18",
      "-pix_fmt", "yuv420p",
      "-c:a", "aac",
      "-b:a", "192k",
      "-movflags", "+faststart",
      outPath,
    ]);

    // ── 9. QA-Gates ─────────────────────────────────────────────────────
    const webcamDurSec = await probeVideoDuration(opts.webcamLocalPath);
    const outDurSec = await probeVideoDuration(outPath);
    if (outDurSec === null || webcamDurSec === null) {
      return fail(tag, "qa_duration_unmeasurable");
    }
    const expectedSec = webcamDurSec - startTrimMs / 1000;
    if (Math.abs(outDurSec - expectedSec) > 0.5) {
      return fail(
        tag,
        `qa_out_duration (got=${outDurSec.toFixed(2)}s want=${expectedSec.toFixed(2)}s)`,
      );
    }
    const windowStderr = await runFfmpegCaptureStderr([
      "-ss", (ttsAtMs / 1000).toFixed(3),
      "-t", (ttsDurMs / 1000).toFixed(3),
      "-i", outPath,
      "-af", "ebur128",
      "-f", "null", "-",
    ]);
    const windowLufs = parseIntegratedLufs(windowStderr);
    if (windowLufs === null || Math.abs(windowLufs - lufsRef) > 1.5) {
      return fail(
        tag,
        `qa_lufs_window (got=${windowLufs ?? "n/a"} want=${lufsRef}±1.5)`,
      );
    }
    const st = await stat(outPath);
    if (st.size < 100 * 1024) {
      return fail(tag, `qa_file_too_small (${st.size} bytes)`);
    }

    console.log(
      `[intro-engine:${tag}] ok — tts=${(ttsDurMs / 1000).toFixed(2)}s startTrim=${(startTrimMs / 1000).toFixed(3)}s ` +
        `ttsAt=${(ttsAtMs / 1000).toFixed(3)}s out=${outDurSec.toFixed(2)}s windowLufs=${windowLufs.toFixed(1)} (ref=${lufsRef})`,
    );

    // Preview-Modus: auf die ersten N Sekunden kürzen (nach Assembly + QA).
    if (opts.trimToSec && opts.trimToSec > 0) {
      const trimmedPath = join(dir, `intro-out-${tag}-trimmed.mp4`);
      await runFfmpeg([
        "-y",
        "-i", outPath,
        "-t", opts.trimToSec.toFixed(2),
        "-c", "copy",
        "-movflags", "+faststart",
        trimmedPath,
      ]);
      return { ok: true, outputPath: trimmedPath, startTrimMs };
    }

    return { ok: true, outputPath: outPath, startTrimMs };
  } catch (err) {
    // Transiente/externe Fehler (Fish, sync.so, Bunny, ffmpeg) → Fallback.
    const message = err instanceof Error ? err.message : String(err);
    return fail(tag, `error: ${message.slice(0, 300)}`);
  } finally {
    // Bunny-Zwischenartefakte best-effort löschen (deleteIntroFileByUrl
    // schluckt Fehler intern).
    for (const url of uploadedUrls) {
      await deleteIntroFileByUrl(url);
    }
  }
}
