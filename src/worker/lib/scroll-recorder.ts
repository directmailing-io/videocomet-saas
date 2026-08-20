/**
 * Puppeteer capture-recorder.
 *
 * Drives a headless Chromium page through one of two capture modes and
 * writes JPEG frames (≈30 fps) into a temp dir. The caller is responsible
 * for turning those frames into an MP4 (see `imageSeqToMp4` in ffmpeg.ts).
 *
 * Capture modes:
 *   - `static-hero`     Standbild des oberen Bereichs für die gesamte Dauer.
 *   - `scroll-recorded` Wiedergabe einer vom Nutzer im Frontend aufgezeichneten
 *                       Scroll-Sequenz (Liste von { t, y }-Samples).
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
import {
  prepareCleanPage,
  acquireHostSlot,
  RenderNotReadyError,
  type CleanPageSession,
} from "./clean-render";

/** Zwei unterstützte Capture-Modi (siehe Modul-Doc oben). */
export type CaptureMode = "static-hero" | "scroll-recorded";

/** Ein Scroll-Sample (kompatibel zu `ScrollFrame` aus segments/types). */
export interface ScrollSample {
  /** ms since recording start */
  t: number;
  /** vertical ratio of the captured image, 0..1 */
  y: number;
}

export interface RecordOpts {
  url: string;
  /** Directory the captured frames + (optional) MP4 will be written to. */
  outputDir: string;
  durationMs: number;
  mode: CaptureMode;
  viewport?: { width: number; height: number };
  /** Frames per second. Default 30. */
  fps?: number;
  /**
   * Optionale, vom Nutzer im Frontend aufgezeichnete Scroll-Sequenz.
   * Pflicht (sonst Fallback auf `static-hero`) wenn `mode = "scroll-recorded"`.
   * `t` ist ms relativ zum Recording-Start, `y` ist ein Ratio in [0, 1] des
   * captured Documents (NICHT in Pixeln — der Recorder kennt die Pixelhöhe
   * der Server-fullPage-Capture nicht).
   */
  scrollFrames?: ScrollSample[];
  /**
   * Kooperativer Abbruch (Stage-Timeout in pipeline.ts): die Frame-Loops
   * prüfen das Signal pro Frame und stoppen sofort — verhindert Zombie-
   * Writes in bereits gelöschte workDirs (ENOENT-Race 2026-08-19).
   */
  signal?: AbortSignal;
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
  signal?: AbortSignal;
}

/** Legacy-Alias-Output, identisch zu `RecordResult`. */
export type RecordScrollOutput = RecordResult;

// Wie in website-render-pipeline.ts (Formel dort begründet, 2026-08-20):
// der Timeout deckt den GESAMTEN Capture inkl. Slot-Warten unter Volllast —
// durationMs + 60 s war zu knapp und produzierte stumme Placeholder.
const MIN_CAPTURE_TIMEOUT_MS = 150_000;
const CAPTURE_TIMEOUT_OVERHEAD_MS = 120_000;
// Cap unter dem videoRender-Stage-Timeout (600 s), Begründung in
// website-render-pipeline.ts.
const MAX_CAPTURE_TIMEOUT_MS = 540_000;
function captureHardTimeoutMs(durationMs: number): number {
  return Math.min(
    MAX_CAPTURE_TIMEOUT_MS,
    Math.max(
      MIN_CAPTURE_TIMEOUT_MS,
      durationMs * 2 + CAPTURE_TIMEOUT_OVERHEAD_MS,
    ),
  );
}
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
 * Berechnet eine Scroll-Position-pro-Frame-Tabelle (Länge = totalFrames) aus
 * einer vom Nutzer aufgezeichneten Sample-Liste. Werte sind in Pixeln zwischen
 * 0 und maxScroll.
 *
 * Algorithmus: für jeden Output-Frame i wird der Zeitpunkt
 *   t_frame = (i / fps) * 1000 (ms)
 * berechnet, anschließend werden die zwei Sample-Punkte gesucht, die
 * t_frame umklammern, und linear interpoliert.
 *
 * Sortiert die Samples nach `t` defensiv, falls der Client sie ungeordnet
 * schickt. Werte ausserhalb von [0, 1] werden geklemmt.
 */
