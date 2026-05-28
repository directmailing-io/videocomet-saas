/**
 * Puppeteer capture-recorder.
 *
 * Drives a headless Chromium page through one of four capture modes and
 * writes JPEG frames (≈30 fps) into a temp dir. The caller is responsible
 * for turning those frames into an MP4 (see `imageSeqToMp4` in ffmpeg.ts).
 *
 * Capture modes:
 *   - `static-hero`        Standbild des oberen Bereichs für die gesamte Dauer.
 *   - `smooth-scroll`      Linear top → bottom über die ganze Segment-Dauer.
 *   - `slow-scroll-pauses` Langsam scrollen mit Pausen bei 25/50/75 %.
 *   - `quick-scroll`       Erste Hälfte schnell scrollen, zweite Hälfte halten.
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
import { dismissCookieBanners } from "./cookie-dismiss";

/** Vier unterstützte Capture-Modi (siehe Modul-Doc oben). */
export type CaptureMode =
  | "static-hero"
  | "smooth-scroll"
  | "slow-scroll-pauses"
  | "quick-scroll";

export interface RecordOpts {
  url: string;
  /** Directory the captured frames + (optional) MP4 will be written to. */
  outputDir: string;
  durationMs: number;
  mode: CaptureMode;
  viewport?: { width: number; height: number };
  /** Frames per second. Default 30. */
  fps?: number;
}

export interface RecordResult {
  durationSec: number;
  framesDir: string;
  frameCount: number;
  fps: number;
}

/** Legacy-Alias-Input für die alte `recordScroll`-API. */
export interface RecordScrollInput {
  url: string;
  outputDir: string;
  durationMs: number;
  viewport?: { width: number; height: number };
  fps?: number;
}

