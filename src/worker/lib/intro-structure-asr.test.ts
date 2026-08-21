import { describe, expect, it } from "vitest";
import { IntroStructureError } from "./intro-structure";
import {
  asrHearsTokens,
  asrSegmentsToWords,
  analyzeIntroStructureFromAsr,
  sentenceTranscriptFromWords,
  transcriptHead,
  findQuietestWindowMs,
  isGreetingWord,
  type AsrWord,
} from "./intro-structure-asr";

const HOP = 10;
/** Flache Hüllkurve — Pegel-Felder sind informativ, nicht validierend. */
const flatEnv = (ms: number, db = -25): number[] =>
  new Array(Math.ceil(ms / HOP)).fill(db);

function w(text: string, startMs: number, endMs: number): AsrWord {
  return { text, startMs, endMs };
}

/**
 * Regression 2026-08-21: Daniels echte Aufnahme. Fish-ASR-Wort-Timestamps
 * (gemessen am Original-Video). 1,2s echte Pause nach „Hey", aber der
 * Pausen-Pegel lag bei ~-29 dB (AGC/Atmen) — die Envelope-Analyse warf
 * fälschlich greeting_too_late. Die ASR-Analyse MUSS diesen Fall lösen.
 */
const DANIEL_WORDS: AsrWord[] = [
  w("Hey", 1120, 1760),
  w("ich", 2640, 2640),
  w("nehme", 2800, 2960),
  w("dieses", 2960, 3360),
  w("kurze", 3360, 3680),
  w("Video", 3680, 3920),
  w("für", 3920, 4000),
  w("dich", 4000, 4160),
  w("auf", 4160, 4560),
  w("denn", 4720, 5120),
  w("ich", 5200, 5440),
  w("bin", 5440, 5680),
  w("gerade", 5680, 6080),
  w("auf", 6080, 6320),
  w("deiner", 6320, 6880),
  w("Webseite", 7280, 7920),
  w("die", 7920, 8160),
  w("mir", 8160, 8480),
  w("zugeschickt", 8480, 9040),
  w("wurde", 9040, 9280),
  w("von", 9280, 9520),
  w("einem", 9520, 10160),
  w("Kunden", 10560, 11280),
  w("von", 11280, 11520),
  w("mir", 11520, 12000),
];

describe("Regression 2026-08-21 — Daniels Aufnahme (der Produktions-Fall)", () => {
  it("erkennt die Struktur, an der die Envelope-Analyse scheiterte", () => {
    const s = analyzeIntroStructureFromAsr(DANIEL_WORDS, flatEnv(40000), HOP);
    expect(s.speechStartMs).toBe(1120);
    expect(s.greetingEndMs).toBe(1760); // „Hey" endet
    expect(s.sentenceStartMs).toBe(2640); // „ich" beginnt — 880ms Pause
    expect(s.pause).toEqual({ startMs: 1760, endMs: 2640 });
    // Atempause: erste Lücke ≥240ms nach ≥1,5s Satz = „deiner"→„Webseite"
    expect(s.anchorEndMs).toBe(6880);
    expect(s.breathGapEndMs).toBe(7280);
  });

  it("liefert das Satz-Transkript ohne zweiten ASR-Call", () => {
    const s = analyzeIntroStructureFromAsr(DANIEL_WORDS, flatEnv(40000), HOP);
    expect(
      sentenceTranscriptFromWords(DANIEL_WORDS, s.sentenceStartMs, s.anchorEndMs),
    ).toBe("ich nehme dieses kurze Video für dich auf denn ich bin gerade auf deiner");
  });
});

describe("asrSegmentsToWords", () => {
  it("konvertiert Sekunden → ms, filtert leere/kaputte Segmente, sortiert", () => {
    const words = asrSegmentsToWords([
      { text: " Hey ", start: 1.12, end: 1.76 },
      { text: "", start: 2.0, end: 2.1 },
      { text: "kaputt", start: 3.0, end: 2.0 },
      { text: "ich", start: 2.64, end: 2.64 },
    ]);
    expect(words).toEqual([
      w("Hey", 1120, 1760),
      w("ich", 2640, 2640),
    ]);
  });
});

