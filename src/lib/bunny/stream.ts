/**
 * Bunny Stream client.
 *
 * Base API: https://video.bunnycdn.com
 * Auth: `AccessKey: <BUNNY_STREAM_API_KEY>` header
 */

import { readFile, stat } from "node:fs/promises";
import { getBunnyStreamEnv } from "./env";
import { bunnyFetch } from "./_fetch";

const STREAM_API_BASE = "https://video.bunnycdn.com";
const EMBED_BASE = "https://iframe.mediadelivery.net/embed";

export interface UploadVideoInput {
  filePath: string;
  title: string;
}

export interface UploadVideoResult {
  videoId: string;
  embedUrl: string;
  hlsUrl: string;
  thumbnailUrl: string;
}

interface CreateVideoResponse {
  guid: string;
  [key: string]: unknown;
}

/**
 * Uploads a video file to Bunny Stream.
 *
 * Two-step process:
 *  1. POST /library/{libraryId}/videos with {title} to get a guid
 *  2. PUT  /library/{libraryId}/videos/{guid} with the binary payload
 */
export async function uploadVideo(
  input: UploadVideoInput,
): Promise<UploadVideoResult> {
  const env = getBunnyStreamEnv();

  // Step 1: create video record
  const createResponse = await bunnyFetch(
    `${STREAM_API_BASE}/library/${env.libraryId}/videos`,
    {
      method: "POST",
      headers: {
        AccessKey: env.apiKey,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ title: input.title }),
    },
  );

  const created = (await createResponse.json()) as CreateVideoResponse;
  const videoId = created.guid;
  if (!videoId) {
    throw new Error(
      `[bunny] Stream create did not return a guid. Response: ${JSON.stringify(
        created,
      )}`,
    );
  }

  // Step 2: upload binary
  await stat(input.filePath); // throws if file missing
  const fileBuffer = await readFile(input.filePath);

  await bunnyFetch(
    `${STREAM_API_BASE}/library/${env.libraryId}/videos/${videoId}`,
    {
      method: "PUT",
      headers: {
        AccessKey: env.apiKey,
        "Content-Type": "application/octet-stream",
      },
      body: fileBuffer,
    },
  );

  return {
    videoId,
    embedUrl: `${EMBED_BASE}/${env.libraryId}/${videoId}`,
    hlsUrl: `https://${env.cdnHostname}/${videoId}/playlist.m3u8`,
    thumbnailUrl: `https://${env.cdnHostname}/${videoId}/thumbnail.jpg`,
  };
}

/**
 * Deletes a video from Bunny Stream.
 */
export async function deleteVideo(videoId: string): Promise<void> {
  const env = getBunnyStreamEnv();
  await bunnyFetch(
    `${STREAM_API_BASE}/library/${env.libraryId}/videos/${videoId}`,
    {
      method: "DELETE",
      headers: {
        AccessKey: env.apiKey,
        Accept: "application/json",
      },
    },
  );
}

/**
 * Fetches the raw API response for a video (status, dimensions, etc.).
 */
export async function getVideo(
  videoId: string,
): Promise<Record<string, unknown>> {
  const env = getBunnyStreamEnv();
  const response = await bunnyFetch(
    `${STREAM_API_BASE}/library/${env.libraryId}/videos/${videoId}`,
    {
      method: "GET",
      headers: {
        AccessKey: env.apiKey,
        Accept: "application/json",
      },
    },
  );
  return (await response.json()) as Record<string, unknown>;
}
