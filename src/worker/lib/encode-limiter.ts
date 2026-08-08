/**
 * Globaler ffmpeg-Encode-Limiter (M2, Perf-Paket 2026-07-21).
 *
 * Problem: WORKER_CONCURRENCY=16 auf 8 vCPUs — jeder libx264-Encode
 * spawnt per Default so viele Threads wie Cores. Bei 5+ parallelen
 * Encodes (z.B. 5 Leads × Webcam-Normalize) oversubscriben sich die
 * Prozesse massiv: statt 5× ~12s dauerte jeder Encode ~56s (Prod-Befund
 * Run a7d1617b). Zwei Hebel:
 *
 *  1. `capLibx264Threads`: injiziert `-threads 3` in libx264-Encodes,
 *     damit ein einzelner Encode nicht alle 8 Cores greift.
 *  2. `withEncodeSlot`: prozessweite Semaphore — max 4 gleichzeitige
 *     Encodes (4 × 3 Threads ≈ 8 Cores + Scheduling-Headroom). Weitere
 *     Encodes warten FIFO. Copy-/Remux-Ops (`-c copy`, extractFrame)
 *     laufen NICHT durch die Semaphore — die sind I/O-bound und billig.
 *
 * Beide runFfmpeg-Implementierungen (ffmpeg.ts, video-compress.ts) rufen
 * das zentral auf — neue Encode-Callsites sind automatisch abgedeckt.
 *
 * Beide Werte per Env übersteuerbar (MAX_CONCURRENT_ENCODES,
 * LIBX264_THREADS), z.B. nach Hetzner-Resize auf 16 Kerne: 8/3.
 */

function envInt(name: string, fallback: number): number {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) && parsed >= 1 ? Math.floor(parsed) : fallback;
}

const MAX_CONCURRENT_ENCODES = envInt("MAX_CONCURRENT_ENCODES", 4);
const LIBX264_THREADS = envInt("LIBX264_THREADS", 3);

let activeEncodes = 0;
const waiters: Array<() => void> = [];

export function isLibx264Encode(args: string[]): boolean {
  return args.includes("libx264");
}

/**
 * Fügt `-threads 3` direkt nach dem `libx264`-Codec-Argument ein (Output-
 * Option, Position innerhalb der Output-Optionen ist ffmpeg egal). No-op,
 * wenn kein libx264-Encode oder bereits ein `-threads` gesetzt ist.
 */
export function capLibx264Threads(args: string[]): string[] {
  if (!isLibx264Encode(args) || args.includes("-threads")) return args;
  const idx = args.indexOf("libx264");
  return [
    ...args.slice(0, idx + 1),
    "-threads",
    String(LIBX264_THREADS),
    ...args.slice(idx + 1),
  ];
}

/** Führt `fn` unter der globalen Encode-Semaphore aus (FIFO-Warteschlange). */
export async function withEncodeSlot<T>(fn: () => Promise<T>): Promise<T> {
  while (activeEncodes >= MAX_CONCURRENT_ENCODES) {
    await new Promise<void>((resolve) => waiters.push(resolve));
  }
  activeEncodes += 1;
  try {
    return await fn();
  } finally {
    activeEncodes -= 1;
    const next = waiters.shift();
    if (next) next();
  }
}
