/**
 * Intro-Engine: erzeugt pro Lead ein personalisiertes Webcam-Video, in dem
 * der erste Satz des Original-Videos durch eine KI-Begrüßung in der
 * geklonten Stimme des Kunden ersetzt ist (Fish Audio TTS `s2.1-pro` +
 * sync.so `lipsync-2`), schnittfrei zusammengesetzt.
 *
 * Rezept = validierter PoC (intro-poc/, 2026-08-03). Schritte:
 *   1. TTS ("Hallo {vorname}! …") in natürlicher Geschwindigkeit
 *   2. Auto-EQ (9-Band-FFT-Match gegen spectral_ref) + LUFS-Angleich
 *   3. Timing: startTrim/ttsAt/segEnd frame-aligned (30fps). Ist die TTS
 *      länger als die Original-Anrede-Zone, wird das Video am Anfang
 *      VERLÄNGERT (sync.so sync_mode=bounce) statt die TTS zu
 *      beschleunigen — der Content ab resume bleibt 1:1 original, alle
 *      Segment-Overlays werden über negativen startTrimMs nach hinten
 *      versetzt.
 *   4. Raumton-Bett loopen + TTS via adelay einmischen
 *   5. Video-Segment [startTrim, resume] schneiden (re-encode, CRF18)
 *   6. Segment + Audio zu Bunny (sync.so braucht öffentliche URLs)
 *   7. sync.so Lip-Sync (Poll bis 6 min; bounce wenn Audio länger)
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
import { asr, tts } from "@/lib/fish-audio";
import { createGeneration, getGeneration } from "@/lib/syncso";
import {
  uploadIntroFile,
  deleteIntroFileByUrl,
} from "@/lib/bunny/intro-storage";
import {
  DEFAULT_TTS_TEMPLATE,
  countGreetingMentions,
  parseGreetingTemplate,
} from "@/lib/intro";
import { probeVideoDuration } from "@/lib/ffprobe";
import { runFfmpeg } from "./ffmpeg";
import {
  runFfmpegCaptureStderr,
  runFfmpegCaptureStdout,
  parseIntegratedLufs,
  computeSpectralRef,
  SPECTRAL_BAND_CENTERS_HZ,
} from "./intro-audio";
import { computeEnvelopeDb, findTtsCutMs } from "./intro-structure";
import { asrHearsTokens } from "./intro-structure-asr";

const SAMPLE_RATE = 48000;
const FPS = 30;
const FRAME_MS = 1000 / FPS;
/** Vorlauf vor der TTS-Begrüßung (Original-Video ohne Sprache). */
const LEAD_IN_MS = 1200;
/**
 * Maximale Video-Verlängerung durch eine überlange TTS. Realistische
 * Anreden ("Guten Tag Frau Dr. Müller-Lüdenscheid") liegen unter 3s —
 * mehr deutet auf einen TTS-Ausreißer hin, der als Fallback endet.
 */
const MAX_EXTENSION_MS = 5000;
/**
 * sync.so Poll-Intervall / Gesamt-Timeout. 3,5s statt früher 10s (W2-
 * Speedup): spart pro Begrüßung im Schnitt ~10-15s Slot-Leerlauf nach
 * Fertigstellung. Mit 3 parallelen Generierungen ≈ 1 Request/s — weit
 * unter jedem Rate-Limit; Jitter unten verhindert synchronisierte
 * Request-Wellen gegen die Cloudflare-Front. Env-Override für den
 * Notfall (Cloudflare-Blocks → Wert hochdrehen ohne Deploy).
 */
