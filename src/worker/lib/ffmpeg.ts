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
import { dirname, join } from "node:path";
import sharp from "sharp";
import {
  capLibx264Threads,
  isLibx264Encode,
  withEncodeSlot,
} from "./encode-limiter";

function ffmpegPath(): string {
  return process.env.FFMPEG_PATH ?? "/usr/bin/ffmpeg";
}

/**
 * Module-level cache for rounded-rect mask PNGs. The same (width, height,
 * radius) tuple produces the same bytes every render, so we cache the
 * Buffer in memory and write it to disk on demand. Keyed by
 * `${width}x${height}_r${radius}`. Saves ~50ms per video composition
 * (sharp boot + SVG raster + file write) at the cost of a few KB of RAM
 * per unique mask size.
 *
 * The cache is per-process (single-process Node, no race), so a worker
 * restart starts cold but warms in 1-2 leads.
 */
const ROUNDED_MASK_CACHE = new Map<string, Buffer>();

/**
 * Render (or fetch from cache) a rounded-rectangle alpha mask. The PNG
 * is RGBA: pixels inside the rounded rect are white+opaque (a=255),
 * pixels outside the corners are transparent (a=0). Designed to be
 * consumed by ffmpeg's `alphamerge` filter, which takes the alpha
 * channel of input #2 and merges it into input #1. The radius defaults
 * to ~14% of the smaller dimension — that's the "Apple-icon squircle"
 * feel that designers usually mean when they say "abgerundet".
 *
 * Returns the PNG bytes. If `outPath` is provided, also writes them to
 * disk (ffmpeg consumes the mask via `-i` so we still need a path on
 * disk for the composePip code path).
 */
