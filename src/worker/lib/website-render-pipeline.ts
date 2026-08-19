/**
 * Website-Render-Pipeline mit ECHTEM Screencast — voller Viewport,
 * kein Browser-Chrome.
 *
 * Statt einen einzelnen fullPage-Screenshot zu nehmen (das verlor
 * Animationen, Slider und JS-Effekte), nutzen wir Chrome DevTools
 * Protocol's `Page.startScreencast`. CDP emittiert Frames in echtzeit
 * vom Compositor-Buffer — alles was live im Browser passiert (Carousel,
 * Hover-States, Auto-Play-Videos, Lazy-Images die nachladen) wandert
 * mit ins Video.
 *
 * Architektur:
 *   1. Puppeteer-Page öffnen, navigieren, Cookies dismissen, Scrollbars
 *      ausblenden
 *   2. CDP-Session öffnen, screencastFrame-Events sammeln
 *   3. Scroll über die Aufnahme-Dauer abspielen (30fps Tick-Loop)
 *   4. Screencast stoppen, alle Captured-Frames sortieren
 *   5. Für jeden Output-Frame (i = 0..N-1): den zeitlich nächstgelegenen
 *      Capture-Frame nehmen → JPG schreiben
 *
 * Performance: CDP-Screencast emittiert mit ~30-60fps direkt vom
 * Compositor; das ist deutlich schneller als 480× page.screenshot.
 * Pro Lead ca. 10-15s.
 *
 * Notfall-Fallback: wenn CDP 0 Frames liefert, fallen wir auf einen
 * fullPage-Screenshot mit sharp-Crop pro Frame zurück — Animationen
 * gehen verloren, aber das Video ist nie schwarz.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { lookup as dnsLookup } from "node:dns/promises";
import sharp from "sharp";
import type { Page, CDPSession } from "puppeteer-core";
import type { CursorFrame, ScrollFrame } from "@/lib/segments/types";
import {
  CURSOR_HEIGHT_RATIO,
  CURSOR_SVG_DATA_URI,
} from "@/lib/segments/cursor-overlay";
import { buildCursorPlan, getCursorPng } from "./cursor-overlay";
import { getContext, type PooledContext } from "./browser-pool";
import {
  prepareCleanPage,
  acquireHostSlot,
  RenderNotReadyError,
  type CleanPageSession,
} from "./clean-render";

/**
 * Schnelle DNS-Vorab-Prüfung: löst den Host der URL in 3s auf, sonst wirft.
 * Verhindert dass page.goto bei broken Domains 30s in den Timeout läuft
 * + retry + fallback — was sich auf 60-90s pro broken-URL-Lead summiert.
 */
async function preflightDnsCheck(url: string): Promise<void> {
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    throw new Error(`[dns-preflight] invalid URL: ${url}`);
  }
  const TIMEOUT_MS = 3_000;
  await Promise.race([
    dnsLookup(host),
    new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error(`[dns-preflight] timeout for ${host}`)),
        TIMEOUT_MS,
      ),
    ),
  ]);
}

export interface RenderWebsiteOpts {
  url: string;
  outputDir: string;
  durationMs: number;
  /** Kooperativer Abbruch bei Stage-Timeout (ENOENT-Race-Fix 2026-08-19). */
  signal?: AbortSignal;
  mode: "static-hero" | "scroll-recorded";
  scrollFrames?: ScrollFrame[];
  /** Mauszeiger-Samples aus der Studio-Aufnahme (optional). */
  cursorFrames?: CursorFrame[];
  viewport?: { width: number; height: number };
  fps?: number;
}

export interface RenderWebsiteResult {
  durationSec: number;
  framesDir: string;
  frameCount: number;
  fps: number;
}

