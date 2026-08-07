/**
 * Tests für die adaptive Intro-Struktur-Analyse.
 *
 * Zentraler Regressionsfall: Incident 2026-08-07 — Webcam-AGC-Rauschteppich
 * bei −33 dB in 0–1,16s wurde von der alten absoluten −35dB-Schwelle als
 * „Anrede" kalibriert, das echte „Hi!" bei ~1,16s überlebte den Cut →
 * doppelte Begrüßung. Die adaptive Schwelle muss das Rauschen ignorieren.
 */
import { describe, expect, it } from "vitest";
import {
  computeEnvelopeDb,
  computeAdaptiveThreshold,
  findSpeechRegions,
  analyzeIntroStructure,
  findTtsCutMs,
  IntroStructureError,
} from "./intro-structure";

const HOP_MS = 10;

/** Baut eine Hüllkurve aus [dauerMs, pegelDb]-Segmenten (hop 10ms). */
function env(segments: Array<[number, number]>): number[] {
  const out: number[] = [];
  for (const [durMs, db] of segments) {
    const frames = Math.round(durMs / HOP_MS);
    for (let i = 0; i < frames; i++) out.push(db);
  }
  return out;
}

describe("computeEnvelopeDb", () => {
  it("Stille → sehr niedriger Pegel, Vollaussteuerung → nahe 0 dB", () => {
    const sr = 48000;
    const silent = Buffer.alloc(sr * 2); // 1s Stille s16le
    const loud = Buffer.alloc(sr * 2);
    for (let i = 0; i < sr; i++) {
      loud.writeInt16LE(
        Math.round(Math.sin((2 * Math.PI * 440 * i) / sr) * 32000),
        i * 2,
      );
    }
    const silentEnv = computeEnvelopeDb(silent, sr);
    const loudEnv = computeEnvelopeDb(loud, sr);
    expect(Math.max(...silentEnv)).toBeLessThan(-90);
    const mid = loudEnv[Math.floor(loudEnv.length / 2)];
    expect(mid).toBeGreaterThan(-6);
    expect(mid).toBeLessThan(0);
  });
});

describe("computeAdaptiveThreshold", () => {
  it("liegt zwischen Rauschboden und Sprech-Pegel", () => {
    const e = env([
      [2000, -50],
      [3000, -18],
    ]);
    const th = computeAdaptiveThreshold(e);
    expect(th).not.toBeNull();
    expect(th!.thresholdDb).toBeGreaterThan(th!.noiseFloorDb);
    expect(th!.thresholdDb).toBeLessThan(th!.speechLevelDb);
  });

  it("null bei flachem Audio (keine Dynamik)", () => {
    expect(computeAdaptiveThreshold(env([[5000, -50]]))).toBeNull();
  });
});