/** Legacy-Alias-Output, identisch zu `RecordResult`. */
export type RecordScrollOutput = RecordResult;

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
        timer = setTimeout(
          () => reject(new Error(`[scroll-recorder] ${label} timed out after ${ms}ms`)),
          ms,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Setzt `scrollY` auf der Page; failt still wenn die Page bereits geschlossen ist.
 */
async function scrollPageTo(page: Page, y: number): Promise<void> {
  await page
    .evaluate((to: number) => {
      window.scrollTo(0, to);
      document.documentElement.scrollTop = to;
      document.body.scrollTop = to;
    }, y)
    .catch(() => undefined);

  // Wait one rAF so the compositor flushes before we shoot.
  await page
    .evaluate(
      () => new Promise<void>((r) => requestAnimationFrame(() => r())),
    )
    .catch(() => new Promise((r) => setTimeout(r, 10)));
}

/** Shoots a single JPEG frame and writes it to `framesDir/frame-NNNN.jpg`. */
async function shootFrame(
  page: Page,
  framesDir: string,
  index: number,
  viewport: { width: number; height: number },
): Promise<void> {
  const frameName = `frame-${String(index).padStart(4, "0")}.jpg`;
  const buf = (await page.screenshot({
    type: "jpeg",
    quality: 80,
    clip: { x: 0, y: 0, width: viewport.width, height: viewport.height },
    fromSurface: true,
  })) as Buffer;
  await writeFile(join(framesDir, frameName), buf);
}

/**
 * Berechnet für `mode` eine Scroll-Position-pro-Frame-Tabelle (Länge = totalFrames).
 * Werte sind in Pixeln zwischen 0 und maxScroll.
 */
function buildScrollPlan(
  mode: CaptureMode,
  totalFrames: number,
  maxScroll: number,
  fps: number,
): number[] {
  if (totalFrames <= 0) return [];
  if (maxScroll <= 0 || mode === "static-hero") {
    return new Array(totalFrames).fill(0);
  }

  const plan = new Array<number>(totalFrames);

  if (mode === "smooth-scroll") {
    for (let i = 0; i < totalFrames; i++) {
      const t = totalFrames <= 1 ? 1 : i / (totalFrames - 1);
      plan[i] = Math.round(t * maxScroll);
    }
    return plan;
  }

  if (mode === "quick-scroll") {
    // Erste Hälfte: linear top → bottom. Zweite Hälfte: bei bottom halten.
    const halfPoint = Math.max(1, Math.floor(totalFrames / 2));
    for (let i = 0; i < totalFrames; i++) {
      if (i >= halfPoint) {
        plan[i] = maxScroll;
      } else {
        const t = halfPoint <= 1 ? 1 : i / (halfPoint - 1);
        plan[i] = Math.round(t * maxScroll);
      }
    }
    return plan;
  }

  // "slow-scroll-pauses": Vier Pausen bei 25 / 50 / 75 / 100 %.
  // Jede Pause dauert ~1s; die verbleibende Zeit wird gleichmässig auf die
  // drei Scroll-Phasen (0→25, 25→50, 50→75, 75→100) verteilt.
  const pauseFrames = Math.min(
    Math.round(fps), // ≈1s
    Math.floor(totalFrames / 8), // niemals mehr als ~12 % pro Pause
  );
  const safePause = Math.max(1, pauseFrames);
  const stops = [0.25, 0.5, 0.75, 1.0];
  const pauseTotal = safePause * stops.length;
  const moveTotal = Math.max(0, totalFrames - pauseTotal);
  const moveFramesPerPhase = Math.floor(moveTotal / stops.length);

  let frameIdx = 0;
  let lastY = 0;
  for (let s = 0; s < stops.length; s++) {
    const targetY = Math.round(stops[s] * maxScroll);
    // Move-Phase: interpoliere von lastY → targetY über moveFramesPerPhase Frames.
    for (let m = 0; m < moveFramesPerPhase && frameIdx < totalFrames; m++) {
      const t = moveFramesPerPhase <= 1 ? 1 : m / (moveFramesPerPhase - 1);
      plan[frameIdx++] = Math.round(lastY + (targetY - lastY) * t);
    }
    // Pause-Phase: halte targetY für safePause Frames.
    for (let p = 0; p < safePause && frameIdx < totalFrames; p++) {
      plan[frameIdx++] = targetY;
    }
    lastY = targetY;
  }
  // Falls aufgrund Rundungs-Rest noch Frames übrig: am Ende halten.
  while (frameIdx < totalFrames) {
    plan[frameIdx++] = maxScroll;
  }
  return plan;
}

/**
 * Öffnet `url`, dismisst Cookie-Banner und nimmt die Seite gemäss `mode`
 * über `durationMs` als JPEG-Sequenz auf.
 */
export async function recordCapture(opts: RecordOpts): Promise<RecordResult> {
  const viewport = opts.viewport ?? { width: 1280, height: 720 };
  const fps = opts.fps ?? 30;
  const framesDir = join(opts.outputDir, "frames");
  await mkdir(framesDir, { recursive: true });

  const ctx = await getContext();
  const pageHolder: { current: Page | null } = { current: null };

  const run = async (): Promise<RecordResult> => {
    const page = await ctx.context.newPage();
    pageHolder.current = page;
    await page.setViewport({
      width: viewport.width,
      height: viewport.height,
      deviceScaleFactor: 1,
    });

    // Navigate. Fall back through progressively cheaper waitUntil signals
    // so that flaky third-party trackers don't bork the whole capture.
    try {
      await page.goto(opts.url, {
        waitUntil: "networkidle2",
        timeout: GOTO_TIMEOUT_MS,
      });
    } catch (e) {
      try {
        await page.goto(opts.url, {
          waitUntil: "domcontentloaded",
          timeout: 10_000,
        });
      } catch {
        throw e instanceof Error ? e : new Error(String(e));
      }
    }

    // Let CSS / hero-images settle.
    await new Promise((r) => setTimeout(r, 1_000));

    // Cookie-Banner möglichst früh wegklicken, damit der Hero sichtbar wird.
    await dismissCookieBanners(page, 3_000).catch(() => false);

    // Pin overflow to auto — some sites lock the body to overflow:hidden.
    await page
      .evaluate(() => {
        document.documentElement.style.overflow = "auto";
        document.body.style.overflow = "auto";
        (document.documentElement.style as unknown as { scrollBehavior: string }).scrollBehavior = "auto";
        (document.body.style as unknown as { scrollBehavior: string }).scrollBehavior = "auto";
        window.scrollTo(0, 0);
      })
      .catch(() => undefined);

    // Determine scroll distance.
    const pageHeight: number = await page
      .evaluate(() => document.body.scrollHeight)
      .catch(() => viewport.height);
    const maxScroll = Math.max(0, pageHeight - viewport.height);

    const frameIntervalMs = 1000 / fps;
    const totalFrames = Math.max(1, Math.ceil(opts.durationMs / frameIntervalMs));

    // Static-Hero kann optimiert werden: einmal screenshotten, N-mal speichern.
    if (opts.mode === "static-hero" || maxScroll === 0) {
      await scrollPageTo(page, 0);
      const buf = (await page.screenshot({
        type: "jpeg",
        quality: 80,
        clip: { x: 0, y: 0, width: viewport.width, height: viewport.height },
        fromSurface: true,
      })) as Buffer;
      for (let i = 0; i < totalFrames; i++) {
        const frameName = `frame-${String(i).padStart(4, "0")}.jpg`;
        await writeFile(join(framesDir, frameName), buf);
      }
      return {
        durationSec: opts.durationMs / 1000,
        framesDir,
        frameCount: totalFrames,
        fps,
      };
    }

    const plan = buildScrollPlan(opts.mode, totalFrames, maxScroll, fps);

    for (let i = 0; i < totalFrames; i++) {
      await scrollPageTo(page, plan[i] ?? 0);
      await shootFrame(page, framesDir, i, viewport);
    }

    return {
      durationSec: opts.durationMs / 1000,
      framesDir,
      frameCount: totalFrames,
      fps,
    };
  };

  try {
    return await withTimeout(run(), HARD_TIMEOUT_MS, "recordCapture");
  } finally {
    if (pageHolder.current) {
      await pageHolder.current.close().catch(() => undefined);
    }
    await ctx.close();
  }
}

/**
 * @deprecated Use `recordCapture({ mode: 'smooth-scroll', ... })` instead.
 *
 * Backwards-compatibility alias: führt einen `smooth-scroll`-Capture mit
 * derselben Signatur wie früher aus.
 */
export async function recordScroll(
  opts: RecordScrollInput,
): Promise<RecordScrollOutput> {
  return recordCapture({
    url: opts.url,
    outputDir: opts.outputDir,
    durationMs: opts.durationMs,
    mode: "smooth-scroll",
    viewport: opts.viewport,
    fps: opts.fps,
  });
}

/**
 * Renders a simple "site not reachable" placeholder page into the same
 * frames directory. Used by the caller when `recordCapture` rejects so that
 * the lead still gets a meaningful visual (rather than 30s of black).
 */
export async function recordFallbackPage(opts: {
  outputDir: string;
  durationMs: number;
  websiteLabel: string;
  fps?: number;
}): Promise<RecordResult> {
  const fps = opts.fps ?? 30;
  const viewport = { width: 1280, height: 720 };
  const framesDir = join(opts.outputDir, "frames");
  await mkdir(framesDir, { recursive: true });

  const ctx = await getContext();
  const pageHolder: { current: Page | null } = { current: null };
  try {
    const page = await ctx.context.newPage();
    pageHolder.current = page;
    await page.setViewport({
      width: viewport.width,
      height: viewport.height,
      deviceScaleFactor: 1,
    });

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
