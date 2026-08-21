/**
 * ASR-basierte Struktur-Erkennung der Intro-Aufnahme.
 *
 * Warum: Die reine Energie-Analyse (intro-structure.ts) scheitert, wenn die
 * bewusste Pause des Users akustisch nicht leise ist — Webcam-AGC zieht in
 * Sprechpausen den Gain hoch, Atmen/Raumrauschen liegt dann nahe am
 * Sprech-Pegel (Incident 2026-08-21: 1,2s echte Pause nach „Hey", aber
 * Pausen-Pegel ~-29 dB bei Sprech-Pegel ~-20 dB → als durchgehende Sprache
 * gewertet → greeting_too_late, obwohl der User alles richtig gemacht hat).
 *
 * ASR-Wort-Timestamps (Fish /v1/asr) erkennen Wortgrenzen unabhängig vom
 * Pegel: „Hey" 1,12–1,76s, nächstes Wort „ich" ab 2,64s → 880ms Wort-Lücke
 * = die Pause. Die Energie-Hüllkurve bleibt für Feinarbeit zuständig
 * (Roomtone-Auswahl, Pegel-Referenzen), entscheidet aber nicht mehr über
 * die Struktur.
 *
 * Alle Funktionen sind pure (keine I/O) und unit-getestet.
 */

import { IntroStructureError, type IntroStructure } from "./intro-structure";

export interface AsrWord {
  text: string;
  startMs: number;
  endMs: number;
}

/**
 * Wort-Lücke, die als bewusste Trenn-Pause nach der Anrede zählt. ASR-
 * Wortgrenzen sind großzügig (schleppen Ausklang mit), flüssige Sprache
 * hat Wort-Lücken von 0–250ms — 350ms trennt sauber. Die instruierte
 * 1–2s-Pause liegt weit darüber.
 */
const ASR_PAUSE_MIN_MS = 350;
/** Anrede-Pause muss vor dieser Marke beginnen (wie Envelope-Pfad). */
const GREETING_MAX_MS = 5000;
/** Max. Wörter, die als Anrede gelten („Guten Morgen zusammen"). */
const GREETING_MAX_WORDS = 4;
/** Erster Satz: Mindestdauer, bevor eine Atempause als Satzende zählt. */
const SENTENCE_MIN_MS = 1500;
const SENTENCE_MAX_MS = 15000;
/** Atempausen-Suche nach dem ersten Satz, gestuft wie im Envelope-Pfad. */
const BREATH_GAP_TIERS_MS = [240, 120, 80];

/**
 * Begrüßungs-Lexikon (lowercase, ohne Satzzeichen). Nur wenn die Aufnahme
 * mit solchen Wörtern beginnt, wird die erste Wort-Lücke als Anrede-Pause
 * interpretiert — sonst würde ein Zögern mitten im Satz („Hey ich … ähm")
 * fälschlich als Cut-Punkt gelten und die TTS-Anrede ersetzt halbe Sätze.
 */
const GREETING_WORDS = new Set([
  "hi",
  "hii",
  "hey",
  "heey",
  "hallo",
  "halli",
  "hallihallo",
  "hallöchen",
  "moin",
  "moinsen",
  "servus",
  "servas",
  "na",
  "hoi",
  "huhu",
  "hej",
  "grüezi",
  "grüzi",
  "grüß",
  "gruess",
  "gott",
  "dich",
  "sie",
  "euch",
  "guten",
  "morgen",
  "tag",
  "abend",
  "mahlzeit",
  "zusammen",
  "salut",
  "ciao",
  "hello",
]);

function normalizeWord(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-zäöüß]/g, "")
    .trim();
}

/** True, wenn das Wort als Teil einer Anrede durchgeht. */
export function isGreetingWord(text: string): boolean {
  const n = normalizeWord(text);
  return n.length > 0 && GREETING_WORDS.has(n);
}

/**
 * Fish-ASR-Segmente (Sekunden, float) → validierte Wortliste in ms.
 * Filtert leere Texte und kaputte Timestamps (end < start, beides 0 bei
 * mehr als einem Wort ist ok — einzelne 0-Dauer-Wörter behalten wir, Fish
 * liefert die gelegentlich).
 */
