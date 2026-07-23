/**
 * Outreach-GIF-Job (Kontrakt Kapitel 6) — BullMQ-Job je Lead.
 *
 * Pipeline pro Lead:
 *  1. Lead + Kampagnen-Config (`campaigns.emailGifConfig`) laden.
 *  2. Hash-Cache: `sha1(videoContentHash + JSON(gifConfig))` — identisch
 *     zu `leads.emailGifHash` UND GIF-URL vorhanden ⇒ Skip.
 *  3. Lead-Video als MP4 in tmp laden (videoMp4Url bevorzugt; HLS-URL
 *     wird via Bunny-Library-API auf die beste Download-Variante
 *     aufgelöst — gleiche Kandidaten-Logik wie video-render.ts).
 *  4. ffmpeg (via `runFfmpeg`-Wrapper): Ausschnitt startSec/durationSec,
 *     600px breit, 10fps, palettegen/paletteuse in EINEM Filtergraph,
 *     halbtransparentes Play-Button-Overlay (Sharp-gerastertes Inline-SVG
 *     als zweiter ffmpeg-Input — gleiche Optik wie play-icon-overlay.ts).
 *  5. Upload nach Bunny **Storage** (`email-gifs/<campaignId>/<leadId>.gif`,
 *     Muster Thumbnail-/PDF-Uploads) + Asset-Tracking (kind "storage" —
 *     KEINE Stream-GUIDs, daher kein Known-Set-Eintrag nötig).
 *  6. `leads.emailGifUrl` + `leads.emailGifHash` persistieren.
 */

import { eq } from "drizzle-orm";
import { join } from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import type { Job } from "bullmq";
import sharp from "sharp";
import { db } from "@/lib/db";
import { campaigns, leads } from "@/lib/db/schema";
import { computeEmailGifHash } from "@/lib/email/gif-hash";
import { uploadFile, parseStorageUrl } from "@/lib/bunny/storage";
import { pickBunnyMp4Fallback } from "@/lib/bunny/mp4-fallback";
import { signStreamHlsUrl } from "@/lib/bunny/sign-url";
import { probeVideoDuration } from "@/lib/ffprobe";
import { runFfmpeg } from "../lib/ffmpeg";
import { createTempDir, cleanupTempDir } from "../lib/temp";
import { trackAndRefAsset } from "../lib/bunny-asset-tracking";
import type { EmailGifJobData } from "../email-gif-queue";

const GIF_WIDTH = 600;
const GIF_FPS = 10;
/** Play-Icon nimmt ~30 % der GIF-Breite ein (wie play-icon-overlay.ts). */
const PLAY_ICON_WIDTH = Math.round(GIF_WIDTH * 0.3);

/** Identische Optik wie `worker/lib/play-icon-overlay.ts` (Inline-SVG). */
const PLAY_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">
  <circle cx="100" cy="100" r="90" fill="rgba(0,0,0,0.55)" />
  <path d="M 80 60 L 80 140 L 145 100 Z" fill="white" />