const SYNCSO_POLL_INTERVAL_MS = (() => {
  const parsed = Number(process.env.SYNCSO_POLL_INTERVAL_MS);
  return Number.isFinite(parsed) && parsed >= 1000 ? parsed : 3_500;
})();
const SYNCSO_TIMEOUT_MS = 6 * 60 * 1000;
/** Die TTS-Anrede endet so viele ms VOR dem Original-Satzbeginn. */
const TTS_GAP_BEFORE_SENTENCE_MS = 150;
/** Gültige Anrede-Dauer nach dem Carrier-Schnitt. */
const TTS_GREETING_MIN_MS = 350;
const TTS_GREETING_MAX_MS = 3200;
/** Best-of-N: Anzahl parallel generierter TTS-Kandidaten. */
const TTS_CANDIDATES = 3;
/** Fish-Temperature — niedriger als Default für stabile kurze Anreden. */
const TTS_TEMPERATURE = 0.45;
/**
 * Max. Zeitstreckung durch sync.so remap im Overflow-Fall. Darüber wird
 * die verlangsamte Körperbewegung sichtbar.
 */
const MAX_REMAP_STRETCH = 1.3;

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
  /**
   * Preview-Modus: Teil-Assembly — nur das benötigte Material wird
   * encodiert (720p, schnelleres Preset), Output auf N Sekunden begrenzt.
   */
  trimToSec?: number;
  /**
   * TTS-Provider-Override (A/B-Test-Scripts): ersetzt die Fish-TTS durch
   * eine eigene Synthese (z.B. ElevenLabs). Muss dekodierbares Audio
   * (WAV/MP3) liefern; EQ/Loudness-Matching läuft danach identisch.
   */
  ttsOverride?: (text: string) => Promise<Buffer>;
}

