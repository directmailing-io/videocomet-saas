/**
 * Website-Render-Pipeline mit ECHTEM Screencast.
 *
 * Statt einen einzelnen fullPage-Screenshot zu nehmen (das verlor
 * Animationen, Slider und JS-Effekte und sah wie ein Standbild aus),
 * nutzen wir Chrome DevTools Protocol's `Page.startScreencast`. CDP
 * emittiert Frames in echtzeit vom Compositor-Buffer — alles was live
 * im Browser passiert (Carousel, Hover-States, Auto-Play-Videos, Lazy-
 * Images die nachladen) wandert mit ins Video.
 *
 * Architektur:
 *   1. Puppeteer-Page öffnen, navigieren, Cookies dismissen, Scrollbars
 *      ausblenden
 *   2. EIN Browser-Chrome-PNG erzeugen (1280×80, macOS/Chrome-Look mit
 *      Traffic-Lights, Tab, Adressleiste mit echter Lead-URL)
 *   3. CDP-Session öffnen, screencastFrame-Events sammeln
 *   4. Scroll über die Aufnahme-Dauer abspielen (30fps Tick-Loop)
 *   5. Screencast stoppen, alle Captured-Frames sortieren
 *   6. Für jeden Output-Frame (i = 0..N-1): den zeitlich nächstgelegenen
 *      Capture-Frame nehmen, sharp Browser-Chrome oben drauf compositen
 *      → JPG schreiben
 *
 * Vorteile gegenüber fullPage-Screenshot:
 *   - Animationen sind sichtbar (das war der User-Bugreport)
 *   - Slider/Carousel werden live mitgerendert
 *   - Lazy-Bilder die beim Scroll nachladen sind drin
 *   - Sieht aus wie ein echtes Bildschirm-Recording
 *
 * Performance: CDP-Screencast emittiert mit ~30-60fps direkt vom
 * Compositor; das ist deutlich schneller als 480× page.screenshot.
 * Pro Lead ca. 10-15s inkl. sharp-Postprocessing.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
import type { Page, CDPSession } from "puppeteer-core";
import type { ScrollFrame } from "@/lib/segments/types";
import { getContext } from "./browser-pool";
import { dismissCookieBanners } from "./cookie-dismiss";

export interface RenderWebsiteOpts {
  url: string;
  outputDir: string;
  durationMs: number;
  mode: "static-hero" | "scroll-recorded";
  scrollFrames?: ScrollFrame[];
  viewport?: { width: number; height: number };
  fps?: number;
}

export interface RenderWebsiteResult {
  durationSec: number;
  framesDir: string;
  frameCount: number;
  fps: number;
}

const CHROME_HEIGHT_PX = 80;
const HARD_TIMEOUT_MS = 240_000;
const GOTO_TIMEOUT_MS = 30_000;

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Generiert das HTML einer Chrome/Safari-artigen Browser-Toolbar — wird
 * in einer separaten Page (oder per setContent) gerendert und einmal als
 * 1280×80 PNG gespeichert. Inline-SVG damit es ohne Font-Dependencies
 * scharf aussieht.
 */
