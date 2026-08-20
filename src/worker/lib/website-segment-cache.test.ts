/**
 * Fixed-Website-Segment-Cache: parallele Leads teilen EINEN Render;
 * nach einem Fehlschlag baut genau EIN Waiter neu (kein Thundering Herd).
 */

import { mkdtemp } from "node:fs/promises";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const captureMock = vi.hoisted(() => vi.fn());
vi.mock("./website-render-pipeline", () => ({
  renderWebsiteCapture: captureMock,
}));

const mp4Mock = vi.hoisted(() => vi.fn());
vi.mock("./ffmpeg", () => ({ imageSeqToMp4: mp4Mock }));

import { renderFixedWebsiteSegment } from "./website-segment-cache";

async function makeOutDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "vc-websegcache-"));
}

// Jeder Test nutzt eine eigene URL → eigener Cache-Key (der Cache ist
// modulglobal und /tmp-persistent; so bleiben Tests unabhängig).
function opts(outDir: string, n: number, url?: string) {
  return {
    url: url ?? `https://test-${randomUUID()}.example`,
    durationMs: 3000,
    mode: "static-hero" as const,
    outputPath: join(outDir, `out-${n}.mp4`),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  captureMock.mockImplementation(async (o: { outputDir: string }) => ({
    durationSec: 3,
    framesDir: join(o.outputDir, "frames"),
    frameCount: 90,
    fps: 30,
  }));
  mp4Mock.mockImplementation(async (o: { outputPath: string }) => {
    await writeFile(o.outputPath, "mp4-bytes");
  });
});

describe("renderFixedWebsiteSegment", () => {
  it("5 parallele Leads → genau 1 Render, alle bekommen ihre Kopie", async () => {
    const outDir = await makeOutDir();
    const url = `https://parallel-${randomUUID()}.example`;

    await Promise.all(
      Array.from({ length: 5 }, (_, n) =>
        renderFixedWebsiteSegment(opts(outDir, n, url)),
      ),
    );

    expect(captureMock).toHaveBeenCalledTimes(1);
  });

  it("Render schlägt fehl → alle Waiter werfen, danach baut genau EINER neu", async () => {
    const outDir = await makeOutDir();
    const url = `https://herd-${randomUUID()}.example`;
    captureMock.mockRejectedValueOnce(new Error("capture kaputt"));

    const results = await Promise.allSettled(
      Array.from({ length: 5 }, (_, n) =>
        renderFixedWebsiteSegment(opts(outDir, n, url)),
      ),
    );

    // Erster Render rejected → der Starter wirft. Die 4 Waiter wachen auf,
    // dürfen aber NICHT alle parallel neu rendern: der Waiter-Loop lässt
    // genau einen Neubau zu, die übrigen hängen sich an dessen Promise.
    expect(captureMock).toHaveBeenCalledTimes(2);
    const failed = results.filter((r) => r.status === "rejected");
    const ok = results.filter((r) => r.status === "fulfilled");
    expect(failed).toHaveLength(1);
    expect(ok).toHaveLength(4);
  });

  it("zweiter Aufruf nach Abschluss → Copy aus Cache, kein neuer Render", async () => {
    const outDir = await makeOutDir();
    const url = `https://hit-${randomUUID()}.example`;

    await renderFixedWebsiteSegment(opts(outDir, 0, url));
    await renderFixedWebsiteSegment(opts(outDir, 1, url));

    expect(captureMock).toHaveBeenCalledTimes(1);
  });
});