describe("isGreetingWord", () => {
  it.each(["Hi", "hey,", "HALLO!", "Moin", "Servus", "Guten", "Na"])(
    "akzeptiert %s",
    (word) => {
      expect(isGreetingWord(word)).toBe(true);
    },
  );
  it.each(["ich", "Sebastian", "also", "ähm", ""])(
    "lehnt %s ab",
    (word) => {
      expect(isGreetingWord(word)).toBe(false);
    },
  );
});

describe("analyzeIntroStructureFromAsr — Fehlerfälle", () => {
  it("audio_flat bei leerer Wortliste (Aufrufer fällt auf Envelope zurück)", () => {
    expect(() => analyzeIntroStructureFromAsr([], flatEnv(1000), HOP)).toThrow(
      new IntroStructureError("audio_flat"),
    );
  });

  it("greeting_not_recognized, wenn die Aufnahme nicht mit einer Anrede beginnt", () => {
    const words = [
      w("Also", 500, 900),
      w("ich", 2000, 2200),
      w("wollte", 2250, 2500),
    ];
    expect(() =>
      analyzeIntroStructureFromAsr(words, flatEnv(5000), HOP),
    ).toThrow(new IntroStructureError("greeting_not_recognized"));
  });

  it("no_pause_detected bei Durchsprechen (alle Lücken < 350ms)", () => {
    const words = [
      w("Hey", 500, 900),
      w("ich", 1100, 1300), // 200ms Lücke — flüssige Sprache
      w("nehme", 1350, 1600),
      w("dieses", 1650, 1900),
      w("Video", 1950, 2300),
      w("auf", 2350, 2700),
    ];
    expect(() =>
      analyzeIntroStructureFromAsr(words, flatEnv(5000), HOP),
    ).toThrow(new IntroStructureError("no_pause_detected"));
  });

  it("greeting_too_late, wenn die Pause erst nach 5s beginnt", () => {
    // „Guten Morgen zusammen …" extrem gedehnt — Lexikon-Wörter, aber die
    // erste echte Lücke liegt hinter der 5s-Marke.
    const words = [
      w("Guten", 1000, 2800),
      w("Morgen", 3000, 5200),
      w("zusammen", 5400, 6200),
      w("ich", 7000, 7200),
    ];
    expect(() =>
      analyzeIntroStructureFromAsr(words, flatEnv(10000), HOP),
    ).toThrow(new IntroStructureError("greeting_too_late"));
  });

  it("no_sentence_after_pause, wenn nach der Anrede nichts mehr kommt", () => {
    const words = [w("Hallo", 500, 1000)];
    expect(() =>
      analyzeIntroStructureFromAsr(words, flatEnv(3000), HOP),
    ).toThrow(new IntroStructureError("no_sentence_after_pause"));
  });
});

