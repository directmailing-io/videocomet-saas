/**
 * Struktur-Analyse der Intro-Audiospur auf Basis einer RMS-Hüllkurve mit
 * ADAPTIVER Schwelle — ersetzt die frühere silencedetect-Heuristik mit
 * absoluter -35dB-Schwelle.
 *
 * Warum: Webcam-Aufnahmen mit AGC haben Rauschteppiche, die je nach Gerät
 * zwischen -45 und -30 dB liegen. Eine absolute Schwelle erkennt dann
 * entweder Rauschen als Sprache (DigiSpace-/Daniel-Incident 2026-08-07:
 * Rauschzone 0-865ms wurde als Begrüßung kalibriert, das echte „Hi!" bei
 * ~1,15s überlebte den Cut → doppelte Anrede) oder leise Sprache als
 * Stille. Die adaptive Schwelle liegt relativ zwischen gemessenem
 * Rauschboden (P10) und Sprech-Pegel (P92) und ist damit geräteunabhängig.
 *
 * Alle Funktionen sind pure (keine I/O) und unit-getestet.
 */

export interface SpeechRegion {
  /** ms, inklusiv. */
  startMs: number;
  /** ms, exklusiv. */
  endMs: number;
  /** Mittlerer Pegel der Region in dBFS. */
  meanDb: number;
}

/** Mindest-Abstand Sprech-Pegel zu Rauschboden, sonst unbrauchbares Audio. */
const MIN_DYNAMIC_RANGE_DB = 12;
/** Regionen mit kürzerer Dauer gelten als Klick/Transient und fallen weg. */
const MIN_REGION_MS = 120;
/** Lücken unterhalb dieser Dauer werden in eine Region hineingemerged. */
const MERGE_GAP_MS = 50;

/** Anrede: akkumulierte Sprechdauer, bevor eine Trenn-Pause zählt. */
const GREETING_MIN_MS = 300;
/** Anrede-Ende muss vor dieser Marke liegen (sonst kein Cut-Punkt). */
const GREETING_MAX_MS = 5000;
/** Trenn-Pause zwischen Anrede und erstem Satz. */
const PAUSE_MIN_MS = 150;
/** Erster Satz: Mindestdauer, bevor eine Atempause als Satzende zählt. */
const SENTENCE_MIN_MS = 1500;
const SENTENCE_MAX_MS = 15000;
/**
 * Atempause nach dem ersten Satz — gestufte Suche: bevorzugt eine
 * komfortable Pause (240ms), fällt auf kürzere zurück. Eine zu knappe
 * Pause führt sonst dazu, dass der Resume-Punkt (anchor+~120ms) schon im
 * nächsten Wort liegt → hörbarer Cut mitten im Wort.
 */
const BREATH_GAP_TIERS_MS = [240, 120, 80];
/**
 * Anrede muss mindestens so laut sein wie (Satz-Pegel − 12 dB). Leiser =
 * die „Anrede" ist mit hoher Wahrscheinlichkeit gar keine Sprache
 * (Rauschen, Atmer, Stuhlknarzen) oder unbrauchbar leise gesprochen.
 */
const GREETING_MAX_QUIETER_THAN_SENTENCE_DB = 12;

/**
 * RMS-Hüllkurve in dBFS aus raw PCM (s16le mono). Fenster `winMs`,
 * Schrittweite `hopMs`. Stille/leere Frames landen bei -100 dB.
 */
export function computeEnvelopeDb(
  pcm: Buffer,
  sampleRate: number,
  hopMs = 10,
  winMs = 30,
): number[] {
  const sampleCount = Math.floor(pcm.length / 2);
  const hop = Math.max(1, Math.round((sampleRate * hopMs) / 1000));
  const win = Math.max(hop, Math.round((sampleRate * winMs) / 1000));
  const env: number[] = [];
  for (let start = 0; start < sampleCount; start += hop) {
    const end = Math.min(sampleCount, start + win);
    let sum = 0;
    for (let i = start; i < end; i++) {
      const v = pcm.readInt16LE(i * 2) / 32768;
      sum += v * v;
    }
    const rms = Math.sqrt(sum / Math.max(1, end - start));
    env.push(20 * Math.log10(rms + 1e-7));
  }
  return env;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return -100;
  const idx = Math.min(
    sorted.length - 1,
    Math.max(0, Math.round((p / 100) * (sorted.length - 1))),
  );
  return sorted[idx];
}

export interface AdaptiveThreshold {
  noiseFloorDb: number;
  speechLevelDb: number;
  thresholdDb: number;
}

/**
 * Bestimmt die adaptive Sprech-Schwelle: oberhalb des Rauschbodens (P10),
 * unterhalb des Sprech-Pegels (P92). `null`, wenn die Dynamik zu flach
 * ist (kein erkennbarer Unterschied Sprache/Stille).
 */
