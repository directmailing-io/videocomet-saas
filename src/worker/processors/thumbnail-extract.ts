/**
 * Stage 3: Thumbnail-frame extraction.
 *
 * Uses ffmpeg `-ss` (fast input-seek) to grab a single high-quality JPG
 * frame at `pdfThumbnailFrameMs`. If the configured offset exceeds the
 * actual video duration we clamp to `duration - 100ms` to avoid producing
 * an empty file.
 */

import { join } from "node:path";
import { extractFrame } from "../lib/ffmpeg";

export interface ThumbnailInput {
  videoFilePath: string;
  durationSec: number;
  frameMs: number | null | undefined;
  outDir: string;
  enabled: boolean;
}

export interface ThumbnailOutput {
  thumbFilePath: string | null;
  skipped: boolean;
}

/**
 * Returns the path to the extracted JPG, or `{ skipped: true }` if the
 * thumbnail feature is disabled for this campaign.
 */
export async function runThumbnailExtract(
  input: ThumbnailInput,
): Promise<ThumbnailOutput> {
  if (!input.enabled) {
    return { thumbFilePath: null, skipped: true };
  }
  const duration = input.durationSec;
  const targetMs =
    input.frameMs && input.frameMs > 0 ? input.frameMs : Math.floor(duration * 500);

  // Clamp to duration - 100ms (in ms).
  const maxMs = Math.max(0, Math.floor(duration * 1000) - 100);
  const safeMs = Math.min(targetMs, maxMs);

  const outPath = join(input.outDir, "thumb.jpg");
  await extractFrame({
    inputPath: input.videoFilePath,
    outputPath: outPath,
    atMs: safeMs,
  });
  return { thumbFilePath: outPath, skipped: false };
}
