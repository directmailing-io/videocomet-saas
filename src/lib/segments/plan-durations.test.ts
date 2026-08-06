import { describe, expect, it } from "vitest";
import { planSegmentDurations } from "./plan-durations";

const seg = (durationMs: number, id = "s") => ({ id, durationMs });

describe("planSegmentDurations", () => {
  it("ohne Intro-Trim: Dauern bleiben unverändert, Budget passt exakt", () => {
    const plan = planSegmentDurations(
      [seg(10_000, "a"), seg(20_000, "b"), seg(30_000, "c")],
      60,
    );
    expect(plan.planned.map((p) => p.durationMs)).toEqual([
      10_000, 20_000, 30_000,
    ]);
    expect(plan.absorbedTrimMs).toBe(0);
    expect(plan.unabsorbedTrimMs).toBe(0);
  });

  it("Budget-Clamp: letztes passendes Segment gekürzt, Rest verworfen", () => {
    const plan = planSegmentDurations(
      [seg(10_000, "a"), seg(20_000, "b"), seg(30_000, "c")],
      25,
    );
    expect(plan.planned.map((p) => p.durationMs)).toEqual([10_000, 15_000]);
  });

  it("Intro-Trim wird komplett vom ersten Segment absorbiert", () => {
    // Webcam um 1.8s getrimmt → Segment 1 um exakt 1800ms kürzer, alle
    // späteren Segmentwechsel liegen dadurch 1800ms früher (synchron zur
    // früher liegenden Sprache).
    const plan = planSegmentDurations(
      [seg(10_000, "a"), seg(20_000, "b"), seg(30_000, "c")],
      58.2,
      1_800,
    );
    expect(plan.planned.map((p) => p.durationMs)).toEqual([
      8_200, 20_000, 30_000,
    ]);
    expect(plan.absorbedTrimMs).toBe(1_800);
    expect(plan.unabsorbedTrimMs).toBe(0);
    // Gesamtdauer == getrimmte Webcam-Dauer → kein End-Truncate.
    const total = plan.planned.reduce((s, p) => s + p.durationMs, 0);
    expect(total).toBe(58_200);
  });

  it("Kaskade: Trim größer als Segment 1 → Rest aus Segment 2, min 200ms bleibt", () => {
    const plan = planSegmentDurations(
      [seg(1_000, "a"), seg(5_000, "b"), seg(10_000, "c")],
      13.5,
      2_500,
    );
    // Segment 1: 1000 → 200 (800 absorbiert), Segment 2: 5000 → 3300 (1700).
    expect(plan.planned.map((p) => p.durationMs)).toEqual([200, 3_300, 10_000]);
    expect(plan.absorbedTrimMs).toBe(2_500);
    expect(plan.unabsorbedTrimMs).toBe(0);
  });

  it("nicht absorbierbarer Rest wird gemeldet, Budget-Clamp greift am Ende", () => {
    const plan = planSegmentDurations(
      [seg(300, "a"), seg(300, "b")],
      0.2,
      5_000,
    );
    expect(plan.absorbedTrimMs).toBe(200);
    expect(plan.unabsorbedTrimMs).toBe(4_800);
    // Budget 200ms → nur ein Segment mit 200ms überlebt.
    expect(plan.planned.map((p) => p.durationMs)).toEqual([200]);
  });

  it("introTrimMs=0 ist neutral", () => {
    const plan = planSegmentDurations([seg(4_000, "a")], 4, 0);
    expect(plan.planned.map((p) => p.durationMs)).toEqual([4_000]);
    expect(plan.absorbedTrimMs).toBe(0);
    expect(plan.extendedLeadMs).toBe(0);
  });

  it("negativer introTrimMs (Intro hat Video verlängert) streckt Segment 1", () => {
    // TTS war 900ms länger als die Anrede-Zone → Video vorne verlängert,
    // Sprache liegt später. Segment 1 wird um exakt 900ms gestreckt,
    // damit alle späteren Segmentwechsel wieder synchron liegen.
    const plan = planSegmentDurations(
      [seg(10_000, "a"), seg(20_000, "b")],
      30.9,
      -900,
    );
    expect(plan.planned.map((p) => p.durationMs)).toEqual([10_900, 20_000]);
    expect(plan.extendedLeadMs).toBe(900);
    expect(plan.absorbedTrimMs).toBe(0);
    expect(plan.unabsorbedTrimMs).toBe(0);
    const total = plan.planned.reduce((s, p) => s + p.durationMs, 0);
    expect(total).toBe(30_900);
  });

  it("negativer introTrimMs ohne Segmente ist ein No-op", () => {
    const plan = planSegmentDurations([], 10, -900);
    expect(plan.planned).toEqual([]);
    expect(plan.extendedLeadMs).toBe(0);
  });

  it("Segmente unter 200ms werden auf den Floor angehoben", () => {
    const plan = planSegmentDurations([seg(50, "a"), seg(1_000, "b")], 5);
    expect(plan.planned.map((p) => p.durationMs)).toEqual([200, 1_000]);
  });
});
