/**
 * Website-Render-Pipeline (Per-Lead, mit Browser-Chrome).
 *
 * Ziel: Das fertige Video sieht aus, als würde der User die echte
 * Lead-Website im Browser geöffnet haben und live durchscrollen — inkl.
 * realistischer macOS/Chrome Browser-Toolbar mit Adressleiste, Buttons
 * und Tabs.
 *
 * Architektur (parallel zur gdocs-Pipeline):
 *   1. Puppeteer: lade Live-URL, dismisse Cookie-Banner, blende
 *      Scrollbars aus
 *   2. EINEN fullPage-Screenshot der gesamten Page (das ist das langlebige
 *      "Doc-PNG")
 *   3. Browser-Chrome als HTML → einen 80px-hohen PNG-Screenshot via
 *      Puppeteer-Page (mit der echten Lead-URL in der Adressleiste)
 *   4. Sharp pro Frame: Crop des Doc-PNG bei scrollY + Composite mit
 *      Browser-Chrome oben → JPG
 *
 * Vorteile gegenueber `recordCapture`-Pfad:
 *   - 2x Puppeteer-Calls pro Lead statt 480 → ~10s statt ~128s
 *   - Sharp ist multi-threaded und memory-efficient
 *   - Browser-Chrome macht das Capture als echte Bildschirm-Aufnahme
 *     erkennbar
 *   - ScrollFrames-Mapping ist konsistent mit der gdocs-Pipeline
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
import type { Page } from "puppeteer-core";
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

/** Höhe der nachgebauten Browser-Chrome in CSS-Pixeln. */
const CHROME_HEIGHT_PX = 80;
const HARD_TIMEOUT_MS = 180_000;
const GOTO_TIMEOUT_MS = 30_000;

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Generiert das HTML einer minimalistischen Chrome/Safari-artigen
 * Browser-Toolbar mit Tab + Adressleiste. Inline-SVGs statt Emojis
 * (Container-Fonts sind unzuverlaessig). Höhe genau CHROME_HEIGHT_PX.
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
.icon-btn{width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;cursor:default}
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

export async function renderWebsiteCapture(
  opts: RenderWebsiteOpts,
): Promise<RenderWebsiteResult> {
  const viewport = opts.viewport ?? { width: 1280, height: 720 };
  const fps = opts.fps ?? 30;
  const framesDir = join(opts.outputDir, "frames");
  await mkdir(framesDir, { recursive: true });

  // Doc-area Hoehe = viewport - Browser-Chrome. Damit das Content-PNG
  // genauso skaliert ist wie es im Modal aussah.
  const docVisibleH = Math.max(1, viewport.height - CHROME_HEIGHT_PX);

  const ctx = await getContext();
  const pageHolder: { current: Page | null } = { current: null };

  const run = async (): Promise<RenderWebsiteResult> => {
    const page = await ctx.context.newPage();
    pageHolder.current = page;
    await page.setViewport({
      width: viewport.width,
      height: docVisibleH,
      deviceScaleFactor: 1,
    });

    // 1. Lade die Live-URL.
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

    // 2. Wartezeit fuer CSS / Hero-Bilder.
    await new Promise((r) => setTimeout(r, 1_200));
    await dismissCookieBanners(page, 3_000).catch(() => false);

    // 3. Scrollbars + smooth-scroll abschalten — sonst sieht das Crop
    //    unsauber aus und scrollHeight-Messung wird unzuverlaessig.
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

    // 4. Full-Page-Screenshot der Site.
    const docPngBuf = (await page.screenshot({
      type: "png",
      fullPage: true,
      captureBeyondViewport: true,
    })) as Buffer;

    const docMeta = await sharp(docPngBuf).metadata();
    const docPixelWidth = docMeta.width ?? viewport.width;
    const docPixelHeight = docMeta.height ?? viewport.height;
    const maxScroll = Math.max(0, docPixelHeight - docVisibleH);

    // 5. Browser-Chrome HTML → 80px PNG via gleiche Page wiederverwendet
    //    (set content + clip-screenshot).
    await page.setViewport({
      width: viewport.width,
      height: CHROME_HEIGHT_PX,
      deviceScaleFactor: 1,
    });
    await page.setContent(buildBrowserChromeHtml(opts.url, viewport.width), {
      waitUntil: "domcontentloaded",
    });
    await new Promise((r) => setTimeout(r, 100));
    const chromePngBuf = (await page.screenshot({
      type: "png",
      clip: {
        x: 0,
        y: 0,
        width: viewport.width,
        height: CHROME_HEIGHT_PX,
      },
    })) as Buffer;

    // Page nicht mehr noetig — schliesen frei.
    await page.close().catch(() => undefined);
    pageHolder.current = null;

    const frameIntervalMs = 1000 / fps;
    const totalFrames = Math.max(
      1,
      Math.ceil(opts.durationMs / frameIntervalMs),
    );

    const hasFrames =
      opts.mode === "scroll-recorded" &&
      Array.isArray(opts.scrollFrames) &&
      opts.scrollFrames.length > 0;

    const writeFrame = async (i: number, scrollY: number) => {
      const clampedY = Math.max(0, Math.min(maxScroll, Math.round(scrollY)));
      const cropHeight = Math.min(docVisibleH, docPixelHeight - clampedY);
      const docCrop = await sharp(docPngBuf)
        .extract({
          left: 0,
          top: clampedY,
          width: docPixelWidth,
          height: cropHeight,
        })
        .toBuffer();
      const frameBuf = await sharp({
        create: {
          width: viewport.width,
          height: viewport.height,
          channels: 3,
          background: { r: 255, g: 255, b: 255 },
        },
      })
        .composite([
          { input: chromePngBuf, top: 0, left: 0 },
          { input: docCrop, top: CHROME_HEIGHT_PX, left: 0 },
        ])
        .jpeg({ quality: 82 })
        .toBuffer();
      await writeFile(
        join(framesDir, `frame-${String(i).padStart(4, "0")}.jpg`),
        frameBuf,
      );
    };

    if (opts.mode === "static-hero" || maxScroll === 0 || !hasFrames) {
      await writeFrame(0, 0);
      const firstBuf = await sharp(
        join(framesDir, "frame-0000.jpg"),
      ).toBuffer();
      for (let i = 1; i < totalFrames; i++) {
        await writeFile(
          join(framesDir, `frame-${String(i).padStart(4, "0")}.jpg`),
          firstBuf,
        );
      }
      return {
        durationSec: opts.durationMs / 1000,
        framesDir,
        frameCount: totalFrames,
        fps,
      };
    }

    const captureStart = Date.now();
    // eslint-disable-next-line no-console
    console.log(
      `[website-render] sharp-render url=${opts.url} N=${opts.scrollFrames!.length} maxScroll=${maxScroll} totalFrames=${totalFrames} docPixelHeight=${docPixelHeight}`,
    );

    const plan = buildScrollPlanFromFrames(
      opts.scrollFrames as ScrollFrame[],
      totalFrames,
      maxScroll,
      fps,
    );

    const CONCURRENCY = 4;
    for (let start = 0; start < totalFrames; start += CONCURRENCY) {
      const batch: Promise<void>[] = [];
      for (let i = start; i < Math.min(totalFrames, start + CONCURRENCY); i++) {
        batch.push(writeFrame(i, plan[i] ?? 0));
      }
      await Promise.all(batch);
    }

    // eslint-disable-next-line no-console
    console.log(
      `[website-render] done in ${Date.now() - captureStart}ms (${totalFrames} frames)`,
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
    if (pageHolder.current) {
      await pageHolder.current.close().catch(() => undefined);
    }
    await ctx.close();
  }
}
