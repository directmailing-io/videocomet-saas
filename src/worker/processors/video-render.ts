/**
 * Stage 1: Video render.
 *
 * Two render modes:
 *  - `webcam-only`         → the lead's video IS the campaign webcam clip
 *                            (downloaded from Bunny + re-compressed in place).
 *  - `with-presentation`   → Puppeteer scroll-captures the lead's website
 *                            into a 30 fps JPG sequence, ffmpeg encodes it
 *                            into a base MP4, and the webcam clip is overlaid
 *                            as PiP on top.
 *
 * Fallbacks for `with-presentation`:
 *  1. Website value empty / not parseable → render a "Website nicht erreichbar"
 *     placeholder page and use that as the base track.
 *  2. Puppeteer scroll-capture throws (DNS/404/timeout/hang) → same fallback
 *     placeholder. If the fallback ALSO throws (e.g. browser pool dead), we
 *     fall all the way back to a black clip so the lead still completes.
 *
 * Both flows return a single MP4 + the measured duration.
 */

import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  composePip,
  compressVideo,
  concatClips,
  generateBlackClip,
  imageSeqToMp4,
  renderTextSegment,
  type PipPosition,
  type PipShape,
} from "../lib/ffmpeg";
import {
  normaliseWebsiteUrl,
  recordFallbackPage,
  recordScroll,
} from "../lib/scroll-recorder";
import type { Segment } from "@/lib/segments/types";

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
  /** Optional ordered segments for the presentation track. */
  segments?: Segment[];
  /** Lead data for placeholder substitution in text segments. */
  leadData?: Record<string, string>;
}

