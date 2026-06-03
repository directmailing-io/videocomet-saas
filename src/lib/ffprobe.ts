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
    // Versuch 2: Stream-Level + count_packets — funktioniert auch bei WebMs
    // ohne Container-Duration (Chrome's MediaRecorder).
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
    return parseDurationSec(slow);
  } catch (err) {
    console.warn(
      "[ffprobe] slow-path failed:",
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