function buildBrowserChromeHtml(url: string, width: number): string {
  let host = url;
  try {
    host = new URL(url).host.replace(/^www\./, "");
  } catch {
    /* leave url as-is */
  }

  const ICON_BACK = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#5F6368" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>`;
  const ICON_FWD = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#BDC1C6" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>`;
  const ICON_RELOAD = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#5F6368" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>`;
  const ICON_LOCK = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#5F6368" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>`;
  const ICON_STAR = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#5F6368" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`;
  const ICON_MENU = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#5F6368" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/></svg>`;

  return `<!doctype html>
<html><head><meta charset="utf-8"/><style>
*{box-sizing:border-box;margin:0;padding:0}
html,body{background:#DEE1E6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;color:#202124}
.frame{width:${width}px;height:${CHROME_HEIGHT_PX}px;background:#DEE1E6;position:relative}
.tabs{height:36px;display:flex;align-items:flex-end;padding-left:78px;gap:1px;background:#DEE1E6}
.dots{position:absolute;top:11px;left:12px;display:flex;gap:8px}
.dot{width:12px;height:12px;border-radius:50%}
.dot-r{background:#FF5F57;border:0.5px solid rgba(0,0,0,0.06)}
.dot-y{background:#FEBC2E;border:0.5px solid rgba(0,0,0,0.06)}
.dot-g{background:#28C840;border:0.5px solid rgba(0,0,0,0.06)}
.tab{background:#fff;height:32px;border-radius:10px 10px 0 0;padding:0 14px 0 12px;display:flex;align-items:center;gap:8px;font-size:13px;color:#3C4043;max-width:240px;min-width:160px;font-weight:400;line-height:1}
.tab-fav{width:14px;height:14px;border-radius:3px;background:linear-gradient(135deg,#4285F4,#0F62D6);flex-shrink:0}
.tab-title{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.toolbar{height:44px;background:#fff;display:flex;align-items:center;padding:0 12px;gap:6px}
.icon-btn{width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center}
.url-bar{flex:1;background:#F1F3F4;height:32px;border-radius:18px;display:flex;align-items:center;padding:0 14px;gap:10px;font-size:13px;color:#202124;font-weight:400}
.url-text{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
</style></head>
<body>
<div class="frame">
  <div class="tabs">
    <div class="dots">
      <div class="dot dot-r"></div>
      <div class="dot dot-y"></div>
      <div class="dot dot-g"></div>
    </div>
    <div class="tab">
      <div class="tab-fav"></div>
      <div class="tab-title">${escapeHtml(host)}</div>
    </div>
  </div>
  <div class="toolbar">
    <div class="icon-btn">${ICON_BACK}</div>
    <div class="icon-btn">${ICON_FWD}</div>
    <div class="icon-btn">${ICON_RELOAD}</div>
    <div class="url-bar">
      ${ICON_LOCK}
      <span class="url-text">${escapeHtml(url)}</span>
    </div>
    <div class="icon-btn">${ICON_STAR}</div>
    <div class="icon-btn">${ICON_MENU}</div>
  </div>
</div>
</body></html>`;
}

function buildScrollPlanFromFrames(
  scrollFrames: ScrollFrame[],
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
  const clamp = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
  let cursor = 0;
  for (let i = 0; i < totalFrames; i++) {
    const tFrame = i * frameIntervalMs;
    if (tFrame <= sorted[0].t) {
      plan[i] = Math.round(clamp(sorted[0].y) * maxScroll);
      continue;
    }
    const last = sorted[sorted.length - 1];
    if (tFrame >= last.t) {
      plan[i] = Math.round(clamp(last.y) * maxScroll);
      continue;
    }
    while (cursor < sorted.length - 2 && sorted[cursor + 1].t <= tFrame) {
      cursor++;
    }
    const a = sorted[cursor];
    const b = sorted[cursor + 1];
    const span = b.t - a.t;
    const ratio = span <= 0 ? 0 : (tFrame - a.t) / span;
    const y = clamp(a.y + (b.y - a.y) * ratio);
    plan[i] = Math.round(y * maxScroll);
  }
  return plan;
}

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
          () =>
            reject(
              new Error(`[website-render] ${label} timed out after ${ms}ms`),
            ),
          ms,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

interface ScreencastFrame {
  buf: Buffer;
  offsetMs: number;
}

/**
 * Notfall-Fallback: wenn CDP-Screencast 0 Frames produzierte (z.B. wegen
 * gevulkanisierter Chromium-Headless-Builds, GPU-Compositor-Issues, oder
 * Site die Render verweigert), öffnen wir die Page nochmal kurz, machen
 * EINEN fullPage-Screenshot und replay-en das per sharp-Crop. Animationen
 * gehen verloren, aber dafuer gibt's kein schwarzes Video.
 */