export function asrSegmentsToWords(
  segments: Array<{ text: string; start: number; end: number }>,
): AsrWord[] {
  const words: AsrWord[] = [];
  for (const s of segments) {
    const text = s.text.trim();
    if (!text) continue;
    const startMs = Math.round(s.start * 1000);
    const endMs = Math.round(s.end * 1000);
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) continue;
    if (endMs < startMs) continue;
    words.push({ text, startMs, endMs: Math.max(endMs, startMs) });
  }
  words.sort((a, b) => a.startMs - b.startMs);
  return words;
}

/** Transkript-Anfang für Fehlermeldungen („Gehört haben wir: …"). */
export function transcriptHead(words: AsrWord[], maxWords = 12): string {
  const head = words.slice(0, maxWords).map((w) => w.text).join(" ");
  return words.length > maxWords ? `${head} …` : head;
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = cur;
  }
  return prev[b.length];
}

/**
 * Fuzzy-Check: hört die ASR alle erwarteten Tokens (z. B. den Lead-Namen)?
 * Toleriert kleine Transkriptions-Abweichungen (Levenshtein ≤1 bei kurzen,
 * ≤2 bei längeren Tokens) — ASR schreibt Eigennamen oft leicht anders
 * („Aksel" statt „Axel"). Leere Token-Liste oder leerer ASR-Text → true
 * (best effort, kein Urteil möglich).
 */
export function asrHearsTokens(asrText: string, tokens: string[]): boolean {
  const heard = asrText
    .split(/\s+/)
    .map(normalizeWord)
    .filter((w) => w.length > 0);
  if (heard.length === 0) return true;
  for (const token of tokens) {
    const want = normalizeWord(token);
    if (want.length === 0) continue;
    const maxDist = want.length <= 3 ? 1 : 2;
    const hit = heard.some((w) => levenshtein(w, want) <= maxDist);
    if (!hit) return false;
  }
  return true;
}

/**
 * Struktur (Anrede → Pause → erster Satz → Atempause) aus ASR-Wörtern.
 *
 * Wirft `IntroStructureError` mit sprechendem Code:
 *   - `audio_flat`               keine Wörter erkannt (Aufrufer fällt auf
 *                                Envelope-Analyse zurück)
 *   - `greeting_not_recognized`  Aufnahme beginnt nicht mit einer Anrede
 *                                (Hi/Hey/Hallo/…)
 *   - `no_pause_detected`        Anrede erkannt, aber durchgesprochen —
 *                                keine Wort-Lücke ≥ 350ms
 *   - `greeting_too_late`        die Anrede-Pause beginnt erst nach 5s
 *   - `no_sentence_after_pause`  nach der Anrede kommt kein Satz mehr
 *
 * Pegel-Felder (greetingMeanDb/sentenceMeanDb) werden aus der Hüllkurve
 * über den Wort-Spannen gemittelt — rein informativ, keine Validierung
 * (die ASR hat die Wörter gehört, also sind sie hörbar).
 */