export function computeAdaptiveThreshold(
  envDb: number[],
): AdaptiveThreshold | null {
  if (envDb.length === 0) return null;
  const sorted = [...envDb].sort((a, b) => a - b);
  const noiseFloorDb = percentile(sorted, 10);
  const speechLevelDb = percentile(sorted, 92);
  if (speechLevelDb - noiseFloorDb < MIN_DYNAMIC_RANGE_DB) return null;
  const thresholdDb = Math.max(noiseFloorDb + 8, speechLevelDb - 24);
  return { noiseFloorDb, speechLevelDb, thresholdDb };
}

/**
 * Sprach-Regionen oberhalb der adaptiven Schwelle. Lücken < MERGE_GAP_MS
 * werden gemerged, Regionen < MIN_REGION_MS (Klicks) verworfen.
 */
export function findSpeechRegions(
  envDb: number[],
  hopMs: number,
  threshold?: AdaptiveThreshold | null,
): SpeechRegion[] {
  const th = threshold ?? computeAdaptiveThreshold(envDb);
  if (!th) return [];
  interface Raw {
    startIdx: number;
    endIdx: number;
  }
  const raw: Raw[] = [];
  let cur: Raw | null = null;
  for (let i = 0; i < envDb.length; i++) {
    if (envDb[i] > th.thresholdDb) {
      if (cur && (i - cur.endIdx) * hopMs <= MERGE_GAP_MS) {
        cur.endIdx = i + 1;
      } else {
        if (cur) raw.push(cur);
        cur = { startIdx: i, endIdx: i + 1 };
      }
    }
  }
  if (cur) raw.push(cur);

  const regions: SpeechRegion[] = [];
  for (const r of raw) {
    const startMs = r.startIdx * hopMs;
    const endMs = r.endIdx * hopMs;
    if (endMs - startMs < MIN_REGION_MS) continue;
    let sum = 0;
    for (let i = r.startIdx; i < r.endIdx; i++) sum += envDb[i];
    regions.push({ startMs, endMs, meanDb: sum / (r.endIdx - r.startIdx) });
  }
  return regions;
}

export interface IntroStructure {
  speechStartMs: number;
  /** Ende der Anrede = Beginn der Trenn-Pause. */
  greetingEndMs: number;
  /** Beginn des ersten Satzes = Ende der Trenn-Pause. */
  sentenceStartMs: number;
  /** Ende des ersten Satzes = Beginn der Atempause danach. */
  anchorEndMs: number;
  /**
   * Ende der Atempause nach dem ersten Satz (= Beginn der nächsten
   * Sprach-Region) oder null bei synthetischem anchorEnd. Erlaubt der
   * Kalibrierung, den Resume-Punkt IN die Pause zu clampen.
   */
  breathGapEndMs: number | null;
  pause: { startMs: number; endMs: number };
  greetingMeanDb: number;
  sentenceMeanDb: number;
}

export class IntroStructureError extends Error {
  constructor(public code: string) {
    super(code);
  }
}

/**
 * Leitet die Intro-Struktur (Anrede → Pause → erster Satz → Atempause)
 * aus der Hüllkurve ab. Wirft `IntroStructureError` mit sprechendem Code:
 *   - `audio_flat`            keine erkennbare Sprach-Dynamik
 *   - `greeting_too_late`     keine Trenn-Pause im Anrede-Fenster
 *   - `no_sentence_after_pause` nach der Pause kommt keine Sprache mehr
 *   - `greeting_inaudible`    „Anrede" ist deutlich leiser als der Satz
 *                             (wahrscheinlich Rauschen/kein Sprechen)
 */
