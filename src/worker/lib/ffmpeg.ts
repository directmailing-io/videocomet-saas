/**
 * FFmpeg wrapper.
 *
 * Three public helpers are needed by the pipeline:
 *  - `extractFrame`  - grab a single JPG at a given time offset (for the
 *                       PDF-letter thumbnail)
 *  - `compressVideo` - re-encode to the Bunny-friendly H.264 baseline
 *                       (3-5 MB target for 30 seconds)
 *  - `composePip`    - overlay a webcam clip on top of a "base" clip with
 *                       a configurable PiP position and shape
 *
 * All helpers spawn ffmpeg as a child_process with an args-array (no shell
 * interpolation) and stream stderr to the logger with a `[ffmpeg]` prefix.
 */

import { spawn } from "node:child_process";

function ffmpegPath(): string {
  return process.env.FFMPEG_PATH ?? "/usr/bin/ffmpeg";
}

/**
 * Runs ffmpeg with the given args. Resolves on exit-code 0, rejects with the
 * tail of stderr otherwise.
 */
function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath(), args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderrTail = "";
    child.stderr.on("data", (chunk: Buffer) => {
      const txt = chunk.toString("utf8");
      // Keep last ~4KB of stderr for diagnostics.
      stderrTail = (stderrTail + txt).slice(-4096);
      // eslint-disable-next-line no-console
      txt.split("\n").forEach((line) => {
        if (line.trim()) console.error(`[ffmpeg] ${line}`);
      });
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited with code ${code}: ${stderrTail}`));
    });
  });
}

export interface ExtractFrameInput {
  inputPath: string;
  outputPath: string;
  atMs: number;
}

/**
 * Extracts a single frame from a video at the given millisecond offset.
 * Uses `-ss` BEFORE `-i` for fast input-seek. Quality is set to `-q:v 2`
 * (high-quality JPG, near-lossless).
 */
export async function extractFrame(input: ExtractFrameInput): Promise<void> {
  const seconds = Math.max(0, input.atMs / 1000);
  await runFfmpeg([
    "-y",
    "-ss",
    seconds.toFixed(3),
    "-i",
    input.inputPath,
    "-vframes",
    "1",
    "-q:v",
    "2",
    input.outputPath,
  ]);
}

export interface CompressSettings {
  width?: number;
  height?: number;
  fps?: number;
  crf?: number;
  preset?: string;
  audioBitrate?: string;
}

const DEFAULT_COMPRESS: Required<CompressSettings> = {
  width: 1280,
  height: 720,
  fps: 30,
  crf: 26,
  preset: "veryfast",
  audioBitrate: "128k",
};

export interface CompressInput {
  inputPath: string;
  outputPath: string;
  settings?: CompressSettings;
}

/**
 * Re-encodes a video to the Bunny-friendly preset:
 *   H.264 baseline, yuv420p, 30 fps, 1280x720, CRF 26, AAC 128k, +faststart.
 */
export async function compressVideo(input: CompressInput): Promise<void> {
  const s = { ...DEFAULT_COMPRESS, ...(input.settings ?? {}) };
  await runFfmpeg([
    "-y",
    "-i",
    input.inputPath,
    "-c:v",
    "libx264",
    "-preset",
    s.preset,
    "-profile:v",
    "baseline",
    "-level",
    "3.1",
    "-pix_fmt",
    "yuv420p",
    "-crf",
    String(s.crf),
    "-r",
    String(s.fps),
    "-vf",
    `scale=${s.width}:${s.height}:force_original_aspect_ratio=decrease,pad=${s.width}:${s.height}:(ow-iw)/2:(oh-ih)/2:black`,
    "-c:a",
    "aac",
    "-b:a",
    s.audioBitrate,
    "-movflags",
    "+faststart",
    input.outputPath,
  ]);
}

export type PipPosition = "left" | "right";
export type PipShape = "square" | "rounded" | "circle";

export interface ComposePipInput {
  basePath: string;
  webcamPath: string;
  outputPath: string;
  position: PipPosition;
  shape: PipShape;
  durationSec: number;
}

/**
 * Compose a PiP overlay of a webcam clip on top of a base clip.
 *
 * NOTE: This is the v1 implementation. It handles the three shapes via
 * ffmpeg filter chains (square/rounded/circle), positions the overlay in
 * the bottom-left or bottom-right with a 24px margin, and clips the total
 * length to `durationSec`.
 */
export async function composePip(input: ComposePipInput): Promise<void> {
  const margin = 24;
  // Webcam scaled to 25% of base width (320x240 area).
  const overlayW = 320;
  const overlayH = 240;

  // Position expression.
  const x = input.position === "left" ? `${margin}` : `main_w-overlay_w-${margin}`;
  const y = `main_h-overlay_h-${margin}`;

  // Shape mask: square -> no mask; rounded -> rounded rect; circle -> circle.
  // For simplicity in v1, we use a separate "format=rgba" + geq mask chain.
  let maskChain = "";
  if (input.shape === "circle") {
    maskChain =
      `,format=rgba,geq='r=r(X,Y):g=g(X,Y):b=b(X,Y):a=if(lt(hypot(X-${overlayW / 2},Y-${overlayH / 2}),${Math.min(overlayW, overlayH) / 2}),255,0)'`;
  } else if (input.shape === "rounded") {
    // Soft rounded corners via a simple geq mask (24px radius).
    const r = 24;
    maskChain =
      `,format=rgba,geq='r=r(X,Y):g=g(X,Y):b=b(X,Y):a=if(` +
      `gt(min(min(X,${overlayW}-X),min(Y,${overlayH}-Y)),${r}),255,` +
      `if(lt(hypot(max(0,${r}-X),max(0,${r}-Y)),${r}),255,` +
      `if(lt(hypot(max(0,X-(${overlayW}-${r})),max(0,${r}-Y)),${r}),255,` +
      `if(lt(hypot(max(0,${r}-X),max(0,Y-(${overlayH}-${r}))),${r}),255,` +
      `if(lt(hypot(max(0,X-(${overlayW}-${r})),max(0,Y-(${overlayH}-${r}))),${r}),255,0)))))'`;
  }

  const filterComplex =
    `[1:v]scale=${overlayW}:${overlayH}${maskChain}[pip];` +
    `[0:v][pip]overlay=${x}:${y}:format=auto,format=yuv420p`;

  await runFfmpeg([
    "-y",
    "-i",
    input.basePath,
    "-i",
    input.webcamPath,
    "-filter_complex",
    filterComplex,
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "26",
    "-t",
    String(input.durationSec),
    "-c:a",
    "aac",
    "-b:a",
    "128k",
    "-movflags",
    "+faststart",
    input.outputPath,
  ]);
}

/**
 * Generates a black silent video clip of the requested duration. Used as a
 * placeholder when the base video stream is not yet implemented (v1
 * webcam-only mode does not need a presentation track).
 */
export async function generateBlackClip(opts: {
  outputPath: string;
  durationSec: number;
  width?: number;
  height?: number;
  fps?: number;
}): Promise<void> {
  const w = opts.width ?? 1280;
  const h = opts.height ?? 720;
  const fps = opts.fps ?? 30;
  await runFfmpeg([
    "-y",
    "-f",
    "lavfi",
    "-i",
    `color=c=black:s=${w}x${h}:r=${fps}:d=${opts.durationSec}`,
    "-f",
    "lavfi",
    "-i",
    `anullsrc=channel_layout=stereo:sample_rate=44100`,
    "-shortest",
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "26",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-b:a",
    "128k",
    "-movflags",
    "+faststart",
    opts.outputPath,
  ]);
}
