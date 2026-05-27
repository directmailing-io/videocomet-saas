/**
 * Stage 2: Video upload to Bunny Stream.
 *
 * Stores `bunnyVideoId`, `videoUrl` (HLS) and `thumbnailUrl` on the lead row.
 * Retries are governed by BullMQ (3 attempts, exponential backoff) — we
 * fail fast here so the queue can take over.
 */

import { uploadVideo } from "@/lib/bunny/stream";
import { updateLeadStatus } from "@/lib/db/queries/leads";

export interface VideoUploadInput {
  leadId: string;
  videoFilePath: string;
  title: string;
}

export interface VideoUploadOutput {
  bunnyVideoId: string;
  videoUrl: string;
  thumbnailUrl: string;
}

export async function runVideoUpload(
  input: VideoUploadInput,
): Promise<VideoUploadOutput> {
  const result = await uploadVideo({
    filePath: input.videoFilePath,
    title: input.title,
  });

  await updateLeadStatus(input.leadId, {
    bunnyVideoId: result.videoId,
    videoUrl: result.hlsUrl,
    thumbnailUrl: result.thumbnailUrl,
  });

  return {
    bunnyVideoId: result.videoId,
    videoUrl: result.hlsUrl,
    thumbnailUrl: result.thumbnailUrl,
  };
}
