/**
 * Fail-Loud-Verhalten von renderSegmentsBase (Reliability by Design,
 * 2026-08-20): Segment-Fehler dürfen NIE mehr still als Platzhalter oder
 * Black-Clip durchlaufen — sie melden ein Event und werfen. Fixe Website-
 * Segmente laufen über den Prozess-Cache statt pro Lead neu.
 */

import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const ffmpegMocks = vi.hoisted(() => ({
  renderTextSegment: vi.fn(async (o: { outputPath: string }) => {
    await writeFile(o.outputPath, "text-mp4");
  }),
  imageSeqToMp4: vi.fn(async (o: { outputPath: string }) => {
    await writeFile(o.outputPath, "seq-mp4");
  }),
  concatClips: vi.fn(async (o: { outputPath: string }) => {
    await writeFile(o.outputPath, "concat-mp4");
  }),
  generateBlackClip: vi.fn(async (o: { outputPath: string }) => {
    await writeFile(o.outputPath, "black-mp4");
  }),
  addSilentAudioTrack: vi.fn(),
  composePip: vi.fn(),
  trimVideoToDuration: vi.fn(),
}));
vi.mock("../lib/ffmpeg", () => ffmpegMocks);

const websiteMocks = vi.hoisted(() => ({
  renderWebsiteCapture: vi.fn(),
  renderUnreachablePlaceholder: vi.fn(),
}));
vi.mock("../lib/website-render-pipeline", () => websiteMocks);

const cacheMocks = vi.hoisted(() => ({
  renderFixedWebsiteSegment: vi.fn(
    async (o: { outputPath: string }) => {
      await writeFile(o.outputPath, "cached-mp4");
    },
  ),
}));
vi.mock("../lib/website-segment-cache", () => cacheMocks);

const gdocsMocks = vi.hoisted(() => ({
  renderPersonalizedGDocs: vi.fn(),
}));
vi.mock("../lib/personalized-gdocs", () => gdocsMocks);

vi.mock("../lib/video-compress", () => ({ compressForBunny: vi.fn() }));

vi.mock("../lib/scroll-recorder", () => ({
  normaliseWebsiteUrl: (v: string | null | undefined) => {
    const s = (v ?? "").trim();
    if (!s) return null;
    return s.startsWith("http") ? s : `https://${s}`;
  },
  recordCapture: vi.fn(),
  recordFallbackPage: vi.fn(),
  recordScroll: vi.fn(),
}));

import { renderSegmentsBase } from "./video-render";
import type { Segment } from "@/lib/segments/types";

const textSeg = (id: string): Segment => ({
  id,
  kind: "text",
  durationMs: 3000,
  text: "Hallo",
  bgColor: "#fff",
  textColor: "#000",
  fontSize: 32,
  textAlign: "center",
  fontWeight: "600",
  italic: false,
});

const websiteSeg = (over: Partial<Segment> = {}): Segment =>
  ({
    id: "web-1",
    kind: "website",
    durationMs: 4000,
    urlColumn: "website",
    fallbackUrl: "",
    captureMode: "static-hero",
    ...over,
  }) as Segment;

async function makeOutDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "vc-segtest-"));
}

