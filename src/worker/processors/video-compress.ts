/**
 * Stage: video-compress.
 *
 * Thin processor wrapper around `compressForBunny` from
 * `../lib/video-compress`. Wird in der `with-presentation`-Pipeline
 * ZWISCHEN `runVideoRender` und `runVideoUpload` aufgerufen, damit der
 * uploadable MP4 ein bunny-friendly Codec/Bitrate hat, nicht der
 * unkomprimierte Renderer-Output.
 *
 * Pipeline-Event-Inserts laufen hier, damit der Live-Log auf der Run-Detail-
 * Page sehen kann ob das Compress-Stage gerade läuft (alte Pipeline hatte
 * den ffmpeg-Re-Encode versteckt im videoUpload).
 */

import { join } from "node:path";
import { insertPipelineEvent } from "@/lib/db/queries/pipeline-events";
import {
  compressForBunny,
  type CompressResult,
  type VideoOrientation,
} from "../lib/video-compress";

export interface VideoCompressInput {
  leadId: string;
  /** Run-ID — für insertPipelineEvent / Log-Korrelation. */
  runId?: string;
  inputPath: string;
  /** Worker-spezifisches Workdir. Output landet hier als `compressed.mp4`. */
  outDir: string;
}

export interface VideoCompressOutput extends CompressResult {
  /** Convenience-Alias auf `outputPath`. */
  videoFilePath: string;
  orientation: VideoOrientation;
}

export async function runVideoCompress(
  input: VideoCompressInput,
): Promise<VideoCompressOutput> {
  const outputPath = join(input.outDir, "compressed.mp4");
  const t0 = Date.now();
  const result = await compressForBunny({
    inputPath: input.inputPath,
    outputPath,
    reason: `lead-${input.leadId.slice(0, 8)}`,
  });
  const elapsedMs = Date.now() - t0;

  if (input.runId) {
    const compressionPct =
      result.bytesIn > 0
        ? Math.round((1 - result.bytesOut / result.bytesIn) * 100)
        : 0;
    await insertPipelineEvent({
      runId: input.runId,
      leadId: input.leadId,
      level: "info",
      stage: "compress",
      message: `video compressed (${result.skipped ? "remux" : "re-encode"}, ${result.orientation}, ${(result.bytesIn / 1024 / 1024).toFixed(1)}MB→${(result.bytesOut / 1024 / 1024).toFixed(1)}MB, ${compressionPct >= 0 ? `-${compressionPct}%` : `+${-compressionPct}%`})`,
      durationMs: elapsedMs,
    });
  }

  return {
    ...result,
    videoFilePath: result.outputPath,
  };
}