/** Replace {{key}} placeholders in any string with values from leadData. */
function applyPlaceholders(s: string, data: Record<string, string> | undefined): string {
  if (!data) return s;
  return s.replace(/\{\{\s*([\w-]+)\s*\}\}/g, (_, key: string) => {
    return data[key] ?? "";
  });
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
 * Drives the Puppeteer scroll-capture and ffmpeg encode that produces the
 * "base" presentation track. Returns the absolute path to a 1280x720 MP4.
 *
 * Failure handling is layered:
 *   1. URL not usable → placeholder page MP4.
 *   2. Scroll-capture throws → placeholder page MP4.
 *   3. Placeholder page ALSO throws → black clip (so the pipeline never gets
 *      stuck on a bad website + a missing browser).
 */
async function renderPresentationBase(opts: {
  website: string | null | undefined;
  outDir: string;
  basePath: string;
  durationSec: number;
}): Promise<void> {
  const durationMs = Math.max(1, opts.durationSec * 1000);
  const url = normaliseWebsiteUrl(opts.website);

  // Helper: take a frames-dir result and encode it to opts.basePath.
  const encode = async (framesDir: string, fps: number) => {
    await imageSeqToMp4({
      framesDir,
      outputPath: opts.basePath,
      fps,
    });
  };

  const fallbackToPlaceholder = async (reason: string) => {
    // eslint-disable-next-line no-console
    console.warn(`[render] scroll-capture fallback → placeholder: ${reason}`);
    try {
      const fb = await recordFallbackPage({
        outputDir: opts.outDir,
        durationMs,
        websiteLabel: opts.website?.toString() ?? "(keine Website angegeben)",
      });
      await encode(fb.framesDir, fb.fps);
      return true;
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn(`[render] placeholder page failed: ${(e as Error).message}`);
      return false;
    }
  };

  const fallbackToBlackClip = async () => {
    // eslint-disable-next-line no-console
    console.warn(`[render] falling back to black clip`);
    await generateBlackClip({
      outputPath: opts.basePath,
      durationSec: opts.durationSec,
    });
  };

  if (!url) {
    if (await fallbackToPlaceholder("invalid or empty website value")) return;
    await fallbackToBlackClip();
    return;
  }

  // Stage A: scroll-capture (browser open + page goto + N screenshots).
  let framesResult;
  try {
    framesResult = await recordScroll({
      url,
      outputDir: opts.outDir,
      durationMs,
    });
  } catch (e) {
    if (await fallbackToPlaceholder((e as Error).message)) return;
    await fallbackToBlackClip();
    return;
  }

  // Stage B: encode frames → MP4.
  try {
    await encode(framesResult.framesDir, framesResult.fps);
  } catch (e) {
    if (await fallbackToPlaceholder(`encode failed: ${(e as Error).message}`)) return;
    await fallbackToBlackClip();
  }
}

/**
 * Produces a final MP4 in `outDir` and returns its path and duration.
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

  // with-presentation: build a base track. If the campaign has segments,
  // render each one and concat them; otherwise fall back to the legacy
  // scroll-capture / placeholder flow.
  const basePath = join(input.outDir, "base.mp4");
  if (input.segments && input.segments.length > 0) {
    await renderSegmentsBase({
      segments: input.segments,
      leadData: input.leadData,
      outDir: input.outDir,
      basePath,
      fallbackWebsite: input.website ?? null,
      totalDurationSec: duration,
    });
  } else {
    await renderPresentationBase({
      website: input.website ?? null,
      outDir: input.outDir,
      basePath,
      durationSec: duration,
    });
  }

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

/**
 * Renders each segment to its own MP4, then concatenates them into a single
 * `basePath`. Currently supports text segments fully; other types fall back
 * to a labeled black clip so the lead still completes.
 *
 * v2 TODOs: image (image overlay), video (re-encode + trim), website (scroll
 * capture for the per-segment duration), gdocs (live doc fetch + capture).
 */
async function renderSegmentsBase(opts: {
  segments: Segment[];
  leadData?: Record<string, string>;
  outDir: string;
  basePath: string;
  fallbackWebsite: string | null;
  totalDurationSec: number;
}): Promise<void> {
  const parts: string[] = [];
  for (let i = 0; i < opts.segments.length; i++) {
    const seg = opts.segments[i];
    const partPath = join(opts.outDir, `seg-${i}.mp4`);
    const durationMs = Math.max(200, seg.durationMs);

    try {
      if (seg.kind === "text") {
        await renderTextSegment({
          text: applyPlaceholders(seg.text, opts.leadData),
          bgColor: seg.bgColor,
          textColor: seg.textColor,
          fontSize: seg.fontSize,
          textAlign: seg.textAlign,
          fontWeight: seg.fontWeight,
          italic: seg.italic,
          durationMs,
          outputPath: partPath,
        });
      } else if (seg.kind === "website") {
        // For website segments we still do scroll-capture per segment.
        const url =
          normaliseWebsiteUrl(opts.fallbackWebsite) ??
          normaliseWebsiteUrl(seg.fallbackUrl) ??
          null;
        if (!url) {
          await generateBlackClip({
            outputPath: partPath,
            durationSec: durationMs / 1000,
          });
        } else {
          const fr = await recordScroll({
            url,
            outputDir: join(opts.outDir, `scroll-${i}`),
            durationMs,
          });
          await imageSeqToMp4({
            framesDir: fr.framesDir,
            outputPath: partPath,
            fps: fr.fps,
          });
        }
      } else {
        // image / video / gdocs not yet rendered in v1 — black clip placeholder.
        console.warn(
          `[render] segment kind=${seg.kind} not yet supported in v1 — using placeholder`,
        );
        await generateBlackClip({
          outputPath: partPath,
          durationSec: durationMs / 1000,
        });
      }
      parts.push(partPath);
    } catch (e) {
      console.error(
        `[render] segment ${i} (${seg.kind}) failed; using black clip:`,
        e instanceof Error ? e.message : e,
      );
      await generateBlackClip({
        outputPath: partPath,
        durationSec: durationMs / 1000,
      });
      parts.push(partPath);
    }
  }

  if (parts.length === 0) {
    await generateBlackClip({
      outputPath: opts.basePath,
      durationSec: opts.totalDurationSec,
    });
    return;
  }

  if (parts.length === 1) {
    // Single segment: just rename / copy.
    await (await import("node:fs/promises")).copyFile(parts[0], opts.basePath);
    return;
  }

  await concatClips({
    inputPaths: parts,
    outputPath: opts.basePath,
    workDir: opts.outDir,
  });
}