function baseOpts(outDir: string, segments: Segment[]) {
  return {
    segments,
    outDir,
    basePath: join(outDir, "base.mp4"),
    fallbackWebsite: null,
    preflightFinalUrl: null,
    totalDurationSec: 60,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("renderSegmentsBase — Fail-Loud", () => {
  it("Website-Capture scheitert 2× → wirft, meldet Event, KEIN Black-Clip", async () => {
    const outDir = await makeOutDir();
    websiteMocks.renderWebsiteCapture.mockRejectedValue(
      new Error("renderWebsiteCapture timed out after 90000ms"),
    );
    const events: Array<{ index: number; kind: string; reason: string }> = [];

    await expect(
      renderSegmentsBase({
        ...baseOpts(outDir, [websiteSeg()]),
        leadData: { website: "praxis-beispiel.de" },
        onSegmentFallback: (info) => events.push(info),
      }),
    ).rejects.toThrow(/timed out/);

    expect(websiteMocks.renderWebsiteCapture).toHaveBeenCalledTimes(2);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ index: 0, kind: "website" });
    expect(events[0].reason).toContain("timed out");
    expect(ffmpegMocks.generateBlackClip).not.toHaveBeenCalled();
  }, 20_000);

  it("Website-Capture scheitert 1×, Retry klappt → Erfolg mit frischem Dir", async () => {
    const outDir = await makeOutDir();
    websiteMocks.renderWebsiteCapture
      .mockRejectedValueOnce(new Error("net::ERR_CONNECTION_RESET"))
      .mockResolvedValueOnce({
        durationSec: 4,
        framesDir: join(outDir, "frames"),
        frameCount: 120,
        fps: 30,
      });
    const events: unknown[] = [];

    await renderSegmentsBase({
      ...baseOpts(outDir, [websiteSeg()]),
      leadData: { website: "praxis-beispiel.de" },
      onSegmentFallback: (info) => events.push(info),
    });

    expect(websiteMocks.renderWebsiteCapture).toHaveBeenCalledTimes(2);
    const secondDir =
      websiteMocks.renderWebsiteCapture.mock.calls[1][0].outputDir;
    expect(secondDir).toContain("-retry");
    expect(events).toHaveLength(0);
    expect(ffmpegMocks.generateBlackClip).not.toHaveBeenCalled();
  }, 20_000);

  it("Keine URL auflösbar → UnrecoverableError (kein BullMQ-Retry) + Event", async () => {
    const outDir = await makeOutDir();
    const events: Array<{ reason: string }> = [];

    await expect(
      renderSegmentsBase({
        ...baseOpts(outDir, [websiteSeg()]),
        leadData: {},
        onSegmentFallback: (info) => events.push(info),
      }),
    ).rejects.toMatchObject({ name: "UnrecoverableError" });

    expect(events[0]?.reason).toContain("Keine Webseiten-URL");
    expect(websiteMocks.renderWebsiteCapture).not.toHaveBeenCalled();
    expect(ffmpegMocks.generateBlackClip).not.toHaveBeenCalled();
  });

  it("GDocs ohne Dokument-URL → UnrecoverableError + Event", async () => {
    const outDir = await makeOutDir();
    const events: Array<{ kind: string }> = [];

    await expect(
      renderSegmentsBase({
        ...baseOpts(outDir, [
          {
            id: "gd-1",
            kind: "gdocs",
            durationMs: 3000,
            docsUrl: "",
            captureMode: "static-hero",
          } as Segment,
        ]),
        onSegmentFallback: (info) => events.push(info),
      }),
    ).rejects.toMatchObject({ name: "UnrecoverableError" });

    expect(events[0]?.kind).toBe("gdocs");
  });

  it("GDocs-Capture scheitert 2× → wirft statt Platzhalter", async () => {
    const outDir = await makeOutDir();
    gdocsMocks.renderPersonalizedGDocs.mockRejectedValue(
      new Error("Doc-Export fehlgeschlagen"),
    );

    await expect(
      renderSegmentsBase({
        ...baseOpts(outDir, [
          {
            id: "gd-2",
            kind: "gdocs",
            durationMs: 3000,
            docsUrl: "https://docs.google.com/document/d/abc",
            captureMode: "static-hero",
          } as Segment,
        ]),
      }),
    ).rejects.toThrow(/Doc-Export/);

    expect(gdocsMocks.renderPersonalizedGDocs).toHaveBeenCalledTimes(2);
    expect(ffmpegMocks.generateBlackClip).not.toHaveBeenCalled();
  }, 20_000);
});

describe("renderSegmentsBase — Fixed-Segment-Cache", () => {
  it("personalized:false → Prozess-Cache statt per-Lead-Capture", async () => {
    const outDir = await makeOutDir();

    await renderSegmentsBase({
      ...baseOpts(outDir, [
        websiteSeg({ personalized: false, fallbackUrl: "juliusthiesen.de" }),
      ]),
      leadData: { website: "praxis-beispiel.de" },
    });

    expect(cacheMocks.renderFixedWebsiteSegment).toHaveBeenCalledTimes(1);
    expect(cacheMocks.renderFixedWebsiteSegment.mock.calls[0][0].url).toBe(
      "https://juliusthiesen.de",
    );
    expect(websiteMocks.renderWebsiteCapture).not.toHaveBeenCalled();
  });

  it("personalisiertes Segment → KEIN Cache, echter Capture", async () => {
    const outDir = await makeOutDir();
    websiteMocks.renderWebsiteCapture.mockResolvedValue({
      durationSec: 4,
      framesDir: join(outDir, "frames"),
      frameCount: 120,
      fps: 30,
    });

    await renderSegmentsBase({
      ...baseOpts(outDir, [websiteSeg()]),
      leadData: { website: "praxis-beispiel.de" },
    });

    expect(websiteMocks.renderWebsiteCapture).toHaveBeenCalledTimes(1);
    expect(cacheMocks.renderFixedWebsiteSegment).not.toHaveBeenCalled();
  });
});

describe("renderSegmentsBase — Erfolgspfad", () => {
  it("Text + Website → concat, keine Events", async () => {
    const outDir = await makeOutDir();
    websiteMocks.renderWebsiteCapture.mockResolvedValue({
      durationSec: 4,
      framesDir: join(outDir, "frames"),
      frameCount: 120,
      fps: 30,
    });
    const events: unknown[] = [];

    await renderSegmentsBase({
      ...baseOpts(outDir, [textSeg("t-1"), websiteSeg()]),
      leadData: { website: "praxis-beispiel.de" },
      onSegmentFallback: (info) => events.push(info),
    });

    expect(ffmpegMocks.renderTextSegment).toHaveBeenCalledTimes(1);
    expect(ffmpegMocks.concatClips).toHaveBeenCalledTimes(1);
    expect(events).toHaveLength(0);
  });
});
