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
 * CDN-URLs für eine existierende Video-GUID (gleiches Format wie
 * uploadVideo-Result) — für den Resume-Pfad, wenn die GUID schon persistiert
 * ist, aber die URLs nie in die DB geschrieben wurden.
 */
export function streamUrlsFor(videoId: string): {
  embedUrl: string;
  hlsUrl: string;
  thumbnailUrl: string;
} {
  const env = getBunnyStreamEnv();
  return {
    embedUrl: `${EMBED_BASE}/${env.libraryId}/${videoId}`,
    hlsUrl: `https://${env.cdnHostname}/${videoId}/playlist.m3u8`,
    thumbnailUrl: `https://${env.cdnHostname}/${videoId}/thumbnail.jpg`,
  };
}

export interface StreamLibraryVideo {
  guid: string;
  /** Bunny status 0..5. */
  status: number;
  /** ISO-Datum des Uploads (z.B. "2026-07-21T14:45:07"). */
  dateUploaded: string;
  title: string;
}

/**
 * Listet eine Seite der Stream-Library (für den Orphan-Reconcile-Sweep).
 * `orderBy=date` → neueste zuerst.
 */
export async function listVideosPage(
  page: number,
  itemsPerPage: number,
): Promise<{ items: StreamLibraryVideo[]; totalItems: number }> {
  const env = getBunnyStreamEnv();
  const response = await bunnyFetch(
    `${STREAM_API_BASE}/library/${env.libraryId}/videos?page=${page}&itemsPerPage=${itemsPerPage}&orderBy=date`,
    {
      method: "GET",
      headers: { AccessKey: env.apiKey, Accept: "application/json" },
    },
  );
  const data = (await response.json()) as {
    items?: Array<Record<string, unknown>>;
    totalItems?: number;
  };
  const items = (data.items ?? []).map((v) => ({
    guid: String(v.guid ?? ""),
    status: Number(v.status ?? 0),
    dateUploaded: String(v.dateUploaded ?? ""),
    title: String(v.title ?? ""),
  }));
  return { items, totalItems: Number(data.totalItems ?? items.length) };
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

/**
 * Liefert die besten verfügbaren MP4-Download-URLs für ein Bunny-Stream-
 * Video. Sortiert von hoechster zu niedrigster Aufloesung.
 *
 * Hintergrund: Bunny rendert pro Quellvideo nur die Resolutionen, die
 * Sinn ergeben. Ein 404×720-Portrait-Video bekommt z.B. nur 240p/360p/480p
 * — ein hardcoded `play_720p.mp4` liefert dann 404.
 *
 * Die Bunny-API liefert `availableResolutions` als CSV (z.B. "360p,480p,240p").
 * Wir parsen das + bauen die URL `<cdnBase>/<guid>/play_<res>.mp4`.
 *
 * Bei `hasOriginal: true` wird `<cdnBase>/<guid>/original` als letzter
 * Fallback angehaengt.
 */
const RES_RANK: Record<string, number> = {
  "240p": 240,
  "360p": 360,
  "480p": 480,
  "720p": 720,
  "1080p": 1080,
  "1440p": 1440,
  "2160p": 2160,
};

export interface VideoDownloadUrl {
  url: string;
  /** "1080p" | "720p" | … | "original" */
  label: string;
}

export async function getVideoDownloadUrls(
  videoId: string,
  cdnHostname: string,
): Promise<VideoDownloadUrl[]> {
  const meta = await getVideo(videoId);
  const resolutions = String(meta.availableResolutions ?? "")
    .split(",")
    .map((r) => r.trim().toLowerCase())
    .filter((r) => r.length > 0 && RES_RANK[r] !== undefined);
  // höchste Auflösung zuerst
  resolutions.sort((a, b) => (RES_RANK[b] ?? 0) - (RES_RANK[a] ?? 0));

  const base = `https://${cdnHostname.replace(/\/+$/, "")}/${videoId}`;
  const out: VideoDownloadUrl[] = resolutions.map((r) => ({
    url: `${base}/play_${r}.mp4`,
    label: r,
  }));
  if (meta.hasOriginal === true) {
    out.push({ url: `${base}/original`, label: "original" });
  }
  return out;
}