async function fallbackScreenshotPath(
  opts: RenderWebsiteOpts,
  ctx: { context: { newPage(): Promise<Page> }; close(): Promise<void> },
  viewport: { width: number; height: number },
  fps: number,
  framesDir: string,
): Promise<RenderWebsiteResult> {
  // Eigene fresh page, der bisherige Context wird vom Caller geschlossen
  const fbPage = await ctx.context.newPage();
  try {
    await fbPage.setViewport({
      width: viewport.width,
      height: viewport.height,
      deviceScaleFactor: 1,
    });
    await fbPage
      .goto(opts.url, {
        waitUntil: "networkidle2",
        timeout: GOTO_TIMEOUT_MS,
      })
      .catch(() => undefined);
    await new Promise((r) => setTimeout(r, 1_000));
    await dismissCookieBanners(fbPage, 3_000).catch(() => false);
    await fbPage
      .evaluate(() => {
        const css = document.createElement("style");
        css.textContent = `html,body{scrollbar-width:none!important}html::-webkit-scrollbar,body::-webkit-scrollbar{display:none!important}`;
        document.head.appendChild(css);
        window.scrollTo(0, 0);
      })
      .catch(() => undefined);

    const docPng = (await fbPage.screenshot({
      type: "png",
      fullPage: true,
    })) as Buffer;
    const meta = await sharp(docPng).metadata();
    const docW = meta.width ?? viewport.width;
    const docH = meta.height ?? viewport.height;
    const docVisibleH = Math.max(1, viewport.height - CHROME_HEIGHT_PX);
    const maxScroll = Math.max(0, docH - docVisibleH);

    // Chrome PNG (für composite) neu rendern
    await fbPage.setViewport({
      width: viewport.width,
      height: CHROME_HEIGHT_PX,
      deviceScaleFactor: 1,
    });
    await fbPage.setContent(
      buildBrowserChromeHtml(opts.url, viewport.width),
      { waitUntil: "domcontentloaded" },
    );
    await new Promise((r) => setTimeout(r, 80));
    const chromePng = (await fbPage.screenshot({
      type: "png",
      clip: { x: 0, y: 0, width: viewport.width, height: CHROME_HEIGHT_PX },
    })) as Buffer;
    await fbPage.close().catch(() => undefined);

    const frameIntervalMs = 1000 / fps;
    const totalFrames = Math.max(
      1,
      Math.ceil(opts.durationMs / frameIntervalMs),
    );
    const plan =
      opts.scrollFrames && opts.scrollFrames.length > 0
        ? buildScrollPlanFromFrames(opts.scrollFrames, totalFrames, maxScroll, fps)
        : new Array<number>(totalFrames).fill(0);

    for (let i = 0; i < totalFrames; i++) {
      const y = Math.max(0, Math.min(maxScroll, plan[i] ?? 0));
      const cropH = Math.min(docVisibleH, docH - y);
      const docCrop = await sharp(docPng)
        .extract({ left: 0, top: y, width: docW, height: cropH })
        .toBuffer();
      const composite = await sharp({
        create: {
          width: viewport.width,
          height: viewport.height,
          channels: 3,
          background: { r: 255, g: 255, b: 255 },
        },
      })
        .composite([
          { input: chromePng, top: 0, left: 0 },
          { input: docCrop, top: CHROME_HEIGHT_PX, left: 0 },
        ])
        .jpeg({ quality: 82 })
        .toBuffer();
      await writeFile(
        join(framesDir, `frame-${String(i).padStart(4, "0")}.jpg`),
        composite,
      );
    }
    return {
      durationSec: opts.durationMs / 1000,
      framesDir,
      frameCount: totalFrames,
      fps,
    };
  } finally {
    await fbPage.close().catch(() => undefined);
  }
}

