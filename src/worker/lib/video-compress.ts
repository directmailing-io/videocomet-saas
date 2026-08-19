/**
 * Bunny-friendly video compression helper.
 *
 * Single public entrypoint `compressForBunny()` that takes an arbitrary input
 * MP4/WebM/MOV and produces an MP4 ready for `uploadVideo()` to Bunny Stream.
 *
 * Heuristik:
 *   1. ffprobe input → codec, profile, bitrate, pix_fmt, width, height.
 *   2. SKIP-Re-Encode-Pfad: source is already H.264 (Baseline/Main/High),
 *      bitrate < 3.5 Mbps and yuv420p → ffmpeg `-c copy` (just remux to MP4
 *      + faststart). Spart Minuten Encode-Zeit auf Webcam-Recordings die
 *      ohnehin schon H.264 sind.
 *   3. RE-ENCODE-Pfad: libx264 veryfast + CRF23 + Bunny-MaxRate +
 *      faststart. Resolution-aware: NIE upscalen, NIE letterboxen.
 *        - Landscape (w >= h): cap 1280×720
 *        - Portrait (w < h):  cap 720×1280
 *        - Square (w == h):   cap 720×720 (fällt unter landscape-Branch,
 *          aber explizit gehandhabt)
 *      Scale-Formel `'min(in_w,W):min(in_h,H):force_original_aspect_ratio=
 *      decrease'` sorgt dafür dass kleinere Sources (z.B. 404×720 Selfie)
 *      KEINE Upscale-Variante bekommen.
 *
 * Failure-Modus:
 *   ffmpeg crash / probe error → wir kopieren die Quelle nach outputPath
 *   und liefern `skipped:false`+`bytesIn==bytesOut` zurück. KEIN Hard-Fail
 *   in der Pipeline — der Upload klappt auch ohne unsere Optimierung.
 */

import { spawn } from "node:child_process";
import { copyFile, stat } from "node:fs/promises";
import {
  capLibx264Threads,
  isLibx264Encode,
  withEncodeSlot,
} from "./encode-limiter";

const FFPROBE_PATH = process.env.FFPROBE_PATH ?? "ffprobe";
const FFMPEG_PATH = process.env.FFMPEG_PATH ?? "/usr/bin/ffmpeg";

/** Bunny-Stream-Source-Bitrate-Ceiling: oberhalb dessen re-encoden wir. */
const MAX_PASSTHROUGH_BITRATE = 3_500_000;

/** Bunny Stream entcoded H.264 — Re-Encode-Profile + Levels die wir akzeptieren. */
const PASSTHROUGH_PROFILES = new Set([
  "baseline",
  "main",
  "high",
  "constrained baseline",
]);

export type VideoOrientation = "landscape" | "portrait" | "square";

export interface CompressTask {
  inputPath: string;
  outputPath: string;
  /** Free-form label for logs (e.g. "webcam-source", "rendered-final"). */
  reason: string;
}

export interface CompressResult {
  outputPath: string;
  /** True wenn nur remux (`-c copy`), false wenn re-encoded. */
  skipped: boolean;
  bytesIn: number;
  bytesOut: number;
  encodingMs: number;
  /** H.264 / WebM / etc. (lower-case, vom ffprobe). */
  codec: string;
  orientation: VideoOrientation;
}

interface ProbedMeta {
  codec: string;
  profile: string;
  pixFmt: string;
  bitrate: number;
  width: number;
  height: number;
}

function classifyOrientation(w: number, h: number): VideoOrientation {
  if (w === h) return "square";
  return w > h ? "landscape" : "portrait";
}

/**
 * Probt codec/profile/bitrate/dim in EINEM ffprobe-Call. ffprobe-Output:
 *   codec=h264|profile=High|width=1920|height=1080|pix_fmt=yuv420p|bit_rate=2500000
 * Fehlerhafte Werte werden defensiv auf "" / 0 normalisiert; der Heuristik-
 * Code daneben markiert Skip dann als "nicht möglich" und faellt auf
 * Re-Encode zurueck.
 */
