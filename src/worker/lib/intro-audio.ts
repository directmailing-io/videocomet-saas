/**
 * Audio-Analyse-Helfer für die Intro-Kalibrierung.
 *
 * ffmpeg schreibt Analyse-Output (silencedetect, ebur128) nach stderr —
 * der Standard-`runFfmpeg`-Wrapper wirft den weg, deshalb gibt es hier
 * einen Capture-Runner. Dazu: Parser für Silence-/Loudness-Ausgaben, ein
 * PCM-Decoder (s16le über stdout-Pipe) und eine kleine radix-2-FFT für
 * die Spektral-Referenz (Band → normalisiertes dB).
 */

import { spawn } from "node:child_process";

function ffmpegPath(): string {
  return process.env.FFMPEG_PATH ?? "/usr/bin/ffmpeg";
}

/**
 * Führt ffmpeg aus und liefert den kompletten stderr-Text (Analyse-Pässe
 * wie silencedetect/ebur128 loggen dorthin). Rejected bei Exit-Code != 0.
 */
export function runFfmpegCaptureStderr(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath(), args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
      // Cap: Analyse-Output ist klein, aber safety first (2 MB).
      if (stderr.length > 2 * 1024 * 1024) stderr = stderr.slice(-1024 * 1024);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(stderr);
      else reject(new Error(`ffmpeg exited with code ${code}: ${stderr.slice(-800)}`));
    });
  });
}

/** Dekodiert Audio zu raw PCM s16le über die stdout-Pipe. */
export function runFfmpegCaptureStdout(args: string[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath(), args, { stdio: ["ignore", "pipe", "pipe"] });
    const chunks: Buffer[] = [];
    let stderrTail = "";
    child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => {
      stderrTail = (stderrTail + chunk.toString("utf8")).slice(-2048);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(Buffer.concat(chunks));
      else reject(new Error(`ffmpeg exited with code ${code}: ${stderrTail}`));
    });
  });
}

/**
 * Parst den Integrated-Loudness-Wert aus dem ebur128-Summary:
 *   Integrated loudness:
 *     I:         -23.1 LUFS
 * Nimmt den LETZTEN Treffer (das Summary am Ende; Zwischenwerte während
 * des Laufs haben dasselbe Format).
 */
export function parseIntegratedLufs(stderr: string): number | null {
  const re = /I:\s*(-?\d+(?:\.\d+)?)\s*LUFS/g;
  let last: number | null = null;
  let m: RegExpExecArray | null;
  while ((m = re.exec(stderr))) {
    last = parseFloat(m[1]);
  }
  return last;
}

/** In-place radix-2 FFT (Cooley-Tukey). Länge muss Zweierpotenz sein. */
function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  if (n <= 1) return;
  // Bit-reversal permutation.
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i];
      re[i] = re[j];
      re[j] = tr;
      const ti = im[i];
      im[i] = im[j];
      im[j] = ti;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wRe = Math.cos(ang);
    const wIm = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let curRe = 1;
      let curIm = 0;
      for (let k = 0; k < len / 2; k++) {
        const evenRe = re[i + k];
        const evenIm = im[i + k];
        const oddRe = re[i + k + len / 2] * curRe - im[i + k + len / 2] * curIm;
        const oddIm = re[i + k + len / 2] * curIm + im[i + k + len / 2] * curRe;
        re[i + k] = evenRe + oddRe;
        im[i + k] = evenIm + oddIm;
        re[i + k + len / 2] = evenRe - oddRe;
        im[i + k + len / 2] = evenIm - oddIm;
        const nextRe = curRe * wRe - curIm * wIm;
        curIm = curRe * wIm + curIm * wRe;
        curRe = nextRe;
      }
    }
  }
}

export const SPECTRAL_BAND_CENTERS_HZ = [
  80, 160, 315, 630, 1250, 2500, 5000, 10000, 16000,
] as const;

/**
 * Berechnet die Spektral-Referenz aus raw PCM (s16le mono).
 *
 * Verfahren: Hann-gefensterte 4096er-Frames mit 50% Overlap, gemittelte
 * Power pro FFT-Bin, dann Mittelung über die Bins jedes Bandes
 * (Bandgrenzen: Faktor √2 um das Zentrum, ~1 Oktave). Ergebnis in dB,
 * normalisiert so dass das lauteste Band 0 dB ist.
 */
export function computeSpectralRef(
  pcm: Buffer,
  sampleRate: number,
): Record<string, number> {
  const frameSize = 4096;
  const hop = frameSize / 2;
  const sampleCount = Math.floor(pcm.length / 2);
  const binPower = new Float64Array(frameSize / 2);
  let frames = 0;

  const hann = new Float64Array(frameSize);
  for (let i = 0; i < frameSize; i++) {
    hann[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (frameSize - 1)));
  }

  const re = new Float64Array(frameSize);
  const im = new Float64Array(frameSize);
  for (let offset = 0; offset + frameSize <= sampleCount; offset += hop) {
    for (let i = 0; i < frameSize; i++) {
      re[i] = (pcm.readInt16LE((offset + i) * 2) / 32768) * hann[i];
      im[i] = 0;
    }
    fft(re, im);
    for (let k = 0; k < frameSize / 2; k++) {
      binPower[k] += re[k] * re[k] + im[k] * im[k];
    }
    frames++;
  }

  const result: Record<string, number> = {};
  if (frames === 0) {
    for (const center of SPECTRAL_BAND_CENTERS_HZ) result[String(center)] = 0;
    return result;
  }

  const binHz = sampleRate / frameSize;
  const bandDb: Array<{ center: number; db: number }> = [];
  for (const center of SPECTRAL_BAND_CENTERS_HZ) {
    const lo = center / Math.SQRT2;
    const hi = center * Math.SQRT2;
    const loBin = Math.max(1, Math.floor(lo / binHz));
    const hiBin = Math.min(frameSize / 2 - 1, Math.ceil(hi / binHz));
    let sum = 0;
    let count = 0;
    for (let k = loBin; k <= hiBin; k++) {
      sum += binPower[k] / frames;
      count++;
    }
    const avg = count > 0 ? sum / count : 0;
    bandDb.push({ center, db: 10 * Math.log10(avg + 1e-12) });
  }

  const maxDb = Math.max(...bandDb.map((b) => b.db));
  for (const b of bandDb) {
    result[String(b.center)] = Math.round((b.db - maxDb) * 10) / 10;
  }
  return result;
}