export type GeneratePersonalizedWebcamResult =
  | {
      ok: true;
      outputPath: string;
      /**
       * Netto-Zeitversatz des Original-Contents in ms. Positiv = der
       * Anfang wurde getrimmt (Output kürzer, Sprech-Zeitpunkte früher).
       * Negativ = der Anfang wurde für eine lange TTS VERLÄNGERT (Output
       * länger, Sprech-Zeitpunkte später). Der Presentation-Renderer
       * kompensiert beides über die Segment-Dauern (planSegmentDurations).
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
 *   - Highpass bei 90 Hz vorweg (Rumpel/Sub-Bass raus)
 *   - 80 Hz wird übersprungen (Rumpel-Risiko beim Anheben)
 *   - 160…10000 Hz → parametrischer equalizer (q=1), Gain ±12 dB;
 *     Boosts der Bass-Bänder sind hart gedeckelt (160 Hz: +4, 315 Hz: +6):
 *     Fish-TTS hat kaum Tiefbass, die Webcam-Referenz (Nahbesprechung,
 *     Raum) dagegen viel — ungedeckelt landet hier +12 dB und jede Silbe
 *     wummert als tieffrequentes „DUM" durchs KI-Segment.
 *   - 16000 Hz → highshelf bei 11 kHz, Gain ±8 dB
 */
export function buildEqFilterChain(
  ref: Record<string, number>,
  measured: Record<string, number>,
): string {
  const parts: string[] = ["highpass=f=90"];
  const BOOST_CAP_DB: Record<number, number> = { 160: 4, 315: 6 };
  for (const band of SPECTRAL_BAND_CENTERS_HZ) {
    if (band === 80) continue;
    const refDb = ref[String(band)];
    const ttsDb = measured[String(band)];
    if (typeof refDb !== "number" || typeof ttsDb !== "number") continue;
    const boostCap = BOOST_CAP_DB[band] ?? 12;
    const gain = clamp(refDb - ttsDb, -12, boostCap);
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

  // Template-Modus: bei kurzem Anrede-Template („Hi {vorname}") ersetzt
  // die TTS NUR die Anrede; der erste Satz des Users bleibt original und
  // läuft INNERHALB des Lipsync-Segments weiter (Langsegment-Rezept).
  // Bei einem klassischen Volltext-Template (Legacy, „Hallo {vorname}!
  // Schön, dass ...") ersetzt die TTS den ganzen ersten Satz — Anker
  // bleibt anchorEndMs.
  //
  // KEIN silent-Sentence-Fallback: fehlt dem greeting-only-Modus der
  // Satz-Anker (sentence_start_ms, Altbestand vor der adaptiven
  // Kalibrierung), skippen wir das Intro komplett (Fallback Original-
  // Video). Die Kalibrierung ist Nutzer-sichtbar reparierbar
  // (Neu-Analyse in der Kampagnen-Bearbeitung).
  const template = cal.ttsTemplate?.trim() || DEFAULT_TTS_TEMPLATE;
  const isGreetingOnly = parseGreetingTemplate(template) !== null;
  if (isGreetingOnly && typeof cal.sentenceStartMs !== "number") {
    return fail(opts.tag, "calibration_missing_sentence_start");
  }
  let resumeMs = 0; // wird in der Timing-Phase gesetzt
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
    // Terminale Interpunktion gibt Fish einen Prosodie-Anker — ohne sie
    // klingen kurze Anreden („Hi Daniel") oft abgehackt/monoton.
    if (!/[.!?]$/.test(text.trim())) {
      text = `${text.trim()}!`;
    }
    const ttsRawPath = join(dir, `tts-raw-${tag}.wav`);
    // KEIN Speed-up: die TTS spielt IMMER in natürlicher Geschwindigkeit.
    // Passt sie nicht in die Zone vor dem Original-Satz, wird das Video am
    // Anfang verlängert (Timing unten + sync.so remap) — atempo klang
    // gehetzt/robotisch.
    let ttsDurMs: number;
    if (isGreetingOnly) {
      // Carrier-Satz: Fish spricht isolierte 2-Wort-Anreden monoton/
      // robotisch. Im Satz-Kontext („Hi Julia! Schön, dass du
      // reinschaust.") bekommt die Anrede natürliche Prosodie — wir
      // schneiden sie in der Sprechlücke nach dem Ausruf wieder heraus.
      // Best-of-N: mehrere Kandidaten parallel; gewählt wird der Median
      // der Anrede-Dauern (Ausreißer = Nuschler oder Hänger).
      const formal = template.includes("{anrede}");
      const carrierText = `${text.trim()} ${formal ? "Schön, dass Sie reinschauen." : "Schön, dass du reinschaust."}`;
      const settled = await Promise.allSettled(
        Array.from({ length: TTS_CANDIDATES }, () =>
          opts.ttsOverride
            ? opts.ttsOverride(carrierText)
            : tts({
                text: carrierText,
                referenceId: opts.fishModelId,
                temperature: TTS_TEMPERATURE,
              }),
        ),
      );
      const candidates: Array<{ path: string; cutMs: number }> = [];
      for (let i = 0; i < settled.length; i++) {
        const s = settled[i];
        if (s.status !== "fulfilled") continue;
        const candPath = join(dir, `tts-cand-${i}-${tag}.wav`);
        await writeFile(candPath, s.value);
        const candPcm = await runFfmpegCaptureStdout([
          "-i", candPath,
          "-f", "s16le", "-acodec", "pcm_s16le", "-ac", "1", "-ar", String(SAMPLE_RATE),
          "-",
        ]);
        const cutMs = findTtsCutMs(computeEnvelopeDb(candPcm, SAMPLE_RATE), 10);
        if (
          cutMs !== null &&
          cutMs >= TTS_GREETING_MIN_MS &&
          cutMs <= TTS_GREETING_MAX_MS
        ) {
          candidates.push({ path: candPath, cutMs });
        }
      }
      let cutMsChosen: number | null = null;
      if (candidates.length > 0) {
        candidates.sort((a, b) => a.cutMs - b.cutMs);
        const medianCutMs =
          candidates[Math.floor((candidates.length - 1) / 2)].cutMs;
        const ordered = [...candidates].sort(
          (a, b) =>
            Math.abs(a.cutMs - medianCutMs) - Math.abs(b.cutMs - medianCutMs),
        );
        const nameTokens = Object.values(opts.substitutions)
          .flatMap((v) => v.trim().split(/\s+/))
          .filter((t) => t.length > 0);
        for (const cand of ordered) {
          const cutSec = cand.cutMs / 1000;
          await runFfmpeg([
            "-y", "-i", cand.path,
            "-af",
            `atrim=end=${cutSec.toFixed(3)},afade=t=out:st=${Math.max(0, cutSec - 0.03).toFixed(3)}:d=0.03`,
            "-ac", "1", "-ar", String(SAMPLE_RATE),
            ttsRawPath,
          ]);
          // ASR-Gegenprobe: der Schnitt darf nichts vom Carrier-Satz
          // enthalten — sonst war die gefundene Lücke nicht die Lücke
          // nach der Anrede (Fish hat durchgesprochen). Best effort:
          // liefert die ASR nichts, akzeptieren wir den Kandidaten.
          try {
            const cutAsr = await asr({ audioPath: ttsRawPath });
            const cutText = cutAsr?.text?.toLowerCase() ?? "";
            if (/sch(ö|oe)n|reinschau/.test(cutText)) continue;
            // Positive Gegenprobe: der NAME muss im Schnitt hörbar sein.
            // Fish setzt gelegentlich eine Mikro-Pause ZWISCHEN Anrede-
            // Wort und Name — dann schneidet findTtsCutMs den Namen weg
            // (Incident 2026-08-21: „Hey" ohne „Axel").
            if (cutText && !asrHearsTokens(cutText, nameTokens)) {
              console.warn(
                `[intro-engine:${tag}] tts-cut ohne Name verworfen (asr="${cutText.slice(0, 60)}")`,
              );
              continue;
            }
          } catch {
            // ASR nicht verfügbar → Kandidat ungeprüft akzeptieren.
          }
          cutMsChosen = cand.cutMs;
          break;
        }
      }
      if (cutMsChosen !== null) {
        ttsDurMs = cutMsChosen;
      } else {
        // Alle Carrier-Kandidaten unbrauchbar → plain-TTS der puren Anrede.
        const buf = opts.ttsOverride
          ? await opts.ttsOverride(text)
          : await tts({
              text,
              referenceId: opts.fishModelId,
              temperature: TTS_TEMPERATURE,
            });
        await writeFile(ttsRawPath, buf);
        const durSec = await probeVideoDuration(ttsRawPath);
        if (!durSec || durSec <= 0.2) return fail(tag, "tts_unmeasurable");
        ttsDurMs = durSec * 1000;
      }
    } else {
      const ttsBuffer = opts.ttsOverride
        ? await opts.ttsOverride(text)
        : await tts({ text, referenceId: opts.fishModelId });
      await writeFile(ttsRawPath, ttsBuffer);
      const durSec = await probeVideoDuration(ttsRawPath);
      if (!durSec || durSec <= 0.2) return fail(tag, "tts_unmeasurable");
      ttsDurMs = durSec * 1000;
    }

    // ── 2. Auto-EQ + Loudness-Match ─────────────────────────────────────
    const ttsSpectrum = await measureSpectrum(ttsRawPath);
    const eqChain = buildEqFilterChain(cal.spectralRef, ttsSpectrum);
    const ttsEqPath = join(dir, `tts-eq-${tag}.wav`);
    await runFfmpeg([
      "-y", "-i", ttsRawPath,
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
    let startTrimMs: number;
    let ttsAtMs: number;
    let extensionMs = 0;
    /** Nur greeting-only: Position des Original-Satzbeginns im Segment. */
    let sentenceInSegMs: number | null = null;

    if (isGreetingOnly) {
      // LANGSEGMENT-Rezept: das Lipsync-Segment reicht bis HINTER den
      // ersten Original-Satz (resume = Atempause danach). Die TTS-Anrede
      // endet TTS_GAP_BEFORE_SENTENCE_MS vor dem Original-Satzbeginn; ab
      // dort läuft das ORIGINAL-Audio innerhalb des gelipsyncten
      // Materials weiter. Vorteile: (a) der Anrede→Satz-Übergang liegt
      // nicht an einem Video-Schnitt, (b) sync.so lipsync-2 sieht echtes
      // Sprechmaterial im Segment — Kurz-Segmente mit überwiegend
      // stummem Gesicht lieferten keine sichtbare Mundbewegung.
      const sentenceStartMs = cal.sentenceStartMs as number;
      resumeMs = cal.resumeMs;
      const desiredTtsStartMs =
        sentenceStartMs - TTS_GAP_BEFORE_SENTENCE_MS - ttsDurMs;
      if (desiredTtsStartMs >= 0) {
        startTrimMs =
          Math.floor(Math.max(0, desiredTtsStartMs - LEAD_IN_MS) / FRAME_MS) *
          FRAME_MS;
        ttsAtMs = desiredTtsStartMs - startTrimMs;
      } else {
        // TTS länger als der Platz vor dem Satz → Segment vorne um
        // extension verlängern; sync.so remap streckt das Video sanft
        // (bounce spielte Material rückwärts — sichtbares Artefakt).
        startTrimMs = 0;
        extensionMs =
          Math.ceil((-desiredTtsStartMs + 400) / FRAME_MS) * FRAME_MS;
        ttsAtMs = extensionMs + desiredTtsStartMs;
        if (extensionMs > MAX_EXTENSION_MS) {
          return fail(
            tag,
            `tts_extension_too_long: ${extensionMs.toFixed(0)}ms Verlängerung nötig (tts=${ttsDurMs.toFixed(0)}ms, max ${MAX_EXTENSION_MS}ms)`,
          );
        }
      }
      sentenceInSegMs = sentenceStartMs - startTrimMs + extensionMs;
    } else {
      // LEGACY-Volltext-Template: TTS ersetzt den ganzen ersten Satz.
      // Fit-Fall: TTS endet an anchorEnd, totes Vorlauf-Material wird
      // getrimmt (LEAD_IN bleibt). Overflow: TTS startet am Original-
      // Sprachbeginn, Segment wird um extension verlängert (remap).
      const anchorEndMs = cal.anchorEndMs as number;
      const HEADROOM_MS = 50;
      resumeMs = cal.resumeMs;
      if (ttsDurMs <= anchorEndMs - HEADROOM_MS) {
        startTrimMs =
          Math.floor(
            Math.max(0, anchorEndMs - ttsDurMs - LEAD_IN_MS) / FRAME_MS,
          ) * FRAME_MS;
        ttsAtMs = anchorEndMs - ttsDurMs - startTrimMs;
      } else {
        const speechStartMs =
          typeof cal.speechStartMs === "number"
            ? cal.speechStartMs
            : LEAD_IN_MS;
        startTrimMs =
          Math.floor(Math.max(0, speechStartMs - LEAD_IN_MS) / FRAME_MS) *
          FRAME_MS;
        ttsAtMs = speechStartMs - startTrimMs;
        const desiredSegMs =
          Math.ceil((ttsAtMs + ttsDurMs + RESIDUAL_PAUSE_MS) / FRAME_MS) *
          FRAME_MS;
        extensionMs = Math.max(0, desiredSegMs - (resumeMs - startTrimMs));
        if (extensionMs > MAX_EXTENSION_MS) {
          return fail(
            tag,
            `tts_extension_too_long: ${extensionMs.toFixed(0)}ms Verlängerung nötig (tts=${ttsDurMs.toFixed(0)}ms, max ${MAX_EXTENSION_MS}ms)`,
          );
        }
      }
    }
    /** Dauer des geschnittenen Quell-Videosegments [startTrim, resume]. */
    const segVideoMs = resumeMs - startTrimMs;
    /** Dauer des Intro-Segments im Output (Audio ist maßgeblich). */
    const segEndMs = segVideoMs + extensionMs;
    if (ttsAtMs < 0 || segVideoMs <= 0) {
      return fail(tag, "timing_invalid");
    }
    if (extensionMs > 0 && segEndMs / segVideoMs > MAX_REMAP_STRETCH) {
      return fail(
        tag,
        `lipsync_stretch_too_large (${(segEndMs / segVideoMs).toFixed(2)}x)`,
      );
    }

    // ── 4. Raumton-Bett + TTS-Mix ───────────────────────────────────────
    const roomtonePath = opts.roomtoneLocalPath ?? join(dir, `roomtone-${tag}.wav`);
    if (!opts.roomtoneLocalPath) {
      await downloadTo(cal.roomtoneUrl!, roomtonePath);
    }
    // Palindrom (vorwärts+rückwärts) statt hartem Loop: die stream_loop-
    // Naht des ~300ms-Roomtones hat als periodisches Klicken/„DUM" im
    // KI-Segment durchgeschlagen. Beim Palindrom ist jede Naht stetig.
    // Zusätzlich vor dem Palindrom entrumpeln: Thumps IM Schnipsel selbst
    // (90-300Hz-Transienten aus dem Webcam-Roomtone) werden durch den Loop
    // sonst rhythmisch ("DUMDUMDUM"). Highpass + Compander wirken NUR auf
    // das Bett; die TTS-Stimme wird erst danach separat drübergemischt.
    const palindromePath = join(dir, `roomtone-pal-${tag}.wav`);
    const DE_THUMP =
      "highpass=f=120," +
      "compand=attacks=0.003:decays=0.12:" +
      "points=-80/-80|-50/-50|-40/-46|-20/-45:soft-knee=4:volume=-50";
    await runFfmpeg([
      "-y", "-i", roomtonePath,
      "-filter_complex",
      `[0:a]${DE_THUMP}[f];[f]asplit[a][b];` +
        "[b]areverse[r];[a][r]concat=n=2:v=0:a=1[p]",
      "-map", "[p]",
      "-ac", "1", "-ar", String(SAMPLE_RATE),
      palindromePath,
    ]);
    const segmentAudioPath = join(dir, `segment-audio-${tag}.wav`);
    if (sentenceInSegMs !== null && isGreetingOnly) {
      // Composite: Roomtone-Bett (+TTS) NUR bis zum Original-Satzbeginn,
      // ab dort das unveränderte Original-Audio [sentenceStart, resume].
      // Kurze 25ms-Fades entschärfen die Bett→Original-Naht; der TTS
      // endet TTS_GAP_BEFORE_SENTENCE_MS davor und überlappt nie.
      const bedPath = join(dir, `bed-${tag}.wav`);
      await runFfmpeg([
        "-y",
        "-stream_loop", "-1",
        "-i", palindromePath,
        "-t", (sentenceInSegMs / 1000).toFixed(3),
        "-af",
        `afade=t=out:st=${Math.max(0, (sentenceInSegMs - 25) / 1000).toFixed(3)}:d=0.025`,
        "-ac", "1", "-ar", String(SAMPLE_RATE),
        bedPath,
      ]);
      const sentAudioPath = join(dir, `sent-audio-${tag}.wav`);
      await runFfmpeg([
        "-y",
        "-i", opts.webcamLocalPath,
        "-ss", ((cal.sentenceStartMs as number) / 1000).toFixed(4),
        "-to", (resumeMs / 1000).toFixed(4),
        "-vn",
        "-af", "afade=t=in:st=0:d=0.025",
        "-ac", "1", "-ar", String(SAMPLE_RATE),
        sentAudioPath,
      ]);
      await runFfmpeg([
        "-y",
        "-i", bedPath,
        "-i", sentAudioPath,
        "-i", ttsFinalPath,
        "-filter_complex",
        `[0:a][1:a]concat=n=2:v=0:a=1[base];` +
          `[2:a]adelay=${Math.round(ttsAtMs)}:all=1[g];` +
          `[base][g]amix=inputs=2:duration=first:normalize=0[a]`,
        "-map", "[a]",
        "-ac", "1", "-ar", String(SAMPLE_RATE),
        segmentAudioPath,
      ]);
    } else {
      // Legacy: Bett über das ganze Segment, TTS via adelay eingemischt.
      const bedPath = join(dir, `bed-${tag}.wav`);
      await runFfmpeg([
        "-y",
        "-stream_loop", "-1",
        "-i", palindromePath,
        "-t", (segEndMs / 1000).toFixed(3),
        "-ac", "1", "-ar", String(SAMPLE_RATE),
        bedPath,
      ]);
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
    }

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
      Math.abs(segVideoDurSec * 1000 - segVideoMs) > 40
    ) {
      return fail(
        tag,
        `segment_duration_mismatch (got=${segVideoDurSec}s want=${(segVideoMs / 1000).toFixed(3)}s)`,
      );
    }

    // ── 6. Segment-Upload (sync.so braucht öffentliche URLs) ────────────
    // Nonce im Dateinamen: der Bunny-CDN-Cache hat sync.so sonst bei
    // Regenerierungen die ALTEN Segmente unter gleicher URL ausgeliefert
    // (lipsync_duration_mismatch mit exakt den alten Segment-Längen).
    const segNonce = Date.now();
    const segVideoUpload = await uploadIntroFile({
      userId: opts.userId,
      fileName: `seg-${tag}-${segNonce}.mp4`,
      buffer: await readFile(segmentVideoPath),
      contentType: "video/mp4",
    });
    uploadedUrls.push(segVideoUpload.url);
    const segAudioUpload = await uploadIntroFile({
      userId: opts.userId,
      fileName: `seg-${tag}-${segNonce}.wav`,
      buffer: await readFile(segmentAudioPath),
      contentType: "audio/wav",
    });
    uploadedUrls.push(segAudioUpload.url);

    // ── 7. sync.so Lip-Sync ─────────────────────────────────────────────
    // remap nur wenn das Audio länger ist als das Video-Segment: sync.so
    // streckt das Video dann zeitlich (Faktor oben auf MAX_REMAP_STRETCH
    // gedeckelt) und generiert lippensynchrone Mundbewegungen. bounce
    // (spiegeln) hatte sichtbare Rückwärts-Artefakte erzeugt.
    const generation = await createGeneration({
      videoUrl: segVideoUpload.url,
      audioUrl: segAudioUpload.url,
      syncMode: extensionMs > 0 ? "remap" : "cut_off",
    });
    if (!generation.id) return fail(tag, "lipsync_create_failed");

    const deadline = Date.now() + SYNCSO_TIMEOUT_MS;
    let outputUrl: string | null = null;
    for (;;) {
      await sleep(SYNCSO_POLL_INTERVAL_MS + Math.random() * 500);
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
    // 120ms: lang genug gegen Knack-Transienten am Schnitt, kurz genug,
    // dass kein Lautstärke-Loch entsteht — beide Fades liegen komplett
    // in der Rest-Pause (RESIDUAL_PAUSE_MS=300 vor/nach dem Übergang).
    const FADE_MS = 120;
    const fadeOutStartSec = ((segEndMs - FADE_MS) / 1000).toFixed(4);
    // Preview-Modus (trimToSec): Teil-Assembly statt Voll-Encode. Früher
    // wurde hier das KOMPLETTE Webcam-Video (bis zu Minuten) in voller
    // Auflösung encodiert und danach auf N Sekunden geschnitten — der
    // teuerste Einzelschritt der Preview. Jetzt wird nur das benötigte
    // Material geschnitten (Segment + kleiner Original-Tail), auf 720p
    // skaliert und mit schnellerem Preset encodiert. Fürs finale Video
    // (Staging-Queue) bleibt alles unverändert bei voller Qualität.
    const isPreview = !!(opts.trimToSec && opts.trimToSec > 0);
    const previewMs = isPreview ? (opts.trimToSec as number) * 1000 : 0;
    const tailEndSec = isPreview
      ? ((resumeMs + Math.max(0, previewMs - segEndMs) + 1500) / 1000).toFixed(4)
      : null;
    const vTailTrim = tailEndSec
      ? `trim=start=${resumeSec}:end=${tailEndSec}`
      : `trim=start=${resumeSec}`;
    const aTailTrim = tailEndSec
      ? `atrim=start=${resumeSec}:end=${tailEndSec}`
      : `atrim=start=${resumeSec}`;
    const vFinal = isPreview
      ? `[vc]scale=-2:'trunc(min(720,ih)/2)*2'[v];`
      : `[vc]null[v];`;
    await runFfmpeg([
      "-y",
      "-i", syncedPath,
      "-i", segmentAudioPath,
      "-i", opts.webcamLocalPath,
      "-filter_complex",
      `[0:v]fps=${FPS},setpts=PTS-STARTPTS[v0];` +
        `[2:v]${vTailTrim},fps=${FPS},setpts=PTS-STARTPTS[v1];` +
        `[v0][v1]concat=n=2:v=1:a=0[vc];` +
        vFinal +
        `[1:a]afade=t=out:st=${fadeOutStartSec}:d=${(FADE_MS / 1000).toFixed(3)},aresample=${SAMPLE_RATE},pan=mono|c0=c0[a0];` +
        `[2:a]${aTailTrim},asetpts=PTS-STARTPTS,aresample=${SAMPLE_RATE},pan=mono|c0=c0,afade=t=in:st=0:d=${(FADE_MS / 1000).toFixed(3)}[a1];` +
        `[a0][a1]concat=n=2:v=0:a=1[a]`,
      "-map", "[v]",
      "-map", "[a]",
      ...(isPreview ? ["-t", (opts.trimToSec as number).toFixed(2)] : []),
      "-c:v", "libx264",
      "-preset", isPreview ? "veryfast" : "medium",
      "-crf", isPreview ? "23" : "18",
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
    // Preview: Output ist per Teil-Assembly + `-t` auf trimToSec gekappt —
    // die Erwartung ist dann das Minimum aus voller Länge und Kappung.
    const fullExpectedSec =
      webcamDurSec - startTrimMs / 1000 + extensionMs / 1000;
    const expectedSec = isPreview
      ? Math.min(fullExpectedSec, opts.trimToSec as number)
      : fullExpectedSec;
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

    // QA: ASR-Gegenprobe auf den Video-Kopf — es darf GENAU EINE Anrede
    // zu hören sein. Mehr = die Original-Anrede hat den Cut überlebt
    // (Doppel-Begrüßung, Incident 2026-08-07), keine = TTS fehlt/stumm.
    // Best effort: liefert die ASR nichts, wird das Gate übersprungen.
    try {
      const headPath = join(dir, `qa-head-${tag}.wav`);
      await runFfmpeg([
        "-y",
        "-i", outPath,
        "-t", ((segEndMs + 500) / 1000).toFixed(3),
        "-vn", "-ac", "1", "-ar", "16000",
        headPath,
      ]);
      const headAsr = await asr({ audioPath: headPath });
      const headText = headAsr?.text?.trim() || null;
      if (headText) {
        const greetings = countGreetingMentions(headText);
        if (greetings > 1) {
          return fail(
            tag,
            `qa_double_greeting (asr="${headText.slice(0, 120)}")`,
          );
        }
        if (greetings === 0) {
          return fail(
            tag,
            `qa_greeting_missing (asr="${headText.slice(0, 120)}")`,
          );
        }
      }
    } catch (asrErr) {
      console.warn(
        `[intro-engine:${tag}] qa-asr skipped: ${(asrErr as Error).message?.slice(0, 120)}`,
      );
    }

    console.log(
      `[intro-engine:${tag}] ok — tts=${(ttsDurMs / 1000).toFixed(2)}s startTrim=${(startTrimMs / 1000).toFixed(3)}s ` +
        `extension=${(extensionMs / 1000).toFixed(3)}s ttsAt=${(ttsAtMs / 1000).toFixed(3)}s ` +
        `out=${outDurSec.toFixed(2)}s windowLufs=${windowLufs.toFixed(1)} (ref=${lufsRef})`,
    );

    // Netto-Zeitversatz des Original-Contents: positiv = vorne getrimmt
    // (Content früher), negativ = vorne verlängert (Content später).
    // Im Preview-Modus ist der Output bereits durch die Teil-Assembly
    // gekürzt — kein nachgelagerter Trim-Schritt mehr nötig.
    const netTrimMs = startTrimMs - extensionMs;
    return { ok: true, outputPath: outPath, startTrimMs: netTrimMs };
  } catch (err) {
    // Retryable-Fehler (FishAudioError bei 429/5xx, SyncsoConcurrencyError)
    // werden RETHROWN — der Caller (Intro-Staging-Queue bzw. Preview-
    // Processor) entscheidet über Retry mit Backoff. Alles andere
    // (dauerhafte/unerwartete Fehler) → Fallback-Result.
    if ((err as { retryable?: boolean }).retryable === true) {
      throw err;
    }
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
