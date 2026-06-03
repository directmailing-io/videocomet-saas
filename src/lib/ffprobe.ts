/**
 * ffprobe-Wrapper für die App-Layer.
 *
 * Wird beim Upload eines Webcam-Videos genutzt, um die echte Dauer zu
 * messen — sonst landet `media_items.durationSec` auf NULL und der
 * Render-Worker fällt auf einen 30-Sekunden-Fallback zurück → erzeugt
 * Output, der LÄNGER als die Webcam ist (kritisch, hat in Prod gerade
 * 22s-Videos auf 6s-Webcams produziert).
 *
 * Strenge Validierung: Werte unter 0.1s oder größer als 2h werden als
 * unzuverlässig verworfen (typische ffprobe-Glitches bei MediaRecorder-
 * WebMs ohne sauberen Duration-Header).
 */

import { mkdir, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";

const FFPROBE_PATH = process.env.FFPROBE_PATH ?? "ffprobe";
const FFMPEG_PATH = process.env.FFMPEG_PATH ?? "ffmpeg";

function runFfprobe(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(FFPROBE_PATH, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    proc.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`ffprobe exit ${code}: ${stderr.trim()}`));
    });
  });
}

/**
 * Letzter Fallback: ffmpeg im null-mux-Modus über die Datei laufen lassen
 * und die finale `time=HH:MM:SS.ss`-Zeile im stderr parsen. Funktioniert
 * auch bei MediaRecorder-WebMs ohne brauchbare Container- oder Stream-
 * Duration. Kostet O(Dauer) Sekunden CPU — bei 6-30s Webcams völlig ok.
 */
function runFfmpegNullProbe(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(
      FFMPEG_PATH,
      ["-i", filePath, "-map", "0:v:0", "-c", "copy", "-f", "null", "-"],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    let stderr = "";
    proc.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    proc.on("error", reject);
    proc.on("close", () => {
      // ffmpeg liefert exit-code != 0 wenn z.B. kein Audio-Stream — wir
      // wollen trotzdem den stderr-Output.
      resolve(stderr);
    });
  });
}

function parseFfmpegTimeLine(stderr: string): number | null {
  // ffmpeg gibt im stderr Zeilen wie:
  //   frame=  191 fps=… time=00:00:06.37 bitrate=… speed=…
  // Wir nehmen den höchsten time=… Wert aus allen Treffern.
  const re = /time=(\d{2}):(\d{2}):(\d{2})\.(\d{1,3})/g;
  let max = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(stderr))) {
    const h = parseInt(m[1], 10);
    const min = parseInt(m[2], 10);
    const s = parseInt(m[3], 10);
    const frac = parseInt(m[4].padEnd(3, "0"), 10) / 1000;
    const total = h * 3600 + min * 60 + s + frac;
    if (total > max) max = total;
  }
  return max > 0 ? max : null;
}

function parseDurationSec(raw: string): number | null {
  const value = parseFloat(raw.trim());
  if (!Number.isFinite(value)) return null;
  if (value <= 0.1) return null;
  if (value > 7200) return null; // > 2h ist sicher Mist
  return value;
}

/**
 * Probt eine Video-Datei via ffprobe. Bei MediaRecorder-WebM ohne Duration-
 * Header probt ffprobe per `-count_packets` durch — robust, kostet ~50-200ms.
 */
export async function probeVideoDuration(
  filePath: string,
): Promise<number | null> {
  try {
    // Versuch 1: Container-Metadaten (schnell)
    const fast = await runFfprobe([
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      filePath,
    ]);
    const fastDur = parseDurationSec(fast);
    if (fastDur !== null) return fastDur;
  } catch (err) {
    console.warn(
      "[ffprobe] fast-path failed:",
      err instanceof Error ? err.message : err,
    );
  }
  try {
    // Versuch 2: Stream-Level + count_packets — funktioniert auch bei vielen
    // WebMs ohne Container-Duration.
    const slow = await runFfprobe([
      "-v",
      "error",
      "-count_packets",
      "-select_streams",
      "v:0",
      "-show_entries",
      "stream=duration",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      filePath,
    ]);
    const slowDur = parseDurationSec(slow);
    if (slowDur !== null) return slowDur;
  } catch (err) {
    console.warn(
      "[ffprobe] slow-path failed:",
      err instanceof Error ? err.message : err,
    );
  }
  try {
    // Versuch 3 (Last-Resort): ffmpeg im null-mux-Modus durchspielen und
    // den höchsten `time=…`-Wert aus dem stderr-Stream extrahieren. Greift
    // bei MediaRecorder-WebMs ohne brauchbare Stream-Duration. O(file
    // length) CPU, aber unschlagbar zuverlässig.
    const stderr = await runFfmpegNullProbe(filePath);
    const lastResort = parseFfmpegTimeLine(stderr);
    if (lastResort !== null && lastResort > 0.1 && lastResort <= 7200) {
      return lastResort;
    }
    return null;
  } catch (err) {
    console.warn(
      "[ffprobe] null-mux fallback failed:",
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

/**
 * Probt einen Buffer (z.B. ein gerade hochgeladener Webcam-Recording-Blob).
 * Schreibt temporär nach /tmp, ffprobe, räumt auf.
 */
export async function probeVideoBufferDuration(
  buffer: Buffer,
  hintExt?: string,
): Promise<number | null> {
  const safeExt = (hintExt ?? "bin").replace(/[^a-zA-Z0-9]/g, "");
  const dir = join(tmpdir(), "videocomet-probes");
  await mkdir(dir, { recursive: true });
  const path = join(dir, `${randomUUID()}.${safeExt || "bin"}`);
  try {
    await writeFile(path, buffer);
    return await probeVideoDuration(path);
  } finally {
    try { await unlink(path); } catch { /* ignore */ }
  }
}

/**
 * Probt eine Remote-URL (Bunny-CDN o.ä.). ffprobe kann HTTP/HTTPS direkt
 * lesen — kein Vorab-Download nötig.
 */
export async function probeRemoteVideoDuration(
  url: string,
): Promise<number | null> {
  return probeVideoDuration(url);
}