// HARD_TIMEOUT_MS deckt den GESAMTEN Capture-Prozess (goto + Setup +
// Frame-Aufnahme). Frame-Aufnahme läuft in Realzeit über die volle
// durationMs des Segments — 90 s Fix-Timeout waren fatal für alle
// Segmente > 60 s: sie liefen unweigerlich in den Timeout und lieferten
// den „Website nicht erreichbar"-Placeholder statt der echten Aufnahme
// (Vorfall 2026-08-19, Kampagne Test 3 mit 111 s-Segment). Jetzt
// dynamisch: durationMs + 60 s Overhead (goto bis 30 s, Setup + Screencast-
// Puffer). Bleibt unter dem videoRender-Stage-Timeout, weil das
// Stage-Timeout die Summe ALLER Segmente deckelt — der Einzel-Timeout
// hier ist nur die Notbremse für hängende Browser.
const CAPTURE_TIMEOUT_OVERHEAD_MS = 60_000;
const MIN_CAPTURE_TIMEOUT_MS = 90_000;
function captureHardTimeoutMs(durationMs: number): number {
  return Math.max(MIN_CAPTURE_TIMEOUT_MS, durationMs + CAPTURE_TIMEOUT_OVERHEAD_MS);
}
// 12s war zu knapp: wotruba-gmbh.de u.ä. haben TTFB von 5-8s + JS-heavy
// Frontend, `networkidle2` wird nie erreicht → jede Kampagne bekam den
// „Website nicht erreichbar"-Placeholder statt der Kunden-Seite
// (Vorfall 2026-08-19). 30s deckt langsame WordPress-Shops komfortabel ab
// und bleibt unter dem videoRender-Stage-Timeout von 300s.
const GOTO_TIMEOUT_MS = 30_000;

/**
 * Module-level cache for per-host browser-chrome / static-hero JPGs.
 * Keyed by `${hostname}_${width}` so multiple campaigns hitting the same
 * domain at the same viewport share the rendered PNG instead of paying
 * the Puppeteer setContent + screenshot cost per lead (~100-200ms saved
 * per lead with same-domain re-use). The placeholder cache (separate
 * key namespace `unreachable:${host}_${w}x${h}`) keeps DNS-failure
 * rendering near-free across an entire run targeting the same broken
 * URL.
 *
 * Memory bound: a 1280x720 JPG quality 82 is typically <100 KB. Even a
 * 1000-host run would top out under 100 MB — well below the worker's
 * RSS budget. No eviction policy yet (single-process Node, restarts
 * clear the cache anyway).
 */
const STATIC_HERO_CACHE = new Map<string, Buffer>();
const UNREACHABLE_PLACEHOLDER_CACHE = new Map<string, Buffer>();

function safeHostname(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return url.toLowerCase();
  }
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

/**
 * Schreibt `totalFrames` JPGs aus einem statischen Basisbild — ohne Cursor
 * als reine Buffer-Replikation, mit Cursor pro Frame als sharp-Composite
 * (das Basisbild bleibt cursor-frei und damit sauber cachebar).
 */