export function analyzeIntroStructure(
  envDb: number[],
  hopMs: number,
): IntroStructure {
  const th = computeAdaptiveThreshold(envDb);
  if (!th) throw new IntroStructureError("audio_flat");
  const regions = findSpeechRegions(envDb, hopMs, th);
  if (regions.length === 0) throw new IntroStructureError("audio_flat");

  // Trenn-Pause: erste Lücke >= PAUSE_MIN nach >= GREETING_MIN
  // akkumulierter Sprechzeit, deren Beginn im Anrede-Fenster liegt.
  // Die Lücke NACH der letzten Region (bis Analyse-Ende) zählt mit —
  // so wird „Anrede, danach nur Stille" als no_sentence_after_pause
  // statt fälschlich als greeting_too_late gemeldet.
  const totalMs = envDb.length * hopMs;
  const speechStartMs = regions[0].startMs;
  let accumulatedMs = 0;
  let pauseIdx = -1;
  for (let i = 0; i < regions.length; i++) {
    accumulatedMs += regions[i].endMs - regions[i].startMs;
    const gapMs =
      (i + 1 < regions.length ? regions[i + 1].startMs : totalMs) -
      regions[i].endMs;
    if (
      accumulatedMs >= GREETING_MIN_MS &&
      regions[i].endMs <= GREETING_MAX_MS &&
      gapMs >= PAUSE_MIN_MS
    ) {
      pauseIdx = i;
      break;
    }
    if (regions[i].endMs > GREETING_MAX_MS) break;
  }
  if (pauseIdx === -1) throw new IntroStructureError("greeting_too_late");

  const greetingEndMs = regions[pauseIdx].endMs;
  const sentenceStartMs = regions[pauseIdx + 1]?.startMs;
  if (sentenceStartMs === undefined) {
    throw new IntroStructureError("no_sentence_after_pause");
  }

  // Pegel-Validierung: Anrede-Regionen vs. erste 1,5s des Satzes.
  const greetingRegions = regions.slice(0, pauseIdx + 1);
  const greetingMeanDb =
    greetingRegions.reduce(
      (s, r) => s + r.meanDb * (r.endMs - r.startMs),
      0,
    ) / greetingRegions.reduce((s, r) => s + (r.endMs - r.startMs), 0);
  const sentenceWindowEnd = sentenceStartMs + SENTENCE_MIN_MS;
  const sentenceRegions = regions
    .slice(pauseIdx + 1)
    .filter((r) => r.startMs < sentenceWindowEnd);
  const sentenceMeanDb =
    sentenceRegions.length > 0
      ? sentenceRegions.reduce(
          (s, r) => s + r.meanDb * (r.endMs - r.startMs),
          0,
        ) / sentenceRegions.reduce((s, r) => s + (r.endMs - r.startMs), 0)
      : th.speechLevelDb;
  if (
    greetingMeanDb <
    sentenceMeanDb - GREETING_MAX_QUIETER_THAN_SENTENCE_DB
  ) {
    throw new IntroStructureError("greeting_inaudible");
  }

  // Satz-Ende: erste Lücke >= Tier nach >= SENTENCE_MIN ab sentenceStart;
  // gestuft von komfortabel (240ms) zu knapp (80ms). Cap bei SENTENCE_MAX,
  // synthetic +5s wenn gar keine Lücke existiert.
  let anchorEndMs: number | null = null;
  let breathGapEndMs: number | null = null;
  for (const tierMs of BREATH_GAP_TIERS_MS) {
    for (let i = pauseIdx + 1; i < regions.length - 1; i++) {
      const gapMs = regions[i + 1].startMs - regions[i].endMs;
      if (
        regions[i].endMs >= sentenceStartMs + SENTENCE_MIN_MS &&
        gapMs >= tierMs
      ) {
        anchorEndMs = regions[i].endMs;
        breathGapEndMs = regions[i + 1].startMs;
        break;
      }
    }
    if (anchorEndMs !== null) break;
  }
  if (anchorEndMs === null) {
    const last = regions[regions.length - 1];
    anchorEndMs =
      last.endMs >= sentenceStartMs + SENTENCE_MIN_MS
        ? last.endMs
        : sentenceStartMs + 5000;
  }
  if (anchorEndMs - sentenceStartMs > SENTENCE_MAX_MS) {
    anchorEndMs = sentenceStartMs + SENTENCE_MAX_MS;
    breathGapEndMs = null;
  }

  return {
    speechStartMs,
    greetingEndMs,
    sentenceStartMs,
    anchorEndMs,
    breathGapEndMs,
    pause: { startMs: greetingEndMs, endMs: sentenceStartMs },
    greetingMeanDb,
    sentenceMeanDb,
  };
}

/**
 * Schnittpunkt hinter der Anrede in einem Carrier-TTS („Hi Julia! Schön,
 * dass du reinschaust."): erste Lücke >= `minGapMs` nach mindestens
 * `minSpeechMs` Sprechzeit. Rückgabe in ms (leicht in die Lücke hinein,
 * damit der Ausklang des Namens erhalten bleibt) oder null.
 */
export function findTtsCutMs(
  envDb: number[],
  hopMs: number,
  opts?: { minSpeechMs?: number; minGapMs?: number },
): number | null {
  const minSpeechMs = opts?.minSpeechMs ?? 350;
  const minGapMs = opts?.minGapMs ?? 100;
  const regions = findSpeechRegions(envDb, hopMs);
  let accumulatedMs = 0;
  for (let i = 0; i < regions.length - 1; i++) {
    accumulatedMs += regions[i].endMs - regions[i].startMs;
    const gapMs = regions[i + 1].startMs - regions[i].endMs;
    if (accumulatedMs >= minSpeechMs && gapMs >= minGapMs) {
      return regions[i].endMs + Math.min(60, Math.floor(gapMs / 2));
    }
  }
  return null;
}