async function getRoundedRectMaskPng(opts: {
  width: number;
  height: number;
  radius?: number;
  outPath?: string;
}): Promise<Buffer> {
  const { width, height } = opts;
  const radius = opts.radius ?? Math.round(Math.min(width, height) * 0.14);
  const key = `${width}x${height}_r${radius}`;
  let buf = ROUNDED_MASK_CACHE.get(key);
  if (!buf) {
    const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect x="0" y="0" width="${width}" height="${height}" rx="${radius}" ry="${radius}" fill="#ffffff"/>
</svg>`;
    buf = await sharp(Buffer.from(svg, "utf-8")).png().toBuffer();
    ROUNDED_MASK_CACHE.set(key, buf);
  }
  if (opts.outPath) {
    const { writeFile } = await import("node:fs/promises");
    await writeFile(opts.outPath, buf);
  }
  return buf;
}

/**
 * Runs ffmpeg with the given args. Resolves on exit-code 0, rejects with the
 * tail of stderr otherwise.
 *
 * Error message strategy:
 *   - We keep the full last 4KB of stderr for log diagnostics (printed line
 *     by line as it arrives).
 *   - On a non-zero exit we surface a COMPACT 1KB summary in the thrown
 *     Error.message so the lead's errorMessage column (which is truncated
 *     to 1000 chars in pipeline.ts) still shows the cause rather than
 *     ffmpeg's verbose banner. We prefer lines that mention "Error",
 *     "Invalid", "Conversion failed" or similar — those are the lines that
 *     actually explain what went wrong; the rest is encoder noise.
 */
export function runFfmpeg(rawArgs: string[]): Promise<void> {
  // M2: libx264-Encodes bekommen -threads 3 injiziert und laufen durch die
  // globale Encode-Semaphore (max 4 parallel). Copy-/Remux-Ops unlimitiert.
  const args = capLibx264Threads(rawArgs);
  if (isLibx264Encode(args)) {
    return withEncodeSlot(() => spawnFfmpeg(args));
  }
  return spawnFfmpeg(args);
}

function spawnFfmpeg(args: string[]): Promise<void> {
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
      else reject(new Error(`ffmpeg exited with code ${code}: ${summariseFfmpegStderr(stderrTail)}`));
    });
  });
}

/**
 * Pick the most-informative lines out of ffmpeg stderr for the lead's
 * surfaced error message (cap ~1KB). ffmpeg's stderr is dominated by the
 * banner + per-stream metadata; the actual error usually appears as one or
 * two lines containing "Error", "Invalid", "Failed", "Conversion failed",
 * "No such file", "Permission denied", etc. We prefer those; if none match
 * we fall back to the last few non-empty lines.
 */
function summariseFfmpegStderr(stderr: string): string {
  if (!stderr.trim()) return "(empty stderr)";
  const lines = stderr.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const errorRegex = /(error|invalid|failed|no such file|permission denied|moov atom not found|protocol not on whitelist|unable to|conversion failed|cannot)/i;
  const matches = lines.filter((l) => errorRegex.test(l));
  const picked = matches.length > 0 ? matches : lines.slice(-6);
  const joined = picked.join(" | ");
  // Hard cap at 1KB so the message comfortably fits in the 1000-char
  // lead errorMessage column.
  return joined.length > 1024 ? `…${joined.slice(-1024)}` : joined;
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
  // Square / rounded use a 16:9 aspect to match the source webcam.
  // Circle is forced to 1:1 (with a cover crop) so the user's face stays
  // centered and isn't squashed.
  const isCircle = input.shape === "circle";
  const overlayW = isCircle ? 240 : 320;
  const overlayH = isCircle ? 240 : 180;

  // Scale: aspect-preserving. For 16:9 overlay we use `decrease` then pad —
  // the webcam is already 16:9 so it lands edge-to-edge with no distortion.
  // For circle we use `increase` + crop to fill the square without
  // squashing.
  const scaleChain = isCircle
    ? `scale=${overlayW}:${overlayH}:force_original_aspect_ratio=increase,crop=${overlayW}:${overlayH}`
    : `scale=${overlayW}:${overlayH}:force_original_aspect_ratio=decrease,pad=${overlayW}:${overlayH}:(ow-iw)/2:(oh-ih)/2:black`;

  // Position expression.
  const x = input.position === "left" ? `${margin}` : `main_w-overlay_w-${margin}`;
  const y = `main_h-overlay_h-${margin}`;

  // Shape mask:
  //   square  → no mask, plain overlay.
  //   rounded → sharp-rendered RGBA PNG mask (rounded rectangle, alpha=255
  //             inside, 0 outside) merged via `alphamerge`. ffmpeg's `geq`
  //             cannot reliably produce the squircle look at this scale, so
  //             we pre-bake the mask with sharp/SVG.
  //   circle  → in-filter `geq` mask (kept as-is from v1; the circular
  //             cover-cropped scale already gives a clean circle).
  let maskChain = "";
  if (isCircle) {
    maskChain =
      `,format=rgba,geq='r=r(X,Y):g=g(X,Y):b=b(X,Y):a=if(lt(hypot(X-${overlayW / 2},Y-${overlayH / 2}),${Math.min(overlayW, overlayH) / 2}),255,0)'`;
  }

  // Rounded path: generate a one-off mask PNG that sits next to the output
  // file. Cheap (a few ms, ~kilobytes) and avoids any persistent state on
  // the worker — every render produces and consumes its own mask.
  let extraInputs: string[] = [];
  let filterComplex: string;
  if (input.shape === "rounded") {
    const maskPath = join(dirname(input.outputPath), "pip-rounded-mask.png");
    await getRoundedRectMaskPng({
      width: overlayW,
      height: overlayH,
      outPath: maskPath,
    });
    // `-loop 1` turns the single-frame PNG into an endless video stream so
    // alphamerge has a frame for every webcam frame. The trailing `-t`
    // (further down the args list) bounds the overall output duration.
    extraInputs = ["-loop", "1", "-i", maskPath];
    // [1:v] = webcam, [2:v] = mask. Scale webcam, take alpha channel from
    // the mask, then overlay the masked PiP onto the base.
    filterComplex =
      `[1:v]${scaleChain},format=yuva420p[w];` +
      `[2:v]format=rgba[m];` +
      `[w][m]alphamerge[pip];` +
      `[0:v][pip]overlay=${x}:${y}:format=auto,format=yuv420p[vout]`;
  } else {
    // We name the final overlay stream [vout] so we can map it explicitly,
    // and we map ONLY the webcam audio (1:a) — the base track contains
    // anullsrc silence and would otherwise be picked by ffmpeg's auto-map.
    filterComplex =
      `[1:v]${scaleChain}${maskChain}[pip];` +
      `[0:v][pip]overlay=${x}:${y}:format=auto,format=yuv420p[vout]`;
  }

  await runFfmpeg([
    "-y",
    "-i",
    input.basePath,
    "-i",
    input.webcamPath,
    ...extraInputs,
    "-filter_complex",
    filterComplex,
    "-map",
    "[vout]",
    // Webcam audio takes priority. The `?` makes it optional so silent
    // webcams don't fail the encode.
    "-map",
    "1:a?",
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

export interface ImageSeqToMp4Input {
  /** Directory containing frame-NNNN.jpg files (zero-padded to 4 digits). */
  framesDir: string;
  /** Filename pattern, defaults to `frame-%04d.jpg`. */
  pattern?: string;
  outputPath: string;
  fps?: number;
  crf?: number;
  preset?: string;
}

/**
 * Encodes a zero-padded image sequence into an H.264 MP4 sized 1280x720.
 *
 *   ffmpeg -framerate 30 -i 'frames/frame-%04d.jpg' \
 *     -c:v libx264 -pix_fmt yuv420p -preset veryfast -crf 26 \
 *     -movflags +faststart out.mp4
 *
 * Used to turn the scroll-recorder frames into the "base" track that gets the
 * PiP webcam overlaid on top.
 */
export async function imageSeqToMp4(input: ImageSeqToMp4Input): Promise<void> {
  const fps = input.fps ?? 30;
  const crf = input.crf ?? 26;
  const preset = input.preset ?? "veryfast";
  const pattern = input.pattern ?? "frame-%04d.jpg";
  const inputPattern = `${input.framesDir.replace(/\/$/, "")}/${pattern}`;
  await runFfmpeg([
    "-y",
    "-framerate",
    String(fps),
    "-i",
    inputPattern,
    "-c:v",
    "libx264",
    "-preset",
    preset,
    "-pix_fmt",
    "yuv420p",
    "-crf",
    String(crf),
    "-r",
    String(fps),
    "-vf",
    "scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2:black,setsar=1",
    "-movflags",
    "+faststart",
    input.outputPath,
  ]);
}

/**
 * Loops a single PNG/JPG into an MP4 of the requested duration. Used by the
 * slide-renderer to turn the Puppeteer-Screenshot into a video clip.
 */
export async function renderImageToMp4(opts: {
  imagePath: string;
  durationMs: number;
  outputPath: string;
  fps?: number;
  width?: number;
  height?: number;
}): Promise<void> {
  const fps = opts.fps ?? 30;
  const w = opts.width ?? 1280;
  const h = opts.height ?? 720;
  const durationSec = Math.max(0.2, opts.durationMs / 1000);
  await runFfmpeg([
    "-y",
    "-loop",
    "1",
    "-framerate",
    String(fps),
    "-t",
    durationSec.toFixed(3),
    "-i",
    opts.imagePath,
    "-f",
    "lavfi",
    "-i",
    "anullsrc=channel_layout=stereo:sample_rate=44100",
    "-shortest",
    "-vf",
    `scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:black,setsar=1`,
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "23",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-shortest",
    "-movflags",
    "+faststart",
    opts.outputPath,
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

// ─── Segment rendering helpers ────────────────────────────────────────────

export interface RenderTextSegmentInput {
  text: string;
  bgColor: string;       // #RRGGBB
  textColor: string;     // #RRGGBB
  fontSize: number;
  textAlign: "left" | "center" | "right";
  fontWeight: "400" | "600" | "700";
  italic: boolean;
  durationMs: number;
  outputPath: string;
  /** Width / height of the output. Default 1280x720. */
  width?: number;
  height?: number;
}

/**
 * Render a single text-slide segment to an MP4 file. Uses ffmpeg's drawtext
 * filter on a solid color background. Multi-line text is split on `\n` and
 * each line is drawn with vertical spacing.
 *
 * Color values are #RRGGBB. The filter syntax requires 0xRRGGBB, so we
 * convert. Special chars in the text need to be escaped for drawtext.
 */
export async function renderTextSegment(input: RenderTextSegmentInput): Promise<void> {
  const w = input.width ?? 1280;
  const h = input.height ?? 720;
  const durationSec = Math.max(0.2, input.durationMs / 1000);
  const fps = 30;
  // Farben strikt validieren — sie landen unescaped im lavfi-Filtergraph.
  const toFilterColor = (raw: string, fallback: string) =>
    /^#[0-9a-fA-F]{6}$/.test(raw) ? raw.replace("#", "0x") : fallback;
  const bg = toFilterColor(input.bgColor, "0x000000");
  const fg = toFilterColor(input.textColor, "0xffffff");

  // Resolve a font file that exists on the worker image (Debian Bookworm).
  const fontFile =
    input.fontWeight === "700"
      ? "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
      : input.italic
        ? "/usr/share/fonts/truetype/dejavu/DejaVuSans-Oblique.ttf"
        : "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf";

  // Split into lines + escape drawtext special characters.
  const escape = (s: string) =>
    s
      .replace(/\\/g, "\\\\")
      .replace(/:/g, "\\:")
      .replace(/'/g, "\\'")
      .replace(/%/g, "\\%");

  const lines = input.text.split(/\r?\n/);
  const lineHeight = Math.round(input.fontSize * 1.4);
  const totalTextHeight = lines.length * lineHeight;
  const startY = `(h - ${totalTextHeight}) / 2`;

  const drawtextFilters = lines
    .map((line, i) => {
      const escaped = escape(line);
      const xExpr =
        input.textAlign === "left"
          ? "80"
          : input.textAlign === "right"
            ? "(w - text_w - 80)"
            : "(w - text_w) / 2";
      const yExpr = `${startY} + ${i * lineHeight}`;
      return [
        `drawtext=fontfile=${fontFile}`,
        `text='${escaped}'`,
        `fontcolor=${fg}`,
        `fontsize=${input.fontSize}`,
        `x=${xExpr}`,
        `y=${yExpr}`,
      ].join(":");
    })
    .join(",");

  const vfilter = drawtextFilters || "null";

  await runFfmpeg([
    "-y",
    "-f",
    "lavfi",
    "-i",
    `color=c=${bg}:s=${w}x${h}:r=${fps}:d=${durationSec}`,
    "-f",
    "lavfi",
    "-i",
    `anullsrc=channel_layout=stereo:sample_rate=44100`,
    "-shortest",
    "-vf",
    vfilter,
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
    input.outputPath,
  ]);
}

export interface ConcatClipsInput {
  /** Ordered list of MP4 paths to concat. All must share codec params. */
  inputPaths: string[];
  outputPath: string;
  /** Working dir for the temporary concat list. */
  workDir: string;
}

/**
 * Concat several MP4 files into one. Uses the demuxer concat method, which
 * is fast (no re-encode) and works when all inputs share codec parameters.
 * Since every segment is produced by renderTextSegment / renderBlackClip
 * with identical libx264/aac settings, this is safe.
 *
 * Wenn `maxDurationSec` gesetzt ist, wird das Output mit `-t` gekappt —
 * Safety-Net gegen drift (Segmente die geringfügig länger als ihr
 * deklarierter durationMs sind durch I-Frame-Alignment).
 */
export async function concatClips(input: ConcatClipsInput & {
  maxDurationSec?: number;
}): Promise<void> {
  const listPath = `${input.workDir.replace(/\/$/, "")}/concat-list.txt`;
  const lines = input.inputPaths.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join("\n");
  await (await import("node:fs/promises")).writeFile(listPath, lines, "utf-8");
  const args: string[] = [
    "-y",
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    listPath,
  ];
  if (typeof input.maxDurationSec === "number" && input.maxDurationSec > 0) {
    args.push("-t", input.maxDurationSec.toFixed(3));
  }
  args.push("-c", "copy", input.outputPath);
  await runFfmpeg(args);
}

/**
 * Trim ein MP4 auf eine exakte Dauer. Re-encode-frei via `-c copy` —
 * das schneidet am nächsten Keyframe ab. Für ein finales Safety-Net
 * "Output darf NIE länger als Webcam sein" reicht das. Wenn frame-genau
 * gewünscht wäre, müssten wir libx264 re-encoden — dafür sind die paar
 * Hundert ms am Ende nicht teuer genug.
 */
export async function trimVideoToDuration(input: {
  inputPath: string;
  outputPath: string;
  durationSec: number;
}): Promise<void> {
  await runFfmpeg([
    "-y",
    "-i",
    input.inputPath,
    "-t",
    input.durationSec.toFixed(3),
    "-c",
    "copy",
    "-movflags",
    "+faststart",
    input.outputPath,
  ]);
}