async function writeStaticFramesWithCursor(
  baseJpg: Buffer,
  framesDir: string,
  totalFrames: number,
  viewport: { width: number; height: number },
  fps: number,
  cursorFrames?: CursorFrame[],
  signal?: AbortSignal,
): Promise<void> {
  const hasCursor = Array.isArray(cursorFrames) && cursorFrames.length > 0;
  const cursorPng = hasCursor ? await getCursorPng(viewport.height) : null;
  const plan = cursorPng
    ? buildCursorPlan(cursorFrames, totalFrames, viewport, fps, cursorPng)
    : null;
  for (let i = 0; i < totalFrames; i++) {
    signal?.throwIfAborted();
    const place = plan?.[i];
    const buf =
      cursorPng && place
        ? await sharp(baseJpg)
            .composite([
              { input: cursorPng.buf, top: place.top, left: place.left },
            ])
            .jpeg({ quality: 82 })
            .toBuffer()
        : baseJpg;
    await writeFile(
      join(framesDir, `frame-${String(i).padStart(4, "0")}.jpg`),
      buf,
    );
  }
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
 * Pure-sharp Placeholder ohne Puppeteer. Wird gerufen wenn die Live-URL
 * gar nicht erreichbar ist (DNS-fail, SSL-fail, server-timeout). Generiert
 * ein neutrales Standbild mit Hinweis-Text und repliziert es N-mal als
 * JPG. KEIN browser-pool, daher hängt nichts wenn Puppeteer deadlocked.
 */
export async function renderUnreachablePlaceholder(opts: {
  url: string;
  outputDir: string;
  durationMs: number;
  viewport?: { width: number; height: number };
  fps?: number;
}): Promise<RenderWebsiteResult> {
  const viewport = opts.viewport ?? { width: 1280, height: 720 };
  const fps = opts.fps ?? 30;
  const framesDir = join(opts.outputDir, "frames");
  await mkdir(framesDir, { recursive: true });

  const frameIntervalMs = 1000 / fps;
  const totalFrames = Math.max(
    1,
    Math.ceil(opts.durationMs / frameIntervalMs),
  );

  const host = safeHostname(opts.url);

  // Cache the placeholder JPG per host+viewport. A 1000-lead run
  // targeting one broken domain reuses the same buffer instead of
  // re-rasterising the SVG 1000 times.
  const cacheKey = `unreachable:${host}_${viewport.width}x${viewport.height}`;
  let jpg = UNREACHABLE_PLACEHOLDER_CACHE.get(cacheKey);
  if (!jpg) {
    // SVG → PNG via sharp. Brand-Lila Akzent, Apple/AirBNB-Style.
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${viewport.width}" height="${viewport.height}">
      <rect width="100%" height="100%" fill="#FAFAFA"/>
      <rect x="${viewport.width / 2 - 220}" y="${viewport.height / 2 - 80}" width="440" height="36" rx="18" fill="#F3EEFF"/>
      <text x="50%" y="${viewport.height / 2 - 54}" text-anchor="middle" font-family="Inter, Arial, sans-serif" font-size="14" font-weight="600" fill="#7C5CE8">Website nicht erreichbar</text>
      <text x="50%" y="${viewport.height / 2 + 10}" text-anchor="middle" font-family="Inter, Arial, sans-serif" font-size="40" font-weight="600" fill="#222">Wir konnten die Seite nicht laden</text>
      <text x="50%" y="${viewport.height / 2 + 50}" text-anchor="middle" font-family="Inter, Arial, sans-serif" font-size="16" fill="#717171">Die folgende URL lieferte keine Antwort:</text>
      <rect x="${viewport.width / 2 - 320}" y="${viewport.height / 2 + 70}" width="640" height="40" rx="20" fill="#fff" stroke="#EBEBEB"/>
      <text x="50%" y="${viewport.height / 2 + 96}" text-anchor="middle" font-family="JetBrains Mono, monospace" font-size="14" fill="#222">${host.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</text>
    </svg>`;
    jpg = await sharp(Buffer.from(svg)).jpeg({ quality: 82 }).toBuffer();
    UNREACHABLE_PLACEHOLDER_CACHE.set(cacheKey, jpg);
  }

  for (let i = 0; i < totalFrames; i++) {
    await writeFile(
      join(framesDir, `frame-${String(i).padStart(4, "0")}.jpg`),
      jpg,
    );
  }
  return {
    durationSec: opts.durationMs / 1000,
    framesDir,
    frameCount: totalFrames,
    fps,
  };
}

/**
 * Notfall-Fallback: wenn CDP-Screencast 0 Frames produzierte (z.B. wegen
 * GPU-Compositor-Issues), öffnen wir die Page nochmal kurz, machen EINEN
 * fullPage-Screenshot und replay-en das per sharp-Crop. Animationen
 * gehen verloren, aber dafür gibt's kein schwarzes Video.
 */
async function fallbackScreenshotPath(
  opts: RenderWebsiteOpts,
  ctx: PooledContext,
  viewport: { width: number; height: number },
  fps: number,
  framesDir: string,
): Promise<RenderWebsiteResult> {
  const fbPage = await ctx.context.newPage();
  try {
    await fbPage.setViewport({
      width: viewport.width,
      height: viewport.height,
      deviceScaleFactor: 1,
    });
    // Clean-Render light: Adblock + Preseed + Dismiss, aber ohne Watchdog/
    // Telemetrie (der Haupt-Run hat schon einen Telemetrie-Eintrag) und ohne
    // QA-Gate-Throw — dieser Pfad ist die letzte Rettung vor Schwarzbild.
    const fbClean = await prepareCleanPage(fbPage, opts.url);
    await fbPage
      .goto(opts.url, {
        waitUntil: "domcontentloaded",
        timeout: GOTO_TIMEOUT_MS,
      })
      .catch(() => undefined);
    await new Promise((r) => setTimeout(r, 1_000));
    await fbClean
      .stabilize({ dismissTimeoutMs: 3_000, skipWatchdog: true })
      .catch(() => undefined);
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
    const maxScroll = Math.max(0, docH - viewport.height);

    await fbPage.close().catch(() => undefined);

    const frameIntervalMs = 1000 / fps;
    const totalFrames = Math.max(
      1,
      Math.ceil(opts.durationMs / frameIntervalMs),
    );
    const plan =
      opts.scrollFrames && opts.scrollFrames.length > 0
        ? buildScrollPlanFromFrames(
            opts.scrollFrames,
            totalFrames,
            maxScroll,
            fps,
          )
        : new Array<number>(totalFrames).fill(0);

    const hasCursor =
      Array.isArray(opts.cursorFrames) && opts.cursorFrames.length > 0;
    const cursorPng = hasCursor ? await getCursorPng(viewport.height) : null;
    const cursorPlan = cursorPng
      ? buildCursorPlan(opts.cursorFrames, totalFrames, viewport, fps, cursorPng)
      : null;

    for (let i = 0; i < totalFrames; i++) {
      const y = Math.max(0, Math.min(maxScroll, plan[i] ?? 0));
      const cropH = Math.min(viewport.height, docH - y);
      const docCrop = await sharp(docPng)
        .extract({ left: 0, top: y, width: docW, height: cropH })
        .toBuffer();
      const composites: sharp.OverlayOptions[] = [
        { input: docCrop, top: 0, left: 0 },
      ];
      const place = cursorPlan?.[i];
      if (cursorPng && place) {
        composites.push({
          input: cursorPng.buf,
          top: place.top,
          left: place.left,
        });
      }
      // Wenn Doc kürzer als viewport ist, füllen wir weiß auf.
      const composite = await sharp({
        create: {
          width: viewport.width,
          height: viewport.height,
          channels: 3,
          background: { r: 255, g: 255, b: 255 },
        },
      })
        .composite(composites)
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

  // Fast-path: static-hero captures depend only on the URL+viewport
  // (no scrolling, no per-lead personalisation). If we already
  // rendered this host at this viewport, skip Puppeteer entirely and
  // replay the cached JPG. Saves ~100-200ms per same-domain lead.
  if (opts.mode === "static-hero") {
    const heroKey = `${safeHostname(opts.url)}_${viewport.width}`;
    const cachedHero = STATIC_HERO_CACHE.get(heroKey);
    if (cachedHero) {
      const frameIntervalMs = 1000 / fps;
      const totalFrames = Math.max(
        1,
        Math.ceil(opts.durationMs / frameIntervalMs),
      );
      // eslint-disable-next-line no-console
      console.log(
        `[website-render] static-hero cache HIT key=${heroKey} → ${totalFrames} frames from buffer`,
      );
      await writeStaticFramesWithCursor(
        cachedHero,
        framesDir,
        totalFrames,
        viewport,
        fps,
        opts.cursorFrames,
        opts.signal,
      );
      return {
        durationSec: opts.durationMs / 1000,
        framesDir,
        frameCount: totalFrames,
        fps,
      };
    }
  }

  const ctx = await getContext();
  const pageHolder: { current: Page | null } = { current: null };
  const clientHolder: { current: CDPSession | null } = { current: null };
  const cleanupHolder: {
    releaseSlot: (() => void) | null;
    clean: CleanPageSession | null;
  } = { releaseSlot: null, clean: null };
  let captureOk = false;
  let captureProblem: string | null = null;

  const run = async (): Promise<RenderWebsiteResult> => {
    opts.signal?.throwIfAborted();
    // Host-Throttle: max. 2 parallele Loads pro Shop-Host (Schicht 4b).
    cleanupHolder.releaseSlot = await acquireHostSlot(opts.url);

    // ── 1. Live-Page öffnen ───────────────────────────────────────────
    const page = await ctx.context.newPage();
    pageHolder.current = page;
    await page.setViewport({
      width: viewport.width,
      height: viewport.height,
      deviceScaleFactor: 1,
    });

    // DNS-Preflight: bei broken Domain sofort werfen, kein 30s+10s
    // page.goto-Tanz für offensichtlich nicht erreichbare URLs.
    await preflightDnsCheck(opts.url);

    // Clean-Render Schicht 0+1: Adblocker + Consent-Preseed VOR goto.
    const clean = await prepareCleanPage(page, opts.url);
    cleanupHolder.clean = clean;

    // DOM reicht für den anschließenden Screenshot-Lauf; auf `networkidle2`
    // (Analytics, Chatwidgets, LazyLoad-Bilder) kommen viele Marketing-Sites
    // nie zur Ruhe → früher stumme Timeout-Fallbacks. Der 1,2 s-Sleep unten
    // fängt DOM-Nachrenderings auf, der Scroll-Loop belädt LazyLoad-Bereiche
    // beim Vorbeiscrollen automatisch nach.
    try {
      await page.goto(opts.url, {
        waitUntil: "domcontentloaded",
        timeout: GOTO_TIMEOUT_MS,
      });
    } catch (e) {
      try {
        await page.goto(opts.url, {
          waitUntil: "load",
          timeout: 15_000,
        });
      } catch {
        throw e instanceof Error ? e : new Error(String(e));
      }
    }

    await new Promise((r) => setTimeout(r, 1_200));

    // Clean-Render Schicht 2–4: Dismiss + QA-Gate (wirft RenderNotReadyError
    // bei Fehlerseite auch nach Reload → Caller rendert Platzhalter) + Watchdog.
    try {
      await clean.stabilize({ dismissTimeoutMs: 3_000 });
    } catch (err) {
      if (err instanceof RenderNotReadyError) throw err;
      // Sonstige stabilize-Fehler nie fatal.
    }

    // Scrollbars + smooth-scroll abschalten.
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

    // ── 2. Static-Hero Shortcut: kein Screencast nötig ────────────────
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
      // Direkt als JPG schreiben — kein Composite mehr nötig.
      const staticJpg = await sharp(staticPng).jpeg({ quality: 82 }).toBuffer();
      // Populate the per-host static-hero cache so subsequent leads
      // hitting the same domain skip Puppeteer entirely. Das Basisbild
      // ist cursor-frei — der Cursor wird pro Frame komponiert.
      if (opts.mode === "static-hero") {
        const heroKey = `${safeHostname(opts.url)}_${viewport.width}`;
        STATIC_HERO_CACHE.set(heroKey, staticJpg);
      }
      await writeStaticFramesWithCursor(
        staticJpg,
        framesDir,
        totalFrames,
        viewport,
        fps,
        opts.cursorFrames,
        opts.signal,
      );
      return {
        durationSec: opts.durationMs / 1000,
        framesDir,
        frameCount: totalFrames,
        fps,
      };
    }

    // ── 3. CDP-Screencast starten ─────────────────────────────────────
    // eslint-disable-next-line no-console
    console.log(
      `[website-render] CDP screencast url=${opts.url} docHeight=${docHeight} maxScroll=${maxScroll} totalFrames=${totalFrames}`,
    );

    const client = await page.createCDPSession();
    clientHolder.current = client;

    // Some Chromium builds need Page.enable before screencast events fire.
    await client.send("Page.enable").catch(() => undefined);

    // CDP screencast captures den active tab; ohne bringToFront kann es
    // passieren, dass Background-Tabs gar nicht oder schwarz aufgezeichnet
    // werden.
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

    // ── 4. Scroll-Driver (zielt 30 fps an, läuft genau durationMs) ────
    const plan = buildScrollPlanFromFrames(
      opts.scrollFrames as ScrollFrame[],
      totalFrames,
      maxScroll,
      fps,
    );

    // Cursor als fixed-position DOM-<img> — wandert im Compositor mit
    // in den Screencast, kein sharp-Composite nötig. Die Positionen
    // (Hotspot-verrechnet, geclampt) kommen aus demselben Plan wie in
    // den sharp-Pfaden.
    const hasCursor =
      Array.isArray(opts.cursorFrames) && opts.cursorFrames.length > 0;
    const cursorHeightPx = Math.max(
      8,
      Math.round(viewport.height * CURSOR_HEIGHT_RATIO),
    );
    const cursorPlan = hasCursor
      ? buildCursorPlan(opts.cursorFrames, totalFrames, viewport, fps, {
          width: cursorHeightPx,
          height: cursorHeightPx,
        })
      : null;
    if (cursorPlan) {
      await page
        .evaluate(
          (dataUri, h) => {
            const img = document.createElement("img");
            img.id = "__vc_cursor";
            img.src = dataUri;
            img.style.cssText = `position:fixed;left:0;top:0;width:${h}px;height:${h}px;z-index:2147483647;pointer-events:none;display:none;`;
            document.documentElement.appendChild(img);
          },
          CURSOR_SVG_DATA_URI,
          cursorHeightPx,
        )
        .catch(() => undefined);
    }

    for (let i = 0; i < totalFrames; i++) {
      opts.signal?.throwIfAborted();
      const targetT = i * frameIntervalMs;
      const currentT = Date.now() - screencastStart;
      if (currentT < targetT) {
        await new Promise((r) => setTimeout(r, targetT - currentT));
      }
      await page
        .evaluate(
          (y, c) => {
            window.scrollTo(0, y);
            const img = document.getElementById("__vc_cursor");
            if (img) {
              if (c) {
                img.style.transform = `translate(${c.left}px,${c.top}px)`;
                img.style.display = "block";
              } else {
                img.style.display = "none";
              }
            }
          },
          plan[i] ?? 0,
          cursorPlan ? cursorPlan[i] : null,
        )
        .catch(() => undefined);
    }

    // kurz warten damit die letzten Frames noch ankommen
    await new Promise((r) => setTimeout(r, 200));

    await client.send("Page.stopScreencast").catch(() => undefined);
    await client.detach().catch(() => undefined);
    clientHolder.current = null;
    await page.close().catch(() => undefined);
    pageHolder.current = null;

    // ── 5. Resampling auf konstante 30fps ─────────────────────────────
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
      return await fallbackScreenshotPath(opts, ctx, viewport, fps, framesDir);
    }

    const pickFrame = (targetMs: number): Buffer => {
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
      // Direkt skalieren + JPG. Falls CDP eine andere Größe liefert,
      // resize.cover passt's auf viewport an.
      const out = await sharp(srcJpeg)
        .resize(viewport.width, viewport.height, { fit: "cover" })
        .jpeg({ quality: 82 })
        .toBuffer();
      await writeFile(
        join(framesDir, `frame-${String(i).padStart(4, "0")}.jpg`),
        out,
      );
    };

    const CONCURRENCY = 4;
    for (let start = 0; start < totalFrames; start += CONCURRENCY) {
      opts.signal?.throwIfAborted();
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
    const result = await withTimeout(
      run(),
      captureHardTimeoutMs(opts.durationMs),
      "renderWebsiteCapture",
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
    if (clientHolder.current) {
      await clientHolder.current.detach().catch(() => undefined);
    }
    if (pageHolder.current) {
      await pageHolder.current.close().catch(() => undefined);
    }
    await ctx.close();
    cleanupHolder.releaseSlot?.();
  }
}