export async function renderWebsiteCapture(
  opts: RenderWebsiteOpts,
): Promise<RenderWebsiteResult> {
  const viewport = opts.viewport ?? { width: 1280, height: 720 };
  const fps = opts.fps ?? 30;
  const framesDir = join(opts.outputDir, "frames");
  await mkdir(framesDir, { recursive: true });

  const ctx = await getContext();
  const pageHolder: { current: Page | null } = { current: null };
  const clientHolder: { current: CDPSession | null } = { current: null };

  const run = async (): Promise<RenderWebsiteResult> => {
    // ── 1. Browser-Chrome PNG erzeugen (eigene Page, dann schliessen) ─
    const chromePage = await ctx.context.newPage();
    await chromePage.setViewport({
      width: viewport.width,
      height: CHROME_HEIGHT_PX,
      deviceScaleFactor: 1,
    });
    await chromePage.setContent(
      buildBrowserChromeHtml(opts.url, viewport.width),
      { waitUntil: "domcontentloaded" },
    );
    await new Promise((r) => setTimeout(r, 80));
    const chromePngBuf = (await chromePage.screenshot({
      type: "png",
      clip: {
        x: 0,
        y: 0,
        width: viewport.width,
        height: CHROME_HEIGHT_PX,
      },
    })) as Buffer;
    await chromePage.close().catch(() => undefined);

    // ── 2. Live-Page öffnen ───────────────────────────────────────────
    const page = await ctx.context.newPage();
    pageHolder.current = page;
    await page.setViewport({
      width: viewport.width,
      height: viewport.height,
      deviceScaleFactor: 1,
    });

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

    await new Promise((r) => setTimeout(r, 1_200));
    await dismissCookieBanners(page, 3_000).catch(() => false);

    // Scrollbars + smooth-scroll abschalten — sonst sieht das Crop
    // unsauber aus und scrollHeight-Messung ist unzuverlaessig.
    await page
      .evaluate(() => {
        const css = document.createElement("style");
        css.textContent = `
          html,body{scrollbar-width:none!important;-ms-overflow-style:none!important}
          html::-webkit-scrollbar,body::-webkit-scrollbar{display:none!important;width:0!important;height:0!important}
          *{scroll-behavior:auto!important}
        `;
        document.head.appendChild(css);
        document.documentElement.style.overflow = "auto";
        document.body.style.overflow = "auto";
        window.scrollTo(0, 0);
      })
      .catch(() => undefined);

    const docHeight: number = await page.evaluate(() =>
      Math.max(
        document.documentElement.scrollHeight,
        document.body.scrollHeight,
      ),
    );
    const maxScroll = Math.max(0, docHeight - viewport.height);

    const frameIntervalMs = 1000 / fps;
    const totalFrames = Math.max(
      1,
      Math.ceil(opts.durationMs / frameIntervalMs),
    );

    const hasFrames =
      opts.mode === "scroll-recorded" &&
      Array.isArray(opts.scrollFrames) &&
      opts.scrollFrames.length > 0;

    // ── 3. Static-Hero Shortcut: kein Screencast nötig ────────────────
    if (opts.mode === "static-hero" || maxScroll === 0 || !hasFrames) {
      await page.evaluate(() => window.scrollTo(0, 0));
      await new Promise((r) => setTimeout(r, 200));
      const staticPng = (await page.screenshot({
        type: "png",
        clip: {
          x: 0,
          y: 0,
          width: viewport.width,
          height: viewport.height,
        },
      })) as Buffer;
      const composite = await sharp({
        create: {
          width: viewport.width,
          height: viewport.height,
          channels: 3,
          background: { r: 255, g: 255, b: 255 },
        },
      })
        .composite([
          { input: staticPng, top: 0, left: 0 },
          { input: chromePngBuf, top: 0, left: 0 },
        ])
        .jpeg({ quality: 82 })
        .toBuffer();
      for (let i = 0; i < totalFrames; i++) {
        await writeFile(
          join(framesDir, `frame-${String(i).padStart(4, "0")}.jpg`),
          composite,
        );
      }
      return {
        durationSec: opts.durationMs / 1000,
        framesDir,
        frameCount: totalFrames,
        fps,
      };
    }

    // ── 4. CDP-Screencast starten ─────────────────────────────────────
    // eslint-disable-next-line no-console
    console.log(
      `[website-render] CDP screencast url=${opts.url} docHeight=${docHeight} maxScroll=${maxScroll} totalFrames=${totalFrames}`,
    );

    const client = await page.createCDPSession();
    clientHolder.current = client;

    // Some Chromium builds need Page.enable before screencast events fire.
    await client.send("Page.enable").catch(() => undefined);

    // Stelle sicher dass DIE Page focused ist — CDP screencast captures
    // den active tab; ohne bringToFront kann es passieren, dass Background-
    // Tabs gar nicht oder schwarz aufgezeichnet werden.
    await page.bringToFront().catch(() => undefined);

    const captured: ScreencastFrame[] = [];
    let screencastStart = 0;
    let firstFrameLogged = false;

    client.on(
      "Page.screencastFrame",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      async (event: any) => {
        const offsetMs = Date.now() - screencastStart;
        const buf = Buffer.from(event.data, "base64");
        captured.push({ buf, offsetMs });
        if (!firstFrameLogged) {
          firstFrameLogged = true;
          try {
            const meta = await sharp(buf).metadata();
            // eslint-disable-next-line no-console
            console.log(
              `[website-render] first frame dims=${meta.width}x${meta.height} bytes=${buf.length}`,
            );
          } catch {
            /* ignore */
          }
        }
        await client
          .send("Page.screencastFrameAck", { sessionId: event.sessionId })
          .catch(() => undefined);
      },
    );

    await client.send("Page.startScreencast", {
      format: "jpeg",
      quality: 80,
      everyNthFrame: 1,
      maxWidth: viewport.width,
      maxHeight: viewport.height,
    });
    screencastStart = Date.now();

    // ── 5. Scroll-Driver (zielt 30 fps an, läuft genau durationMs) ────
    const plan = buildScrollPlanFromFrames(
      opts.scrollFrames as ScrollFrame[],
      totalFrames,
      maxScroll,
      fps,
    );

    for (let i = 0; i < totalFrames; i++) {
      const targetT = i * frameIntervalMs;
      const currentT = Date.now() - screencastStart;
      if (currentT < targetT) {
        await new Promise((r) => setTimeout(r, targetT - currentT));
      }
      await page
        .evaluate((y) => window.scrollTo(0, y), plan[i] ?? 0)
        .catch(() => undefined);
    }

    // kurz warten damit die letzten Frames noch ankommen
    await new Promise((r) => setTimeout(r, 200));

    await client.send("Page.stopScreencast").catch(() => undefined);
    await client.detach().catch(() => undefined);
    clientHolder.current = null;
    await page.close().catch(() => undefined);
    pageHolder.current = null;

    // ── 6. Resampling auf konstante 30fps + Chrome-Composite ──────────
    captured.sort((a, b) => a.offsetMs - b.offsetMs);
    const captureStart = Date.now();
    // eslint-disable-next-line no-console
    console.log(
      `[website-render] screencast captured ${captured.length} frames, resampling to ${totalFrames}@${fps}fps`,
    );

    if (captured.length === 0) {
      // eslint-disable-next-line no-console
      console.warn(
        "[website-render] CDP screencast 0 frames — falling back to fullPage-Screenshot Replay",
      );
      // Notfall-Fallback: nochmals page öffnen, fullPage screenshot,
      // sharp-crop pro Frame (das ist der ALTE sharp-Pfad). Besser als
      // schwarzer Screen.
      return await fallbackScreenshotPath(opts, ctx, viewport, fps, framesDir);
    }

    const pickFrame = (targetMs: number): Buffer => {
      // Linear search; captured ist klein (paar Hundert Frames).
      let best = captured[0];
      for (const f of captured) {
        if (f.offsetMs <= targetMs) best = f;
        else break;
      }
      return best.buf;
    };

    const writeFrame = async (i: number) => {
      const targetMs = i * frameIntervalMs;
      const srcJpeg = pickFrame(targetMs);
      // Chrome-PNG oben aufkomponieren, JPG schreiben.
      const composite = await sharp(srcJpeg)
        .resize(viewport.width, viewport.height, { fit: "cover" })
        .composite([{ input: chromePngBuf, top: 0, left: 0 }])
        .jpeg({ quality: 82 })
        .toBuffer();
      await writeFile(
        join(framesDir, `frame-${String(i).padStart(4, "0")}.jpg`),
        composite,
      );
    };

    const CONCURRENCY = 4;
    for (let start = 0; start < totalFrames; start += CONCURRENCY) {
      const batch: Promise<void>[] = [];
      for (let i = start; i < Math.min(totalFrames, start + CONCURRENCY); i++) {
        batch.push(writeFrame(i));
      }
      await Promise.all(batch);
    }

    // eslint-disable-next-line no-console
    console.log(
      `[website-render] composite done in ${Date.now() - captureStart}ms`,
    );

    return {
      durationSec: opts.durationMs / 1000,
      framesDir,
      frameCount: totalFrames,
      fps,
    };
  };

  try {
    return await withTimeout(run(), HARD_TIMEOUT_MS, "renderWebsiteCapture");
  } finally {
    if (clientHolder.current) {
      await clientHolder.current.detach().catch(() => undefined);
    }
    if (pageHolder.current) {
      await pageHolder.current.close().catch(() => undefined);
    }
    await ctx.close();
  }
}