function buildScrollPlanFromFrames(
  scrollFrames: ScrollSample[],
  totalFrames: number,
  maxScroll: number,
  fps: number,
): number[] {
  if (totalFrames <= 0) return [];
  if (maxScroll <= 0 || scrollFrames.length === 0) {
    return new Array(totalFrames).fill(0);
  }

  const sorted = [...scrollFrames].sort((a, b) => a.t - b.t);
  const plan = new Array<number>(totalFrames);
  const frameIntervalMs = 1000 / fps;
  const clampRatio = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

  let cursor = 0; // index of the lower bracket sample
  for (let i = 0; i < totalFrames; i++) {
    const tFrame = i * frameIntervalMs;

    // Before the first sample → hold the first y.
    if (tFrame <= sorted[0].t) {
      plan[i] = Math.round(clampRatio(sorted[0].y) * maxScroll);
      continue;
    }
    // After the last sample → hold the last y.
    const last = sorted[sorted.length - 1];
    if (tFrame >= last.t) {
      plan[i] = Math.round(clampRatio(last.y) * maxScroll);
      continue;
    }

    // Advance the cursor until sorted[cursor+1].t > tFrame.
    while (
      cursor < sorted.length - 2 &&
      sorted[cursor + 1].t <= tFrame
    ) {
      cursor++;
    }
    const a = sorted[cursor];
    const b = sorted[cursor + 1];
    const span = b.t - a.t;
    const ratio = span <= 0 ? 0 : (tFrame - a.t) / span;
    const y = clampRatio(a.y + (b.y - a.y) * ratio);
    plan[i] = Math.round(y * maxScroll);
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
  const cleanupHolder: {
    releaseSlot: (() => void) | null;
    clean: CleanPageSession | null;
  } = { releaseSlot: null, clean: null };
  let captureOk = false;
  let captureProblem: string | null = null;

  const run = async (): Promise<RecordResult> => {
    opts.signal?.throwIfAborted();
    // Host-Throttle: max. 2 parallele Loads pro Shop-Host (Schicht 4b).
    cleanupHolder.releaseSlot = await acquireHostSlot(opts.url);

    const page = await ctx.context.newPage();
    pageHolder.current = page;
    await page.setViewport({
      width: viewport.width,
      height: viewport.height,
      deviceScaleFactor: 1,
    });

    // Clean-Render Schicht 0+1: Adblocker + Consent-Preseed VOR goto.
    const clean = await prepareCleanPage(page, opts.url);
    cleanupHolder.clean = clean;

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

    // Clean-Render Schicht 2–4: Dismiss + QA-Gate (wirft RenderNotReadyError
    // wenn die Seite auch nach Reload eine Fehlerseite zeigt) + Watchdog.
    try {
      await clean.stabilize({ dismissTimeoutMs: 3_000 });
    } catch (err) {
      if (err instanceof RenderNotReadyError) throw err;
      // Sonstige stabilize-Fehler nie fatal — Aufnahme läuft weiter.
    }

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

    // Determine scroll distance. Measure from both roots — some sites move
    // the scrolling overflow up to <html>, others keep it on <body>.
    const pageHeight: number = await page
      .evaluate(() =>
        Math.max(
          document.documentElement.scrollHeight,
          document.body.scrollHeight,
        ),
      )
      .catch(() => viewport.height);
    const maxScroll = Math.max(0, pageHeight - viewport.height);

    const frameIntervalMs = 1000 / fps;
    const totalFrames = Math.max(1, Math.ceil(opts.durationMs / frameIntervalMs));

    // Static-Hero (oder fehlende Scroll-Frames bei scroll-recorded) kann
    // optimiert werden: einmal screenshotten, N-mal speichern.
    const hasFrames =
      opts.mode === "scroll-recorded" &&
      Array.isArray(opts.scrollFrames) &&
      opts.scrollFrames.length > 0;

    if (opts.mode === "static-hero" || maxScroll === 0 || !hasFrames) {
      await scrollPageTo(page, 0);
      const buf = (await page.screenshot({
        type: "jpeg",
        quality: 80,
        clip: { x: 0, y: 0, width: viewport.width, height: viewport.height },
        fromSurface: true,
      })) as Buffer;
      for (let i = 0; i < totalFrames; i++) {
        opts.signal?.throwIfAborted();
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

    // scroll-recorded mit Frames: interpoliere Y-Position pro Output-Frame
    // aus der vom Nutzer aufgezeichneten Sample-Liste und shoote.
    // eslint-disable-next-line no-console
    console.log(
      `[scroll-recorder] playing back N=${opts.scrollFrames!.length} frames, maxScroll=${maxScroll}, totalFrames=${totalFrames}`,
    );
    const plan = buildScrollPlanFromFrames(
      opts.scrollFrames as ScrollSample[],
      totalFrames,
      maxScroll,
      fps,
    );

    for (let i = 0; i < totalFrames; i++) {
      opts.signal?.throwIfAborted();
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
    const result = await withTimeout(
      run(),
      captureHardTimeoutMs(opts.durationMs),
      "recordCapture",
    );
    captureOk = true;
    return result;
  } catch (err) {
    captureProblem =
      err instanceof RenderNotReadyError ? err.problem : "capture_error";
    throw err;
  } finally {
    // Telemetrie + Watchdog-Stop + Adblock-Disable (Schicht 5).
    if (cleanupHolder.clean) {
      await cleanupHolder.clean
        .finish(captureOk, captureProblem)
        .catch(() => undefined);
    }
    if (pageHolder.current) {
      await pageHolder.current.close().catch(() => undefined);
    }
    await ctx.close();
    cleanupHolder.releaseSlot?.();
  }
}

/**
 * @deprecated Use `recordCapture({ mode: 'scroll-recorded', scrollFrames, ... })`
 * instead.
 *
 * Backwards-compatibility alias: simuliert das alte `smooth-scroll`-Verhalten
 * über die neue `scroll-recorded`-Pipeline durch eine synthetisierte
 * `scrollFrames`-Liste von [{t:0,y:0},{t:durationMs,y:1}], so dass alte
 * Aufrufer (z.B. der Lead-Fallback in video-render.ts) ohne Änderung
 * weiterlaufen.
 */
export async function recordScroll(
  opts: RecordScrollInput,
): Promise<RecordScrollOutput> {
  return recordCapture({
    url: opts.url,
    outputDir: opts.outputDir,
    durationMs: opts.durationMs,
    mode: "scroll-recorded",
    viewport: opts.viewport,
    fps: opts.fps,
    signal: opts.signal,
    scrollFrames: [
      { t: 0, y: 0 },
      { t: opts.durationMs, y: 1 },
    ],
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
  signal?: AbortSignal;
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
      opts.signal?.throwIfAborted();
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