describe("analyzeIntroStructure — Incident-Regressionsfall (AGC-Rauschen)", () => {
  it("Rauschteppich −33 dB vor dem echten „Hi!“ wird NICHT als Anrede erkannt", () => {
    // Nachbau des Daniel-Videos: 0–1,16s Rauschen knapp über der alten
    // −35dB-Schwelle, echtes „Hi!" 1,16–1,8s, Pause, erster Satz ab 2,6s.
    const e = env([
      [1160, -33], // AGC-Rauschteppich (alte Kalibrierung: „Anrede 0–865ms")
      [640, -18],  // echtes „Hi!"
      [800, -33],  // bewusste Pause
      [5000, -17], // erster Satz
      [200, -33],  // Atempause
      [2000, -18], // weiter
    ]);
    const s = analyzeIntroStructure(e, HOP_MS);
    expect(s.speechStartMs).toBe(1160);
    expect(s.greetingEndMs).toBe(1800);
    expect(s.sentenceStartMs).toBe(2600);
    expect(s.anchorEndMs).toBe(7600);
    expect(s.breathGapEndMs).toBe(7800);
    expect(s.pause).toEqual({ startMs: 1800, endMs: 2600 });
  });

  it("audio_flat bei durchgehend gleichem Pegel", () => {
    expect(() => analyzeIntroStructure(env([[10000, -40]]), HOP_MS)).toThrow(
      IntroStructureError,
    );
    try {
      analyzeIntroStructure(env([[10000, -40]]), HOP_MS);
    } catch (err) {
      expect((err as IntroStructureError).code).toBe("audio_flat");
    }
  });

  it("greeting_inaudible wenn die „Anrede“ nur Rauschen/viel leiser als der Satz ist", () => {
    const e = env([
      [500, -40],  // sehr leises Gemurmel/Atmer als „Anrede"
      [600, -60],  // Pause
      [5000, -20], // lauter erster Satz
      [200, -60],
      [1000, -20],
    ]);
    try {
      analyzeIntroStructure(e, HOP_MS);
      expect.unreachable("sollte werfen");
    } catch (err) {
      expect((err as IntroStructureError).code).toBe("greeting_inaudible");
    }
  });

  it("greeting_too_late wenn der User ohne Trenn-Pause durchspricht", () => {
    const e = env([
      [7000, -18], // durchgesprochen, keine Pause im 5s-Fenster
      [2000, -55],
    ]);
    try {
      analyzeIntroStructure(e, HOP_MS);
      expect.unreachable("sollte werfen");
    } catch (err) {
      expect((err as IntroStructureError).code).toBe("greeting_too_late");
    }
  });

  it("no_sentence_after_pause wenn nach der Pause nichts mehr kommt", () => {
    const e = env([
      [600, -18],  // „Hi!"
      [3000, -55], // dann nur noch Stille
    ]);
    try {
      analyzeIntroStructure(e, HOP_MS);
      expect.unreachable("sollte werfen");
    } catch (err) {
      expect((err as IntroStructureError).code).toBe("no_sentence_after_pause");
    }
  });

  it("synthetisches Satz-Ende wenn der User lange durchspricht", () => {
    const e = env([
      [600, -18],   // Anrede
      [400, -55],   // Pause
      [20000, -18], // sehr langer Satz ohne Atempause
      [6000, -55],  // genug Stille, damit P10 den Rauschboden trifft
    ]);
    const s = analyzeIntroStructure(e, HOP_MS);
    // Cap bei SENTENCE_MAX (15s) nach Satzbeginn.
    expect(s.anchorEndMs).toBe(s.sentenceStartMs + 15000);
  });
});

describe("findSpeechRegions", () => {
  it("merged Mikro-Lücken und verwirft Klicks", () => {
    const e = env([
      [500, -18],
      [40, -60],  // Mikro-Lücke ≤50ms → merge
      [500, -18],
      [1000, -60],
      [60, -18],  // 60ms-Klick → verworfen
      [1000, -60],
      [2000, -18],
    ]);
    const regions = findSpeechRegions(e, HOP_MS);
    expect(regions).toHaveLength(2);
    expect(regions[0].startMs).toBe(0);
    expect(regions[0].endMs).toBe(1040);
    expect(regions[1].endMs - regions[1].startMs).toBe(2000);
  });
});

describe("findTtsCutMs — Schnittpunkt hinter Carrier-Anrede", () => {
  it("findet die Lücke nach „Hi Julia!“ und schneidet leicht in sie hinein", () => {
    const e = env([
      [600, -18],  // „Hi Julia!"
      [200, -60],  // Lücke
      [1500, -18], // „Schön, dass du reinschaust."
      [300, -60],
    ]);
    const cut = findTtsCutMs(e, HOP_MS);
    expect(cut).toBe(660); // 600 + min(60, 100)
  });

  it("null wenn keine Lücke existiert", () => {
    const e = env([
      [3000, -18],
      [100, -60], // Rest-Lücke am Ende, aber keine Region danach
    ]);
    expect(findTtsCutMs(e, HOP_MS)).toBeNull();
  });
});
