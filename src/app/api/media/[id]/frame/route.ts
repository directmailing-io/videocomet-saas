export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { requireUserApi } from "@/lib/auth-guard";
import { getMediaItem } from "@/lib/db/queries/media";
import { pickBunnyMp4Fallback } from "@/lib/bunny/mp4-fallback";

/**
 * GET /api/media/[id]/frame?ms=12345
 *
 * Returns a single JPG frame extracted from the webcam recording at the
 * given millisecond offset. The endpoint is used by the campaign wizard so
 * the user can SEE the exact frame that will end up as the thumbnail in
 * the personalized PDF.
 *
 * Why we do this in the API process (not the worker queue): the preview
 * needs to update in ~real-time as the user drags the ms input. Round-
 * tripping through Redis/BullMQ would feel sluggish. ffmpeg only needs ~50-
 * 200ms for a single frame, so a direct synchronous spawn is fast enough.
 *
 * Bunny CDN blocks none-referer requests via its hot-link protection.
 * We pass APP_URL as the Referer so the source MP4 download succeeds.
 *
 * Cache: response is deterministic in (mediaId, ms). We rely on the browser
 * cache (private, max-age=3600) — no server-side cache for v1.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await requireUserApi();
  if (!auth.ok) return auth.response;

  // ── Validate ms query param ───────────────────────────────────────────
  const msParam = req.nextUrl.searchParams.get("ms");
  if (msParam === null || msParam.trim() === "") {
    return NextResponse.json(
      { error: "Parameter 'ms' erforderlich." },
      { status: 400 },
    );
  }
  const ms = Number(msParam);
  if (!Number.isFinite(ms) || !Number.isInteger(ms) || ms < 0) {
    return NextResponse.json(
      { error: "Parameter 'ms' muss eine positive Ganzzahl sein." },
      { status: 400 },
    );
  }

  // ── Lookup media (also enforces tenant ownership) ─────────────────────
  let media;
  try {
    media = await getMediaItem(params.id, auth.user.id);
  } catch {
    return NextResponse.json({ error: "Nicht gefunden." }, { status: 404 });
  }

  if (media.type !== "webcam") {
    return NextResponse.json(
      { error: "Frame-Extraktion nur für Webcam-Aufnahmen möglich." },
      { status: 400 },
    );
  }

  // ── Download source MP4/WebM into a temp file ─────────────────────────
  // Bunny serves both Stream (HLS) and Storage (mp4/webm). Für HLS-Playlists
  // schalten wir auf den progressiven MP4-Pfad um, damit ffmpeg seeken kann.
  // `pickBunnyMp4Fallback` nutzt — wenn auf dem Media-Item persistiert — die
  // tatsächlich gerenderten `availableResolutions`, sonst sicheren 480p-
  // Default (existiert auch für Portrait-Quellen, anders als 720p).
  const downloadUrl = pickBunnyMp4Fallback(
    media.publicUrl,
    media.availableResolutions,
  );

  const referer =
    process.env.APP_URL ??
    process.env.NEXT_PUBLIC_APP_URL ??
    "https://app.videocomet.de";

  const ext = downloadUrl.toLowerCase().includes(".webm") ? "webm" : "mp4";
  const tmpPath = join(tmpdir(), `vc-frame-${randomUUID()}.${ext}`);

  try {
    const res = await fetch(downloadUrl, {
      headers: {
        Referer: referer,
        "User-Agent": "videocomet-frame-preview/1.0",
      },
    });
    if (!res.ok) {
      console.error(
        `[api/media/frame] download failed: ${res.status} ${downloadUrl}`,
      );
      return NextResponse.json(
        { error: "Quell-Video konnte nicht geladen werden." },
        { status: 502 },
      );
    }
    const buf = Buffer.from(await res.arrayBuffer());
    await writeFile(tmpPath, buf);

    // ── Extract single frame via ffmpeg → JPG on stdout ────────────────
    const ffmpegBin = process.env.FFMPEG_PATH ?? "/usr/bin/ffmpeg";
    const seconds = (ms / 1000).toFixed(3);

    const jpg = await new Promise<Buffer>((resolve, reject) => {
      const child = spawn(
        ffmpegBin,
        [
          "-hide_banner",
          "-loglevel",
          "error",
          // -ss BEFORE -i = fast input-seek
          "-ss",
          `${seconds}`,
          "-i",
          tmpPath,
          "-frames:v",
          "1",
          "-q:v",
          "3",
          "-f",
          "mjpeg",
          "pipe:1",
        ],
        { stdio: ["ignore", "pipe", "pipe"] },
      );
      const chunks: Buffer[] = [];
      let stderrTail = "";
      child.stdout.on("data", (c: Buffer) => chunks.push(c));
      child.stderr.on("data", (c: Buffer) => {
        stderrTail = (stderrTail + c.toString("utf8")).slice(-2048);
      });
      child.on("error", reject);
      child.on("close", (code) => {
        if (code === 0) {
          resolve(Buffer.concat(chunks));
        } else {
          reject(
            new Error(`ffmpeg exited with code ${code}: ${stderrTail.trim()}`),
          );
        }
      });
    });

    if (jpg.length === 0) {
      return NextResponse.json(
        { error: "Frame konnte nicht extrahiert werden." },
        { status: 500 },
      );
    }

    // Wrap the Buffer in a Blob — Next's BodyInit typings reject Node Buffer
    // even though it's a Uint8Array at runtime. Same pattern as
    // src/app/api/markers/[type]/route.ts.
    const ab = jpg.buffer.slice(
      jpg.byteOffset,
      jpg.byteOffset + jpg.byteLength,
    ) as ArrayBuffer;
    const blob = new Blob([ab], { type: "image/jpeg" });
    return new NextResponse(blob, {
      status: 200,
      headers: {
        "Content-Type": "image/jpeg",
        "Content-Length": String(jpg.byteLength),
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch (err) {
    console.error("[api/media/frame] error:", err);
    return NextResponse.json(
      { error: "Frame-Extraktion fehlgeschlagen." },
      { status: 500 },
    );
  } finally {
    // Cleanup temp file. unlink errors are non-fatal (e.g. if the file
    // was never written because the download failed).
    await unlink(tmpPath).catch(() => undefined);
  }
}
