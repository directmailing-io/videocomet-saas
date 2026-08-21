import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  planVideoPieces,
  renderCached,
  videoSegmentCacheKeyPayload,
  volumeAudioFilterArgs,
} from "./media-segment-render";
import {
  videoSegmentTrimEndMs,
  type VideoSegment,
} from "@/lib/segments/types";

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

/* ------------------------------------------------------------------ */
/* Segment-Lautstärke (Volume-Incident 2026-08-21)                     */
/* ------------------------------------------------------------------ */

function videoSegment(overrides: Partial<VideoSegment> = {}): VideoSegment {
  return {
    id: "seg-1",
    kind: "video",
    durationMs: 5000,
    mediaId: "media-1",
    publicUrl: "https://cdn.example/video.mp4",
    originalDurationSec: 30,
    trimStartMs: 0,
    trimEndMs: null,
    cropRatio: "16:9",
    showAsBrowserFrame: false,
    browserTabName: "",
    browserTabUrl: "",
    ...overrides,
  };
}

describe("volumeAudioFilterArgs — FFmpeg-Filter pro Lautstärke", () => {
  it.each([
    [0, ["-af", "volume=0.0000"]],
    [0.25, ["-af", "volume=0.2500"]],
    [0.5, ["-af", "volume=0.5000"]],
    [0.75, ["-af", "volume=0.7500"]],
  ])("volume=%s → %j", (volume, expected) => {
    expect(volumeAudioFilterArgs(true, volume as number)).toEqual(expected);
  });

  it("volume=1 (Default) → KEIN Filter (bitidentisch zu vorher)", () => {
    expect(volumeAudioFilterArgs(true, 1)).toEqual([]);
  });

  it("Quelle ohne Audio → nie ein Filter (anullsrc bleibt unangetastet)", () => {
    expect(volumeAudioFilterArgs(false, 0)).toEqual([]);
    expect(volumeAudioFilterArgs(false, 0.5)).toEqual([]);
  });
});

describe("videoSegmentTrimEndMs — Trim-Ende-Interpretation (Fix 2026-08-21)", () => {
  it("gültiger Wert → gerundete ms", () => {
    expect(videoSegmentTrimEndMs({ trimEndMs: 2000.4, trimStartMs: 0 })).toBe(
      2000,
    );
  });

  it("null / 0 / negativ / NaN → kein Trim-Ende", () => {
    expect(videoSegmentTrimEndMs({ trimEndMs: null, trimStartMs: 0 })).toBeNull();
    expect(videoSegmentTrimEndMs({ trimEndMs: 0, trimStartMs: 0 })).toBeNull();
    expect(videoSegmentTrimEndMs({ trimEndMs: -500, trimStartMs: 0 })).toBeNull();
    expect(videoSegmentTrimEndMs({ trimEndMs: NaN, trimStartMs: 0 })).toBeNull();
  });

  it("Ende ≤ Start → ignoriert (nie ein leeres Video erzeugen)", () => {
    expect(
      videoSegmentTrimEndMs({ trimEndMs: 3000, trimStartMs: 3000 }),
    ).toBeNull();
    expect(
      videoSegmentTrimEndMs({ trimEndMs: 2000, trimStartMs: 5000 }),
    ).toBeNull();
  });
});

describe("videoSegmentCacheKeyPayload — Trim-Ende im Render-Cache-Key", () => {
  it("ohne Trim-Ende: Key unverändert (Alt-Cache bleibt gültig)", () => {
    const def = videoSegmentCacheKeyPayload(
      { segment: videoSegment(), durationMs: 5000 },
      30,
    );
    expect(def).not.toContain("trimEndMs");
  });

  it("aktives Trim-Ende verändert den Key", () => {
    const def = videoSegmentCacheKeyPayload(
      { segment: videoSegment(), durationMs: 5000 },
      30,
    );
    const withEnd = videoSegmentCacheKeyPayload(
      { segment: videoSegment({ trimEndMs: 2000 }), durationMs: 5000 },
      30,
    );
    expect(withEnd).not.toBe(def);
    expect(withEnd).toContain('"trimEndMs":2000');
  });

  it("ungültiges Trim-Ende (≤ Start) → Key wie ohne", () => {
    const def = videoSegmentCacheKeyPayload(
      { segment: videoSegment({ trimStartMs: 5000 }), durationMs: 5000 },
      30,
    );
    const invalid = videoSegmentCacheKeyPayload(
      {
        segment: videoSegment({ trimStartMs: 5000, trimEndMs: 2000 }),
        durationMs: 5000,
      },
      30,
    );
    expect(invalid).toBe(def);
  });
});

describe("videoSegmentCacheKeyPayload — Volume im Render-Cache-Key", () => {
  it("volume=1 und volume=undefined erzeugen DENSELBEN Key (Alt-Cache bleibt gültig)", () => {
    const a = videoSegmentCacheKeyPayload(
      { segment: videoSegment(), durationMs: 5000 },
      30,
    );
    const b = videoSegmentCacheKeyPayload(
      { segment: videoSegment({ volume: 1 }), durationMs: 5000 },
      30,
    );
    expect(a).toBe(b);
    expect(a).not.toContain("volume");
  });

  it.each([0, 0.25, 0.5, 0.75])(
    "volume=%s verändert den Key gegenüber Default",
    (volume) => {
      const def = videoSegmentCacheKeyPayload(
        { segment: videoSegment(), durationMs: 5000 },
        30,
      );
      const withVol = videoSegmentCacheKeyPayload(
        { segment: videoSegment({ volume }), durationMs: 5000 },
        30,
      );
      expect(withVol).not.toBe(def);
      expect(withVol).toContain(`"volume":${volume}`);
    },
  );

  it("unterschiedliche Volumes → unterschiedliche Keys", () => {
    const k25 = videoSegmentCacheKeyPayload(
      { segment: videoSegment({ volume: 0.25 }), durationMs: 5000 },
      30,
    );
    const k75 = videoSegmentCacheKeyPayload(
      { segment: videoSegment({ volume: 0.75 }), durationMs: 5000 },
      30,
    );
    expect(k25).not.toBe(k75);
  });
});