</svg>`;

function log(msg: string): void {
  // eslint-disable-next-line no-console
  console.log(`[email-gif] ${msg}`);
}

const HLS_PATTERN =
  /^https?:\/\/([^/]+)\/([0-9a-f-]{36})\/playlist\.m3u8(?:\?.*)?$/i;

/**
 * Sammelt MP4-Download-Kandidaten für einen Lead. `videoMp4Url` zuerst
 * (bereits von der Pipeline aufgelöst), dann die HLS-URL via Bunny-API
 * bzw. der statische `play_480p`-Fallback.
 */
async function collectVideoCandidates(lead: {
  videoMp4Url: string | null;
  videoUrl: string | null;
}): Promise<string[]> {
  const out: string[] = [];
  if (lead.videoMp4Url) out.push(lead.videoMp4Url);
  if (lead.videoUrl) {
    const m = lead.videoUrl.match(HLS_PATTERN);
    if (m) {
      try {
        const { getVideoDownloadUrls } = await import("@/lib/bunny/stream");
        const dl = await getVideoDownloadUrls(m[2], m[1]);
        for (const d of dl) out.push(d.url);
      } catch (err) {
        log(
          `bunny meta lookup failed for ${m[2]}: ${(err as Error).message} — using static fallback`,
        );
        out.push(pickBunnyMp4Fallback(lead.videoUrl));
      }
    } else if (!lead.videoUrl.includes(".m3u8")) {
      // Nicht-HLS (Bunny Storage / externes MP4) → direkt versuchen.
      out.push(lead.videoUrl);
    }
  }
  return Array.from(new Set(out));
}

async function downloadVideo(
  candidates: string[],
  outPath: string,
): Promise<boolean> {
  const referer = process.env.APP_URL ?? "https://app.videocomet.de";
  const headers = {
    Referer: referer,
    Origin: referer,
    "User-Agent": "videocomet-worker/1.0",
  };
  for (const raw of candidates) {
    // signStreamHlsUrl ist ein No-Op für Nicht-Stream-URLs und strippt
    // vorhandene Tokens vor dem Re-Signing.
    const url = signStreamHlsUrl(raw);
    try {
      const res = await fetch(url, { headers });
      if (!res.ok) continue;
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length === 0) continue;
      await writeFile(outPath, buf);
      return true;
    } catch {
      // nächster Kandidat
    }
  }
  return false;
}

/**
 * Encodiert den GIF-Ausschnitt in EINEM ffmpeg-Aufruf:
 * fps → scale 600 → Play-Overlay → split → palettegen/paletteuse.
 */
async function encodeGif(input: {
  videoPath: string;
  overlayPngPath: string;
  outPath: string;
  startSec: number;
  durationSec: number;
}): Promise<void> {
  const filter = [
    `[0:v]fps=${GIF_FPS},scale=${GIF_WIDTH}:-2:flags=lanczos[base]`,
    `[base][1:v]overlay=(W-w)/2:(H-h)/2[ov]`,
    `[ov]split[s0][s1]`,
    `[s0]palettegen=stats_mode=diff[p]`,
    `[s1][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle`,
  ].join(";");

  await runFfmpeg([
    "-y",
    "-ss",
    input.startSec.toFixed(3),
    "-t",
    input.durationSec.toFixed(3),
    "-i",
    input.videoPath,
    "-i",
    input.overlayPngPath,
    "-filter_complex",
    filter,
    "-loop",
    "0",
    input.outPath,
  ]);
}

export type EmailGifJobResult =
  | { status: "done"; gifUrl: string }
  | { status: "skipped"; reason: string };

export async function processEmailGifJob(
  job: Job<EmailGifJobData>,
): Promise<EmailGifJobResult> {
  const { leadId, campaignId, userId } = job.data;

  const [lead] = await db
    .select({
      id: leads.id,
      campaignId: leads.campaignId,
      videoUrl: leads.videoUrl,
      videoMp4Url: leads.videoMp4Url,
      videoContentHash: leads.videoContentHash,
      emailGifUrl: leads.emailGifUrl,
      emailGifHash: leads.emailGifHash,
    })
    .from(leads)
    .where(eq(leads.id, leadId))
    .limit(1);
  if (!lead) return { status: "skipped", reason: "lead not found" };

  const [campaign] = await db
    .select({ emailGifConfig: campaigns.emailGifConfig })
    .from(campaigns)
    .where(eq(campaigns.id, campaignId))
    .limit(1);
  const config = campaign?.emailGifConfig;
  if (!config) return { status: "skipped", reason: "no gif config" };

  const expectedHash = computeEmailGifHash(lead.videoContentHash, config);
  if (lead.emailGifHash === expectedHash && lead.emailGifUrl) {
    return { status: "skipped", reason: "hash unchanged" };
  }

  const candidates = await collectVideoCandidates(lead);
  if (candidates.length === 0) {
    return { status: "skipped", reason: "no video source" };
  }

  const tmpDir = await createTempDir(`email-gif-${leadId.slice(0, 8)}`);
  try {
    const videoPath = join(tmpDir, "in.mp4");
    const ok = await downloadVideo(candidates, videoPath);
    if (!ok) {
      throw new Error(
        `video download failed for lead ${leadId} (${candidates.length} candidates)`,
      );
    }

    // Start-Offset clampen, damit -ss nie hinter dem Video-Ende liegt
    // (ffmpeg produziert sonst ein leeres GIF). Best-effort: wenn die
    // Probe fehlschlägt, nehmen wir die Config wie sie ist.
    let startSec = Math.max(0, config.startSec);
    const durationSec = Math.min(4, Math.max(2, config.durationSec));
    const videoDuration = await probeVideoDuration(videoPath);
    if (videoDuration && videoDuration > 0) {
      startSec = Math.max(
        0,
        Math.min(startSec, Math.max(0, videoDuration - durationSec)),
      );
    }

    const overlayPngPath = join(tmpDir, "play.png");
    const overlayBuf = await sharp(Buffer.from(PLAY_ICON_SVG))
      .resize({ width: PLAY_ICON_WIDTH })
      .png()
      .toBuffer();
    await writeFile(overlayPngPath, overlayBuf);

    const gifPath = join(tmpDir, "out.gif");
    await encodeGif({
      videoPath,
      overlayPngPath,
      outPath: gifPath,
      startSec,
      durationSec,
    });

    const gifBuffer = await readFile(gifPath);
    const uploaded = await uploadFile({
      buffer: gifBuffer,
      remotePath: `email-gifs/${campaignId}/${leadId}.gif`,
      contentType: "image/gif",
    });

    // Storage-Asset tracken (best-effort) — kein Stream-GUID, daher kein
    // Eintrag im Known-Set des Bunny-Library-Reconcilers nötig.
    const parsedStorage = parseStorageUrl(uploaded.url);
    if (parsedStorage) {
      await trackAndRefAsset({
        trackInput: {
          userId,
          kind: "storage",
          bunnyId: parsedStorage.path,
          cdnUrl: uploaded.url,
        },
        ownerType: "lead",
        ownerId: leadId,
      });
    }

    await db
      .update(leads)
      .set({ emailGifUrl: uploaded.url, emailGifHash: expectedHash })
      .where(eq(leads.id, leadId));

    log(
      `lead ${leadId.slice(0, 8)}…: gif encoded (${startSec.toFixed(1)}s +${durationSec}s, ${(gifBuffer.length / 1024).toFixed(0)} KB)`,
    );
    return { status: "done", gifUrl: uploaded.url };
  } finally {
    await cleanupTempDir(tmpDir);
  }
}
