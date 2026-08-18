import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { planVideoPieces, renderCached } from "./media-segment-render";

// ffprobe mocken: Tests schreiben Fake-Dateien, keine echten MP4s. Der
// echte probeVideoDuration würde daran scheitern — hier steuern wir die
// Validierung gezielt pro Test.
const probeMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/ffprobe", () => ({
  probeVideoDuration: probeMock,
  probeHasAudioStream: vi.fn(async () => false),
}));

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

describe("renderCached (Regression Bug 2026-08-18: schwarze Video-Szenen)", () => {
  const freshOutputPath = async () => {
    const dir = await mkdtemp(join(tmpdir(), "mediaseg-test-"));
    return join(dir, "out.mp4");
  };

  it("tmp-Pfad endet auf .mp4 — sonst kennt ffmpeg das Output-Format nicht", async () => {
    probeMock.mockResolvedValue(1.5);
    let seenTmp = "";
    await renderCached(randomUUID(), await freshOutputPath(), "test", async (tmp) => {
      seenTmp = tmp;
      await writeFile(tmp, "fake-mp4");
    });
    expect(seenTmp.endsWith(".mp4")).toBe(true);
    // .mp4 muss die LETZTE Extension sein, nicht irgendwo mittendrin.
    expect(seenTmp).toMatch(/\.mp4$/);
    expect(seenTmp).toContain(".tmp.");
  });

  it("kopiert das produzierte File an den outputPath", async () => {
    probeMock.mockResolvedValue(2);
    const outputPath = await freshOutputPath();
    await renderCached(randomUUID(), outputPath, "test", async (tmp) => {
      await writeFile(tmp, "rendered-content");
    });
    expect((await readFile(outputPath)).toString()).toBe("rendered-content");
  });

  it("zweiter Call mit gleichem Key rendert NICHT erneut (Cache-Hit)", async () => {
    probeMock.mockResolvedValue(2);
    const key = randomUUID();
    const produce = vi.fn(async (tmp: string) => {
      await writeFile(tmp, "once");
    });
    await renderCached(key, await freshOutputPath(), "test", produce);
    const secondOut = await freshOutputPath();
    await renderCached(key, secondOut, "test", produce);
    expect(produce).toHaveBeenCalledTimes(1);
    expect((await readFile(secondOut)).toString()).toBe("once");
  });

  it("ungültiges Output (ffprobe-Dauer 0/unlesbar) → wirft statt still zu cachen", async () => {
    probeMock.mockResolvedValue(null);
    const key = randomUUID();
    await expect(
      renderCached(key, await freshOutputPath(), "test", async (tmp) => {
        await writeFile(tmp, "broken");
      }),
    ).rejects.toThrow(/invalid MP4/);

    // Danach mit gültigem Output: Cache-Eintrag darf nicht vergiftet sein.
    probeMock.mockResolvedValue(3);
    const outputPath = await freshOutputPath();
    await renderCached(key, outputPath, "test", async (tmp) => {
      await writeFile(tmp, "repaired");
    });
    expect((await readFile(outputPath)).toString()).toBe("repaired");
  });

  it("produce-Fehler propagiert (kein stiller Fallback in dieser Schicht)", async () => {
    await expect(
      renderCached(randomUUID(), await freshOutputPath(), "test", async () => {
        throw new Error("ffmpeg exploded");
      }),
    ).rejects.toThrow("ffmpeg exploded");
  });
});