describe("analyzeIntroStructureFromAsr — Strukturvarianten", () => {
  it("mehrwortige Anrede (Guten Morgen) mit Pause danach", () => {
    const words = [
      w("Guten", 400, 700),
      w("Morgen", 750, 1200),
      w("ich", 2000, 2200), // 800ms Lücke
      w("zeige", 2250, 2600),
      w("dir", 2650, 2900),
      w("heute", 2950, 3300),
      w("etwas", 3350, 3800),
      w("Neues", 3850, 4300),
      w("weiter", 4700, 5100), // 400ms Lücke nach ≥1,5s Satz
    ];
    const s = analyzeIntroStructureFromAsr(words, flatEnv(8000), HOP);
    expect(s.greetingEndMs).toBe(1200);
    expect(s.sentenceStartMs).toBe(2000);
    expect(s.anchorEndMs).toBe(4300);
    expect(s.breathGapEndMs).toBe(4700);
  });

  it("Pause INNERHALB des Anrede-Laufs wird genommen (Hey [Pause] hallo)", () => {
    const words = [
      w("Hey", 400, 800),
      w("hallo", 1800, 2200), // 1s Lücke im Lexikon-Lauf
      w("ich", 2300, 2500),
      w("rede", 2550, 2900),
      w("lange", 2950, 3400),
      w("weiter", 3450, 3900),
      w("hier", 3950, 4400),
    ];
    const s = analyzeIntroStructureFromAsr(words, flatEnv(8000), HOP);
    expect(s.greetingEndMs).toBe(800);
    expect(s.sentenceStartMs).toBe(1800);
  });

  it("synthetischer Anker (+5s), wenn der Satz zu kurz ist und nichts mehr folgt", () => {
    const words = [
      w("Hi", 400, 700),
      w("kurz", 1500, 1900), // 800ms Pause
    ];
    const s = analyzeIntroStructureFromAsr(words, flatEnv(8000), HOP);
    expect(s.sentenceStartMs).toBe(1500);
    expect(s.anchorEndMs).toBe(1500 + 5000);
    expect(s.breathGapEndMs).toBeNull();
  });

  it("Anker-Cap bei 15s Satzlänge", () => {
    const words: AsrWord[] = [w("Hi", 100, 400), w("los", 1000, 1400)];
    // 16s durchgehender „Satz" ohne nennenswerte Lücken
    for (let t = 1450; t < 18000; t += 250) {
      words.push(w("bla", t, t + 200));
    }
    const s = analyzeIntroStructureFromAsr(words, flatEnv(20000), HOP);
    expect(s.anchorEndMs).toBe(1000 + 15000);
    expect(s.breathGapEndMs).toBeNull();
  });

  it("gestufte Atempause: 240ms bevorzugt, Fallback auf 120ms", () => {
    const words = [
      w("Hi", 100, 400),
      w("erster", 1200, 1600), // 800ms Pause
      w("Satz", 1650, 2000),
      w("geht", 2050, 2400),
      w("weiter", 2450, 3200),
      w("hier", 3350, 3700), // Lücke 150ms nach ≥1,5s — nur Tier 120 greift
      w("Ende", 3800, 4200),
    ];
    const s = analyzeIntroStructureFromAsr(words, flatEnv(8000), HOP);
    expect(s.anchorEndMs).toBe(3200);
    expect(s.breathGapEndMs).toBe(3350);
  });
});

describe("transcriptHead", () => {
  it("kürzt lange Transkripte mit Ellipse", () => {
    expect(transcriptHead(DANIEL_WORDS, 4)).toBe("Hey ich nehme dieses …");
    expect(transcriptHead(DANIEL_WORDS.slice(0, 2))).toBe("Hey ich");
  });
});

describe("asrHearsTokens", () => {
  it("Incident 2026-08-21: TTS-Cut sagt nur Hey, Name Axel fehlt", () => {
    expect(asrHearsTokens("Hey.", ["Axel"])).toBe(false);
  });

  it("exakter Treffer und Interpunktion", () => {
    expect(asrHearsTokens("Hey, Axel!", ["Axel"])).toBe(true);
  });

  it("fuzzy: kleine ASR-Abweichung beim Eigennamen", () => {
    expect(asrHearsTokens("Hey Aksel!", ["Axel"])).toBe(true);
    expect(asrHearsTokens("Hallo Jurgen!", ["Jürgen"])).toBe(true);
  });

  it("mehrteilige Tokens (Anrede + Nachname) müssen alle hörbar sein", () => {
    expect(asrHearsTokens("Hallo Herr Müller!", ["Herr", "Müller"])).toBe(true);
    expect(asrHearsTokens("Hallo Herr!", ["Herr", "Müller"])).toBe(false);
  });

  it("völlig anderes Wort zählt nicht als Name", () => {
    expect(asrHearsTokens("Hey du!", ["Katharina"])).toBe(false);
  });

  it("best effort: leerer ASR-Text oder keine Tokens → true", () => {
    expect(asrHearsTokens("", ["Axel"])).toBe(true);
    expect(asrHearsTokens("Hey Axel", [])).toBe(true);
  });
});

describe("findQuietestWindowMs", () => {
  it("findet das leiseste Teilfenster (meidet den Atmer in der Pausen-Mitte)", () => {
    // Pause 1000–2000ms: Atmer bei 1400–1700 (-25dB), Rest -50dB.
    const env = flatEnv(3000, -50);
    for (let i = 140; i < 170; i++) env[i] = -25;
    const start = findQuietestWindowMs(env, HOP, 1000, 2000, 300);
    // Leisestes 300ms-Fenster darf den Atmer nicht enthalten.
    expect(start + 300 <= 1400 || start >= 1700).toBe(true);
  });

  it("fällt auf den Fensterstart zurück, wenn die Pause kürzer als das Fenster ist", () => {
    expect(findQuietestWindowMs(flatEnv(3000), HOP, 1000, 1100, 300)).toBe(1000);
  });
});
