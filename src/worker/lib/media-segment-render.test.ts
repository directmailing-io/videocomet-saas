import { describe, expect, it } from "vitest";
import { planVideoPieces } from "./media-segment-render";

describe("planVideoPieces", () => {
  it("leere Fenster → volles Play über die Segment-Dauer (Editor-Default)", () => {
    const pieces = planVideoPieces({
      windows: [],
      durationMs: 5000,
      trimStartMs: 0,
      sourceDurationMs: 60000,
    });
    expect(pieces).toEqual([{ type: "play", sourcePosMs: 0, durationMs: 5000 }]);
  });

  it("undefined Fenster (falls extern gerufen) → volles Play", () => {
    const pieces = planVideoPieces({
      windows: [] as never,
      durationMs: 3000,
      trimStartMs: 0,
      sourceDurationMs: 10000,
    });
    expect(pieces[0]?.type).toBe("play");
  });

  it("Video kürzer als Segment → Play + Freeze-Frame am Ende", () => {
    const pieces = planVideoPieces({
      windows: [],
      durationMs: 10000,
      trimStartMs: 0,
      sourceDurationMs: 3000,
    });
    expect(pieces).toEqual([
      { type: "play", sourcePosMs: 0, durationMs: 3000 },
      { type: "still", sourcePosMs: 3000, durationMs: 7000 },
    ]);
  });

  it("Studio-Fenster: Pause-Bereich zwischen Play-Fenstern → Still", () => {
    const pieces = planVideoPieces({
      windows: [
        { startMs: 0, stopMs: 1000 },
        { startMs: 2000, stopMs: 3000 },
      ],
      durationMs: 4000,
      trimStartMs: 0,
      sourceDurationMs: 60000,
    });
    // 0–1000 Play, 1000–2000 Still, 2000–3000 Play, 3000–4000 Still
    expect(pieces).toEqual([
      { type: "play", sourcePosMs: 0, durationMs: 1000 },
      { type: "still", sourcePosMs: 1000, durationMs: 1000 },
      { type: "play", sourcePosMs: 1000, durationMs: 1000 },
      { type: "still", sourcePosMs: 2000, durationMs: 1000 },
    ]);
  });

  it("trimStartMs verschiebt die Quell-Startposition", () => {
    const pieces = planVideoPieces({
      windows: [],
      durationMs: 2000,
      trimStartMs: 5000,
      sourceDurationMs: 60000,
    });
    expect(pieces[0]).toEqual({ type: "play", sourcePosMs: 5000, durationMs: 2000 });
  });
});