async function probeMeta(filePath: string): Promise<ProbedMeta | null> {
  return new Promise((resolve) => {
    const proc = spawn(
      FFPROBE_PATH,
      [
        "-v",
        "error",
        "-select_streams",
        "v:0",
        "-show_entries",
        "stream=codec_name,profile,bit_rate,width,height,pix_fmt",
        "-of",
        "default=noprint_wrappers=1",
        filePath,
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    let stdout = "";
    proc.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    proc.on("error", () => resolve(null));
    proc.on("close", (code) => {
      if (code !== 0) return resolve(null);
      const map: Record<string, string> = {};
      for (const line of stdout.split(/\r?\n/)) {
        const idx = line.indexOf("=");
        if (idx < 0) continue;
        map[line.slice(0, idx).trim().toLowerCase()] =
          line.slice(idx + 1).trim();
      }
      const codec = (map.codec_name ?? "").toLowerCase();
      const profile = (map.profile ?? "").toLowerCase();
      const pixFmt = (map.pix_fmt ?? "").toLowerCase();
      const bitrate = parseInt(map.bit_rate ?? "0", 10) || 0;
      const width = parseInt(map.width ?? "0", 10) || 0;
      const height = parseInt(map.height ?? "0", 10) || 0;
      if (!codec || width < 8 || height < 8) return resolve(null);
      resolve({ codec, profile, pixFmt, bitrate, width, height });
    });
  });
}

/**
 * Run ffmpeg with the given args. Resolves on exit-code 0, otherwise
 * rejects with the last 1KB of stderr. Streams stderr per line to
 * `console.error` with a `[ffmpeg]` prefix so the worker logs are
 * scannable.
 */
function runFfmpeg(rawArgs: string[]): Promise<void> {
  // M2: libx264-Encodes bekommen -threads 3 injiziert und laufen durch die
  // globale Encode-Semaphore (max 4 parallel). Remux-/Copy-Ops unlimitiert.
  const args = capLibx264Threads(rawArgs);
  if (isLibx264Encode(args)) {
    return withEncodeSlot(() => spawnFfmpeg(args));
  }
  return spawnFfmpeg(args);
}

function spawnFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(FFMPEG_PATH, args, {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderrTail = "";
    child.stderr.on("data", (chunk: Buffer) => {
      const txt = chunk.toString("utf8");
      stderrTail = (stderrTail + txt).slice(-4096);
      txt.split("\n").forEach((line) => {
        if (line.trim()) console.error(`[ffmpeg] ${line}`);
      });
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else
        reject(
          new Error(
            `ffmpeg exited with code ${code}: ${stderrTail.slice(-1024)}`,
          ),
        );
    });
  });
}

/**
 * Bestimmt die Ziel-Output-Auflösung anhand der Source-Dimensionen.
 *   - landscape: 1280×720 cap
 *   - portrait:  720×1280 cap
 *   - square:    720×720  cap
 * Wird NUR im Re-Encode-Pfad gebraucht; die Skip-Variante kopiert pixel-
 * genau die Source.
 */
function pickOutputCap(
  orientation: VideoOrientation,
): { w: number; h: number } {
  if (orientation === "portrait") return { w: 720, h: 1280 };
  if (orientation === "square") return { w: 720, h: 720 };
  return { w: 1280, h: 720 };
}

/**
 * Hauptentry. Idempotent, wirft nicht — bei Probe- oder ffmpeg-Fehler
 * kopiert sie die Source und liefert `skipped:false, bytesIn==bytesOut`.
 */
export async function compressForBunny(
  task: CompressTask,
): Promise<CompressResult> {
  const t0 = Date.now();
  const inStat = await stat(task.inputPath);
  const bytesIn = inStat.size;

  const meta = await probeMeta(task.inputPath);
  // Wenn der Probe failed: defensiv ein Re-Encode versuchen mit Standard-
  // Landscape-Cap. Das ist nicht schlimmer als das alte Verhalten.
  if (!meta) {
    console.warn(
      `[video-compress] probe failed for ${task.reason} (${task.inputPath}) — defensive re-encode at 1280x720`,
    );
    try {
      await reEncode({
        inputPath: task.inputPath,
        outputPath: task.outputPath,
        out: { w: 1280, h: 720 },
      });
      const outStat = await stat(task.outputPath);
      return {
        outputPath: task.outputPath,
        skipped: false,
        bytesIn,
        bytesOut: outStat.size,
        encodingMs: Date.now() - t0,
        codec: "unknown",
        orientation: "landscape",
      };
    } catch (err) {
      console.warn(
        `[video-compress] re-encode failed after probe fail, copying source as-is:`,
        err instanceof Error ? err.message : err,
      );
      await copyFile(task.inputPath, task.outputPath);
      return {
        outputPath: task.outputPath,
        skipped: false,
        bytesIn,
        bytesOut: bytesIn,
        encodingMs: Date.now() - t0,
        codec: "unknown",
        orientation: "landscape",
      };
    }
  }

  const orientation = classifyOrientation(meta.width, meta.height);

  // Skip-Heuristik: Source bereits Bunny-tauglich → nur remux.
  const canPassthrough =
    meta.codec === "h264" &&
    PASSTHROUGH_PROFILES.has(meta.profile) &&
    meta.pixFmt === "yuv420p" &&
    meta.bitrate > 0 &&
    meta.bitrate < MAX_PASSTHROUGH_BITRATE;

  if (canPassthrough) {
    try {
      // Pures Remux: kein Re-Encode, nur Container + Faststart neu schreiben.
      // Spart Encode-Zeit für Webcams die ohnehin H.264 ausspielen.
      await runFfmpeg([
        "-y",
        "-i",
        task.inputPath,
        "-c",
        "copy",
        "-movflags",
        "+faststart",
        "-f",
        "mp4",
        task.outputPath,
      ]);
      const outStat = await stat(task.outputPath);
      console.log(
        `[video-compress] passthrough ${task.reason} ${meta.width}x${meta.height} ${meta.codec}/${meta.profile} ${(bytesIn / 1024 / 1024).toFixed(2)}MB → ${(outStat.size / 1024 / 1024).toFixed(2)}MB in ${Date.now() - t0}ms`,
      );
      return {
        outputPath: task.outputPath,
        skipped: true,
        bytesIn,
        bytesOut: outStat.size,
        encodingMs: Date.now() - t0,
        codec: meta.codec,
        orientation,
      };
    } catch (err) {
      console.warn(
        `[video-compress] passthrough remux failed for ${task.reason} (${err instanceof Error ? err.message : err}) — falling through to re-encode`,
      );
      // fall through to re-encode
    }
  }

  // Re-Encode-Pfad: Bunny-friendly preset.
  const cap = pickOutputCap(orientation);
  try {
    await reEncode({
      inputPath: task.inputPath,
      outputPath: task.outputPath,
      out: cap,
    });
    const outStat = await stat(task.outputPath);
    console.log(
      `[video-compress] re-encode ${task.reason} ${meta.width}x${meta.height} ${meta.codec}/${meta.profile} → cap ${cap.w}x${cap.h} (${orientation}) ${(bytesIn / 1024 / 1024).toFixed(2)}MB → ${(outStat.size / 1024 / 1024).toFixed(2)}MB in ${Date.now() - t0}ms`,
    );
    return {
      outputPath: task.outputPath,
      skipped: false,
      bytesIn,
      bytesOut: outStat.size,
      encodingMs: Date.now() - t0,
      codec: meta.codec,
      orientation,
    };
  } catch (err) {
    // Final fallback: copy source as-is. Soft-fail — Bunny wird das Original
    // notfalls re-encoden, der Render-Output wird groesser, aber der Upload
    // klappt und der Lead completed.
    console.warn(
      `[video-compress] re-encode failed for ${task.reason} (${err instanceof Error ? err.message : err}) — copying source as-is`,
    );
    await copyFile(task.inputPath, task.outputPath);
    return {
      outputPath: task.outputPath,
      skipped: false,
      bytesIn,
      bytesOut: bytesIn,
      encodingMs: Date.now() - t0,
      codec: meta.codec,
      orientation,
    };
  }
}

/**
 * Interner ffmpeg-Call mit dem Bunny-friendly Preset. Die `scale`-Formel
 * verwendet `min(in_w,W):min(in_h,H)` — bei einer kleineren Source bleibt
 * das Original-Pixelmaß, KEIN Upscale. Kein Letterbox/Pillarbox: die
 * `force_original_aspect_ratio=decrease`-Option sorgt nur dafür, dass
 * die Cap-Box NICHT überschritten wird; sie pad-t nichts ein.
 */
async function reEncode(opts: {
  inputPath: string;
  outputPath: string;
  out: { w: number; h: number };
}): Promise<void> {
  // ffmpeg lavfi: `min(in_w,W)` etc. erzwingt nie-upscale; `-2` ensures
  // the second dimension stays even (libx264 requirement).
  // Wir berechnen es zweistufig: erst cap auf W (kein upscale), dann
  // sicherstellen dass das resultierende height nicht > H wird.
  const vf =
    `scale='min(${opts.out.w},iw)':'min(${opts.out.h},ih)':force_original_aspect_ratio=decrease,` +
    `scale=trunc(iw/2)*2:trunc(ih/2)*2`;
  await runFfmpeg([
    "-y",
    "-i",
    opts.inputPath,
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "23",
    "-profile:v",
    "high",
    "-level",
    "4.1",
    "-pix_fmt",
    "yuv420p",
    "-maxrate",
    "3M",
    "-bufsize",
    "6M",
    "-vf",
    vf,
    "-c:a",
    "aac",
    "-b:a",
    "128k",
    "-movflags",
    "+faststart",
    // Explizites Container-Format: Caller übergeben teils endungslose
    // Tmp-Pfade — ffmpeg darf das Format nie aus der Endung raten müssen.
    "-f",
    "mp4",
    opts.outputPath,
  ]);
}
