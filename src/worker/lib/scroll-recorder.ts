/**
 * Puppeteer scroll-capture.
 *
 * Drives a headless Chromium page through a smooth top-to-bottom scroll while
 * writing one JPEG frame per ~33ms (≈30 fps) into a temp dir. The caller is
 * responsible for turning those frames into an MP4 (see `imageSeqToMp4` in
 * ffmpeg.ts).
 *
 * Why per-frame `page.screenshot()` instead of CDP screencast:
 *   The shared worker browser pool (browser-pool.ts) keeps Chromium running
 *   for hours. Per-frame screenshots are slower per call than screencast but
 *   they work reliably regardless of the GPU/compositor flags, and we don't
 *   need 60 fps capture for a 30-second outreach video.
 *
 * Failure modes:
 *   - URL invalid / empty           → throws immediately (caller falls back to black clip)
 *   - `page.goto` times out (30s)   → throws (caller falls back to black clip)
 *   - Whole capture exceeds 60s     → throws (caller falls back to black clip)
 *   - Page closes / crashes mid-run → throws (caller falls back to black clip)
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Page } from "puppeteer-core";
import { getContext } from "./browser-pool";

export interface RecordScrollInput {
  url: string;
  /** Directory the captured frames + (optional) MP4 will be written to. */
  outputDir: string;
  durationMs: number;
  viewport?: { width: number; height: number };
  /** Frames per second. Default 30. */
  fps?: number;
}

export interface RecordScrollOutput {
  durationSec: number;
  framesDir: string;
  frameCount: number;
  fps: number;
}

const HARD_TIMEOUT_MS = 60_000;
const GOTO_TIMEOUT_MS = 30_000;

/**
 * Normalises a CSV-supplied website value to a usable absolute URL.
 * Returns null for empty / unparseable inputs so the caller can fall back.
 */
export function normaliseWebsiteUrl(input: string | null | undefined): string | null {
  if (!input) return null;
  const trimmed = input.trim();
  if (!trimmed) return null;
  const withProto = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const u = new URL(withProto);
    if (!u.hostname || !u.hostname.includes(".")) return null;
    return u.toString();
  } catch {
    return null;
  }
}

/**
 * Wraps a promise with a hard wall-clock timeout. Used to make sure we never
 * stall the lead pipeline waiting for a hung page.
 */
async function withTimeout<T>(
  task: Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      task,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`[scroll-recorder] ${label} timed out after ${ms}ms`)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Records a smooth scroll of `url` over `durationMs` milliseconds, writing
 * JPEG frames to `outputDir/frames/frame-NNNN.jpg`.
 *
 * Returns the directory the frames live in plus the actual duration / count
 * so the caller can hand them straight to ffmpeg.
 */
export async function recordScroll(
  opts: RecordScrollInput,
): Promise<RecordScrollOutput> {
  const viewport = opts.viewport ?? { width: 1280, height: 720 };
  const fps = opts.fps ?? 30;
  const framesDir = join(opts.outputDir, "frames");
  await mkdir(framesDir, { recursive: true });

  const ctx = await getContext();
  const pageHolder: { current: Page | null } = { current: null };

  const run = async (): Promise<RecordScrollOutput> => {
    const page = await ctx.context.newPage();
    pageHolder.current = page;
    await page.setViewport({ width: viewport.width, height: viewport.height, deviceScaleFactor: 1 });

    // Navigate. Fall back through progressively cheaper waitUntil signals
    // so that flaky third-party trackers don't bork the whole capture.
    try {
      await page.goto(opts.url, { waitUntil: "networkidle2", timeout: GOTO_TIMEOUT_MS });
    } catch (e) {
      try {
        await page.goto(opts.url, { waitUntil: "domcontentloaded", timeout: 10_000 });
      } catch {
        throw e instanceof Error ? e : new Error(String(e));
      }
    }

    // Let CSS / hero-images settle.
    await new Promise((r) => setTimeout(r, 1_000));

    // Pin overflow to auto — some sites lock the body to overflow:hidden.
    await page
      .evaluate(() => {
        document.documentElement.style.overflow = "auto";
        document.body.style.overflow = "auto";
        (document.documentElement.style as any).scrollBehavior = "auto";
        (document.body.style as any).scrollBehavior = "auto";
        window.scrollTo(0, 0);
      })
      .catch(() => undefined);

    // Determine scroll distance.
    const pageHeight: number = await page
      .evaluate(() => document.body.scrollHeight)
      .catch(() => viewport.height);
    const maxScroll = Math.max(0, pageHeight - viewport.height);

    // Frame plan: one frame every (1000 / fps) ms.
    const frameIntervalMs = 1000 / fps;
    const totalFrames = Math.max(1, Math.ceil(opts.durationMs / frameIntervalMs));

    for (let i = 0; i < totalFrames; i++) {
      // Smooth ease-out: most movement early, settle near the bottom.
      const t = totalFrames <= 1 ? 1 : i / (totalFrames - 1);
      const scrollY = Math.round(t * maxScroll);

      await page
        .evaluate((y: number) => {
          window.scrollTo(0, y);
          document.documentElement.scrollTop = y;
          document.body.scrollTop = y;
        }, scrollY)
        .catch(() => undefined);

      // Wait one rAF so the compositor flushes before we shoot.
      await page
        .evaluate(
          () => new Promise<void>((r) => requestAnimationFrame(() => r())),
        )
        .catch(() => new Promise((r) => setTimeout(r, 10)));

      const frameName = `frame-${String(i).padStart(4, "0")}.jpg`;
      const buf = (await page.screenshot({
        type: "jpeg",
        quality: 80,
        clip: { x: 0, y: 0, width: viewport.width, height: viewport.height },
        fromSurface: true,
      })) as Buffer;
      await writeFile(join(framesDir, frameName), buf);
    }

    return {
      durationSec: opts.durationMs / 1000,
      framesDir,
      frameCount: totalFrames,
      fps,
    };
  };

  try {
    return await withTimeout(run(), HARD_TIMEOUT_MS, "recordScroll");
  } finally {
    if (pageHolder.current) {
      await pageHolder.current.close().catch(() => undefined);
    }
    await ctx.close();
  }
}