export function analyzeIntroStructureFromAsr(
  words: AsrWord[],
  envDb: number[],
  hopMs: number,
): IntroStructure {
  if (words.length === 0) throw new IntroStructureError("audio_flat");

  if (!isGreetingWord(words[0].text)) {
    throw new IntroStructureError("greeting_not_recognized");
  }

  // Anrede-Lauf: führende Lexikon-Wörter; die erste Lücke ≥ 350ms darin
  // (oder direkt danach) ist die Trenn-Pause.
  let splitIdx = -1;
  let sawLateGap = false;
  const runLen = (() => {
    let n = 0;
    while (
      n < words.length &&
      n < GREETING_MAX_WORDS &&
      isGreetingWord(words[n].text)
    ) {
      n++;
    }
    return n;
  })();
  for (let i = 0; i < runLen; i++) {
    const next = words[i + 1];
    if (!next) break;
    const gapMs = next.startMs - words[i].endMs;
    if (gapMs >= ASR_PAUSE_MIN_MS) {
      if (words[i].endMs > GREETING_MAX_MS) {
        sawLateGap = true;
        break;
      }
      splitIdx = i;
      break;
    }
  }
  if (splitIdx === -1) {
    if (runLen >= words.length) {
      // Nur Anrede gesprochen, danach nichts mehr.
      throw new IntroStructureError("no_sentence_after_pause");
    }
    throw new IntroStructureError(
      sawLateGap ? "greeting_too_late" : "no_pause_detected",
    );
  }

  const greetingWords = words.slice(0, splitIdx + 1);
  const speechStartMs = words[0].startMs;
  const greetingEndMs = words[splitIdx].endMs;
  const sentenceStartMs = words[splitIdx + 1].startMs;

  // Satz-Ende: gestufte Atempausen-Suche über Wort-Lücken.
  let anchorEndMs: number | null = null;
  let breathGapEndMs: number | null = null;
  for (const tierMs of BREATH_GAP_TIERS_MS) {
    for (let i = splitIdx + 1; i < words.length - 1; i++) {
      const gapMs = words[i + 1].startMs - words[i].endMs;
      if (
        words[i].endMs >= sentenceStartMs + SENTENCE_MIN_MS &&
        gapMs >= tierMs
      ) {
        anchorEndMs = words[i].endMs;
        breathGapEndMs = words[i + 1].startMs;
        break;
      }
    }
    if (anchorEndMs !== null) break;
  }
  if (anchorEndMs === null) {
    const last = words[words.length - 1];
    anchorEndMs =
      last.endMs >= sentenceStartMs + SENTENCE_MIN_MS
        ? last.endMs
        : sentenceStartMs + 5000;
  }
  if (anchorEndMs - sentenceStartMs > SENTENCE_MAX_MS) {
    anchorEndMs = sentenceStartMs + SENTENCE_MAX_MS;
    breathGapEndMs = null;
  }

  const meanDbOver = (spans: AsrWord[]): number => {
    let sum = 0;
    let n = 0;
    for (const s of spans) {
      const from = Math.floor(s.startMs / hopMs);
      const to = Math.min(envDb.length, Math.ceil(s.endMs / hopMs));
      for (let i = from; i < to; i++) {
        sum += envDb[i];
        n++;
      }
    }
    return n > 0 ? sum / n : -100;
  };
  const sentenceWords = words
    .slice(splitIdx + 1)
    .filter((w) => w.startMs < sentenceStartMs + SENTENCE_MIN_MS);

  return {
    speechStartMs,
    greetingEndMs,
    sentenceStartMs,
    anchorEndMs,
    breathGapEndMs,
    pause: { startMs: greetingEndMs, endMs: sentenceStartMs },
    greetingMeanDb: meanDbOver(greetingWords),
    sentenceMeanDb: meanDbOver(sentenceWords),
  };
}

/**
 * Transkript des ersten Satzes aus den ASR-Wörtern im Fenster
 * [sentenceStartMs, anchorEndMs] — spart den zweiten ASR-Call der
 * Kalibrierung.
 */
export function sentenceTranscriptFromWords(
  words: AsrWord[],
  sentenceStartMs: number,
  anchorEndMs: number,
): string | null {
  const inWindow = words.filter(
    (w) => w.startMs >= sentenceStartMs - 50 && w.startMs < anchorEndMs,
  );
  const text = inWindow.map((w) => w.text).join(" ").trim();
  return text.length > 0 ? text : null;
}

/**
 * Leisestes Teilfenster der Länge `winMs` innerhalb [startMs, endMs] der
 * Hüllkurve — für die Roomtone-Wahl (die Mitte der Pause kann Atmer
 * enthalten; das leiseste Fenster nicht). Rückgabe: Fensterstart in ms.
 */
export function findQuietestWindowMs(
  envDb: number[],
  hopMs: number,
  startMs: number,
  endMs: number,
  winMs: number,
): number {
  const from = Math.max(0, Math.floor(startMs / hopMs));
  const to = Math.min(envDb.length, Math.ceil(endMs / hopMs));
  const win = Math.max(1, Math.round(winMs / hopMs));
  if (to - from <= win) return startMs;
  let best = from;
  let bestSum = Infinity;
  let sum = 0;
  for (let i = from; i < from + win; i++) sum += envDb[i];
  bestSum = sum;
  for (let i = from + win; i < to; i++) {
    sum += envDb[i] - envDb[i - win];
    if (sum < bestSum) {
      bestSum = sum;
      best = i - win + 1;
    }
  }
  return best * hopMs;
}
