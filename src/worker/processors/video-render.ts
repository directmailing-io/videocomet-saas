/**
 * Stage 1: Video render.
 *
 * v1 strategy:
 *  - If the campaign is `webcam-only` we DO NOT render anything via
 *    Puppeteer; the lead's video IS the campaign's webcam clip (which
 *    already lives in the mediathek and can simply be downloaded).
 *  - If the campaign is `with-presentation` we render a base track that
 *    Puppeteer captures (scroll-capture, slides, etc.) and overlay the
 *    webcam clip as PiP. The Puppeteer side is stubbed in v1: we currently
 *    emit a black 30-second clip as the base track and compose the webcam
 *    PiP on top.
 *
 * Both flows return a single MP4 + the measured duration.
 */

import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  composePip,
  compressVideo,
  generateBlackClip,
  type PipPosition,
  type PipShape,
} from "../lib/ffmpeg";
import { getContext } from "../lib/browser-pool";

export interface VideoRenderInput {
  outDir: string;
  /** Campaign mode determines the render strategy. */
  mode: "webcam-only" | "with-presentation";
  /** Absolute or remote URL to the webcam clip in the mediathek. */
  webcamSourceUrl: string;
  /** Lead's target website (used for scroll-capture). */
  website?: string | null;
  /** PiP configuration when mode = with-presentation. */
  pip?: {
    position: PipPosition;
    shape: PipShape;
  };
  /** Defaults to 30 if we cannot probe the source. */
  defaultDurationSec?: number;
}

export interface VideoRenderOutput {
  videoFilePath: string;
  durationSec: number;
}

async function fetchToFile(url: string, outPath: string): Promise<void> {
  // Tolerate file:// and http(s):// URLs; downloads stream into a Buffer
  // (lead videos are 5-20MB so this is fine for v1).
  if (url.startsWith("file://")) {
    return; // Already on local disk; caller handles this branch.
  }
  // For HLS playlists from Bunny Stream, switch to the MP4 fallback URL so
  // ffmpeg can read a single seekable file. The Library has MP4 fallback
  // enabled, so {guid}/play_720p.mp4 always exists.
  let downloadUrl = url;
  const hlsMatch = url.match(/^(https?:\/\/[^/]+)\/([0-9a-f-]{36})\/playlist\.m3u8$/i);
  if (hlsMatch) {
    downloadUrl = `${hlsMatch[1]}/${hlsMatch[2]}/play_720p.mp4`;
  }
  // Bunny CDN blocks none-referrer requests by default. Provide an APP_URL
  // referrer so the hot-link protection lets us through.
  const referer = process.env.APP_URL ?? "https://app.videocomet.de";
  const res = await fetch(downloadUrl, {
    headers: { Referer: referer, "User-Agent": "videocomet-worker/1.0" },
  });
  if (!res.ok) {
    throw new Error(`[render] webcam fetch failed: ${res.status} ${downloadUrl}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  await writeFile(outPath, buf);
}

/**
 * v1 placeholder for the Puppeteer scroll-capture. Spawns a context, opens
 * the lead's website to validate connectivity, then closes it. The actual
 * video bytes are produced as a black clip by ffmpeg — full scroll-capture
 * is a TODO for v2.
 */
async function renderPresentationBase(opts: {
  website: string | null | undefined;
  outPath: string;
  durationSec: number;
}): Promise<void> {
  // Open the page once just so we surface DNS / 404 errors early in the
  // pipeline (so we fail the right lead, not the upload stage).
  if (opts.website) {
    const ctx = await getContext();
    try {
      const page = await ctx.context.newPage();
      try {
        await page.goto(opts.website, { waitUntil: "domcontentloaded", timeout: 30_000 });
        // TODO(v2): actual scroll-capture via CDP screencast +
        // ffmpeg encoder. For now we just verify the page loads.
      } finally {
        await page.close().catch(() => undefined);
      }
    } finally {
      await ctx.close();
    }
  }

  await generateBlackClip({
    outputPath: opts.outPath,
    durationSec: opts.durationSec,
  });
}

/**
 * Produces a final MP4 in `outDir` and returns its path and duration.
 *
 * v1 simplifications (clearly marked):
 *  - Webcam-only mode: just downloads the source and re-compresses.
 *  - With-presentation mode: stub base track is a black clip; webcam is
 *    composed on top via the PiP filter.
 */
export async function runVideoRender(
  input: VideoRenderInput,
): Promise<VideoRenderOutput> {
  const duration = input.defaultDurationSec ?? 30;
  const finalPath = join(input.outDir, "final.mp4");

  // Materialise the webcam source on disk first.
  const webcamLocal = join(input.outDir, "webcam-src.mp4");
  if (input.webcamSourceUrl.startsWith("file://")) {
    const stripped = input.webcamSourceUrl.replace(/^file:\/\//, "");
    if (!existsSync(stripped)) {
      throw new Error(`[render] webcam source missing: ${stripped}`);
    }
    // Re-compress in place to normalize codec.
    await compressVideo({ inputPath: stripped, outputPath: webcamLocal });
  } else {
    const raw = join(input.outDir, "webcam-raw");
    await fetchToFile(input.webcamSourceUrl, raw);
    await compressVideo({ inputPath: raw, outputPath: webcamLocal });
  }

  if (input.mode === "webcam-only") {
    // Webcam IS the final clip.
    return { videoFilePath: webcamLocal, durationSec: duration };
  }

  // with-presentation: build a base track + overlay.
  const basePath = join(input.outDir, "base.mp4");
  await renderPresentationBase({
    website: input.website ?? null,
    outPath: basePath,
    durationSec: duration,
  });

  await composePip({
    basePath,
    webcamPath: webcamLocal,
    outputPath: finalPath,
    position: input.pip?.position ?? "right",
    shape: input.pip?.shape ?? "rounded",
    durationSec: duration,
  });

  return { videoFilePath: finalPath, durationSec: duration };
}