/**
 * Renders a simple "site not reachable" placeholder page into the same
 * frames directory. Used by the caller when `recordScroll` rejects so that
 * the lead still gets a meaningful visual (rather than 30s of black).
 */
export async function recordFallbackPage(opts: {
  outputDir: string;
  durationMs: number;
  websiteLabel: string;
  fps?: number;
}): Promise<RecordScrollOutput> {
  const fps = opts.fps ?? 30;
  const viewport = { width: 1280, height: 720 };
  const framesDir = join(opts.outputDir, "frames");
  await mkdir(framesDir, { recursive: true });

  const ctx = await getContext();
  const pageHolder: { current: Page | null } = { current: null };
  try {
    const page = await ctx.context.newPage();
    pageHolder.current = page;
    await page.setViewport({ width: viewport.width, height: viewport.height, deviceScaleFactor: 1 });

    const safeLabel = opts.websiteLabel
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

    const html = `<!doctype html><html lang="de"><head><meta charset="utf-8" />
      <style>
        :root { color-scheme: light; }
        html, body { margin:0; padding:0; height:100%; background:#FAFAFA;
          font-family: Inter, -apple-system, system-ui, sans-serif; color:#222; }
        .wrap { display:flex; flex-direction:column; align-items:center;
          justify-content:center; height:100%; gap:24px; text-align:center; }
        .badge { background:#F3EEFF; color:#7C5CE8; padding:8px 20px;
          border-radius:9999px; font-size:14px; font-weight:600; }
        h1 { font-size:48px; margin:0; font-weight:600; letter-spacing:-0.02em; }
        p { margin:0; color:#717171; font-size:18px; max-width:640px; }
        code { background:#fff; padding:6px 14px; border-radius:9999px;
          border:1px solid #EBEBEB; font-family: 'JetBrains Mono', monospace;
          font-size:14px; color:#222; }
      </style></head>
      <body><div class="wrap">
        <span class="badge">Website nicht erreichbar</span>
        <h1>Wir konnten die Seite nicht laden</h1>
        <p>Die folgende URL lieferte keine Antwort:</p>
        <code>${safeLabel}</code>
      </div></body></html>`;

    await page.setContent(html, { waitUntil: "domcontentloaded", timeout: 10_000 });
    await new Promise((r) => setTimeout(r, 200));

    const frameIntervalMs = 1000 / fps;
    const totalFrames = Math.max(1, Math.ceil(opts.durationMs / frameIntervalMs));

    // Identical static screenshot for every frame — cheap and reliable.
    const firstShot = (await page.screenshot({
      type: "jpeg",
      quality: 80,
      clip: { x: 0, y: 0, width: viewport.width, height: viewport.height },
      fromSurface: true,
    })) as Buffer;

    for (let i = 0; i < totalFrames; i++) {
      const name = `frame-${String(i).padStart(4, "0")}.jpg`;
      await writeFile(join(framesDir, name), firstShot);
    }

    return {
      durationSec: opts.durationMs / 1000,
      framesDir,
      frameCount: totalFrames,
      fps,
    };
  } finally {
    if (pageHolder.current) {
      await pageHolder.current.close().catch(() => undefined);
    }
    await ctx.close();
  }
}
