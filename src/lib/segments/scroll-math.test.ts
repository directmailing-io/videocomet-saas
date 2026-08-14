import { describe, expect, it } from "vitest";
import {
  buildAutoScrollFrames,
  interpolateScrollRatio,
} from "./scroll-math";
import type { ScrollFrame } from "./types";

describe("interpolateScrollRatio", () => {
  const frames: ScrollFrame[] = [
    { t: 1000, y: 0.2 },
    { t: 2000, y: 0.6 },
    { t: 3000, y: 1 },
  ];

  it("liefert vor dem ersten Frame dessen y", () => {
    expect(interpolateScrollRatio(frames, 0)).toBe(0.2);
    expect(interpolateScrollRatio(frames, 999)).toBe(0.2);
  });

  it("liefert nach dem letzten Frame dessen y", () => {
    expect(interpolateScrollRatio(frames, 3000)).toBe(1);
    expect(interpolateScrollRatio(frames, 99_999)).toBe(1);
  });

  it("interpoliert linear zwischen zwei Frames", () => {
    // Mitte zwischen t=1000 (0.2) und t=2000 (0.6) → 0.4.
    expect(interpolateScrollRatio(frames, 1500)).toBeCloseTo(0.4, 10);
    // Viertel zwischen t=2000 (0.6) und t=3000 (1) → 0.7.
    expect(interpolateScrollRatio(frames, 2250)).toBeCloseTo(0.7, 10);
  });

  it("sortiert unsortierte Frames vor der Interpolation", () => {
    const unsorted: ScrollFrame[] = [
      { t: 3000, y: 1 },
      { t: 1000, y: 0.2 },
      { t: 2000, y: 0.6 },
    ];
    expect(interpolateScrollRatio(unsorted, 1500)).toBeCloseTo(0.4, 10);
    expect(interpolateScrollRatio(unsorted, 0)).toBe(0.2);
  });

  it("liefert 0 für leere oder fehlende Frame-Listen", () => {
    expect(interpolateScrollRatio([], 1234)).toBe(0);
    expect(interpolateScrollRatio(undefined, 1234)).toBe(0);
  });
});

describe("buildAutoScrollFrames", () => {
  it("linear: startet bei 0, endet bei 1, mit Lead-in und Lead-out", () => {
    const frames = buildAutoScrollFrames(10_000, { style: "linear" });
    expect(frames[0]).toEqual({ t: 0, y: 0 });
    expect(frames[frames.length - 1]).toEqual({ t: 10_000, y: 1 });
    // Lead-in: bis 800 ms bleibt die Position oben.
    expect(frames[1]).toEqual({ t: 800, y: 0 });
    // Lead-out: ab 10_000 - 800 = 9_200 ms ist die Position unten.
    expect(frames[2]).toEqual({ t: 9200, y: 1 });
  });

  it("linear: y ist monoton steigend über die Zeit", () => {
    const frames = buildAutoScrollFrames(10_000, { style: "linear" });
    for (let i = 1; i < frames.length; i++) {
      expect(frames[i].t).toBeGreaterThanOrEqual(frames[i - 1].t);
      expect(frames[i].y).toBeGreaterThanOrEqual(frames[i - 1].y);
    }
  });

  it("paged: erster Frame y=0, letzter Frame y=1, Zeiten monoton steigend", () => {
    const frames = buildAutoScrollFrames(12_000, {
      style: "paged",
      pageCount: 4,
    });
    expect(frames[0]).toEqual({ t: 0, y: 0 });
    expect(frames[frames.length - 1]).toEqual({ t: 12_000, y: 1 });
    for (let i = 1; i < frames.length; i++) {
      expect(frames[i].t).toBeGreaterThanOrEqual(frames[i - 1].t);
      // y darf pro Seite verweilen (gleich bleiben), aber nie zurückspringen.
      expect(frames[i].y).toBeGreaterThanOrEqual(frames[i - 1].y);
    }
  });

  it("paged: enthält pro Seite eine Verweilphase (y bleibt konstant)", () => {
    const frames = buildAutoScrollFrames(12_000, {
      style: "paged",
      pageCount: 3,
    });
    // Jede Seite außer der letzten hat zwei Frames mit identischem y
    // (Slot-Start + Slot-Ende vor dem Übergang).
    const uniqueYs = new Set(frames.map((f) => f.y));
    expect(uniqueYs.size).toBe(3); // 0, 0.5, 1
    expect(frames.length).toBeGreaterThan(uniqueYs.size);
  });

  it("fällt bei zu kurzer Dauer auf ein Standbild (y=0) zurück", () => {
    // Dauer < Lead-in + Lead-out → kein Scroll-Spielraum.
    const frames = buildAutoScrollFrames(1000, { style: "linear" });
    expect(frames).toEqual([
      { t: 0, y: 0 },
      { t: 1000, y: 0 },
    ]);
  });
});
