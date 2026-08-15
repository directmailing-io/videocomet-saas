/**
 * PDF-Segment-Renderer (Drive-Viewer-Look, NICHT personalisiert).
 *
 * Pipeline (hintere Hälfte der personalized-gdocs-Pipeline, ohne DOCX/
 * LibreOffice/Platzhalter — das PDF liegt fertig auf Bunny):
 *
 *   1. PDF von `segment.pdfUrl` in ein Temp-Dir laden (30s-Timeout,
 *      30MB-Sanity-Cap).
 *   2. `pdftoppm` (150 dpi, siehe pdf-to-image.ts) → Seiten-PNGs
 *      (defensiver Seiten-Cap: 40).
 *   3. Seiten-Stack-HTML mit Drive-PDF-Toolbar bauen (pdf-viewer-html.ts,
 *      Maße identisch zur GDocs-Pipeline: 850px Stack, 24px Gap).
 *   4. Puppeteer lädt das HTML via file:// (Request-Interception: nur
 *      file:/data: — keine externen Requests), Toolbar-Clip-Screenshot +
 *      fullPage-Doc-Screenshot.
 *   5. sharp komponiert pro Frame Toolbar + verschobenen Doc-Ausschnitt,
 *      ffmpeg encodiert die JPG-Sequenz zu einem 1280x720-MP4 (identische
 *      Encoder-Args wie der gdocs-Pfad via `imageSeqToMp4`).
 *
 * Cache: Da das PDF-Segment NICHT personalisiert ist, ist das MP4 pro
 * Kampagne für ALLE Leads identisch. Wir cachen das fertige Segment-MP4
 * prozessweit auf Disk — Muster 1:1 vom Webcam-Normalize-Cache in
 * processors/video-render.ts (in-memory Promise-Dedupe + atomares
 * .tmp+rename, ffprobe-validierte Disk-Hits nach Worker-Restart,
 * TTL-Sweep 2h mit mtime-Touch bei Hits).
 */

import { existsSync } from "node:fs";
import { createHash } from "node:crypto";
import {
  copyFile,
  mkdir,
  readdir,
  rename,
  rm,
  stat,
  utimes,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
import type { Page } from "puppeteer-core";
import type { PdfSegment, ScrollFrame } from "@/lib/segments/types";
import { getContext } from "./browser-pool";
import { pdfToPng } from "./pdf-to-image";
import { imageSeqToMp4 } from "./ffmpeg";
import { buildCursorPlan, getCursorPng } from "./cursor-overlay";
import {
  buildPdfViewerHtml,
  PDF_TOOLBAR_HEIGHT_PX,
  PDF_VIEWER_BG,
} from "./pdf-viewer-html";

export interface RenderPdfSegmentOpts {
  segment: PdfSegment;
  /** Geplante (ggf. geclampte) Segment-Dauer in ms. */
  durationMs: number;
  /** Per-Segment-Arbeitsverzeichnis (Frames + Temp; Pipeline räumt auf). */
  outputDir: string;
  /** Zielpfad des fertigen Segment-MP4. */
  outputPath: string;
  /** Frames per second. Default 30. */
  fps?: number;
  viewport?: { width: number; height: number };
}

const HARD_TIMEOUT_MS = 180_000;
const DOWNLOAD_TIMEOUT_MS = 30_000;
/** Sanity-Cap für den PDF-Download — Uploads > 30MB sind nicht vorgesehen. */
const MAX_PDF_BYTES = 30 * 1024 * 1024;
/** Defensiver Seiten-Cap — mehr Seiten scrollt in Video-Länge eh niemand. */
const MAX_PAGES = 40;
/** Parallele sharp-Frame-Composes (wie personalized-gdocs.ts). */
const CONCURRENCY = 4;

/* -------------------------------------------------------------------------- */
/* Segment-MP4-Cache (Muster: Webcam-Normalize-Cache in video-render.ts)      */
/* -------------------------------------------------------------------------- */

const PDF_SEG_CACHE_DIR = "/tmp/videocomet-pdfseg-cache";
const PDF_SEG_CACHE_TTL_MS = 2 * 60 * 60 * 1000;
const PDF_SEG_CACHE = new Map<string, Promise<string>>();

async function sweepPdfSegCache(): Promise<void> {
  try {
    const entries = await readdir(PDF_SEG_CACHE_DIR);
    const now = Date.now();
    for (const name of entries) {
      const p = join(PDF_SEG_CACHE_DIR, name);
      try {
        const s = await stat(p);
        if (now - s.mtimeMs > PDF_SEG_CACHE_TTL_MS) {
          await rm(p, { force: true });
        }
      } catch {
        // best-effort — Datei kann parallel verschwunden sein
      }
    }
  } catch {
    // Cache-Dir existiert noch nicht — ok
  }
}

/**
 * Inhaltsstabiler Cache-Key: Bunny-URLs sind UUID-basiert (neuer Upload =
 * neue URL), daher reicht die URL als Content-Identität. Dauer/fps/Capture-
 * Parameter gehen mit ein, weil sie das gerenderte MP4 verändern.
 */
function buildCacheKey(opts: RenderPdfSegmentOpts, fps: number): string {
  const payload = JSON.stringify({
    v: 2,
    pdfUrl: opts.segment.pdfUrl,
    durationMs: opts.durationMs,
    fps,
    captureMode: opts.segment.captureMode,
    scrollFrames: opts.segment.scrollFrames ?? [],
    cursorFrames: opts.segment.cursorFrames ?? [],
  });
  return createHash("sha1").update(payload).digest("hex");
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

/** Wraps a promise with a hard wall-clock timeout. */
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
              new Error(`[pdf-segment] ${label} timed out after ${ms}ms`),
            ),
          ms,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Lädt das PDF von der Bunny-CDN-URL in `outPath`. Referer-Header wie
 * `fetchToFile` in video-render.ts (Bunny-Hotlink-Protection).
 */
async function downloadPdf(url: string, outPath: string): Promise<void> {
  const referer = process.env.APP_URL ?? "https://app.videocomet.de";
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), DOWNLOAD_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: {
        Referer: referer,
        "User-Agent": "videocomet-worker/1.0",
      },
      signal: ctrl.signal,
    });
    if (!res.ok) {
      throw new Error(`[pdf-segment] PDF download failed: HTTP ${res.status}`);
    }
    const contentLength = Number(res.headers.get("content-length") ?? "0");
    if (contentLength > MAX_PDF_BYTES) {
      throw new Error(
        `[pdf-segment] PDF too large: ${contentLength} bytes (max ${MAX_PDF_BYTES})`,
      );
    }
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength === 0) {
      throw new Error("[pdf-segment] PDF download returned 0 bytes");
    }
    if (buf.byteLength > MAX_PDF_BYTES) {
      throw new Error(
        `[pdf-segment] PDF too large: ${buf.byteLength} bytes (max ${MAX_PDF_BYTES})`,
      );
    }
    await writeFile(outPath, buf);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Per-Frame-scrollTop-Plan (Pixel) aus normalisierten `[{t,y}]`-Samples.
 * Bewusst lokale Kopie des Algorithmus aus website-render-pipeline.ts /
 * personalized-gdocs.ts (Duplikate NICHT konsolidieren — die Pfade sollen
 * unabhängig evolvieren können). Das Frontend spiegelt denselben
 * Algorithmus in `src/lib/segments/scroll-math.ts`
 * (`interpolateScrollRatio`), damit Editor-Vorschau und Render 1:1
 * übereinstimmen.
 */
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
  const clampRatio = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

  let cursor = 0;
  for (let i = 0; i < totalFrames; i++) {
    const tFrame = i * frameIntervalMs;

    if (tFrame <= sorted[0].t) {
      plan[i] = Math.round(clampRatio(sorted[0].y) * maxScroll);
      continue;
    }
    const last = sorted[sorted.length - 1];
    if (tFrame >= last.t) {
      plan[i] = Math.round(clampRatio(last.y) * maxScroll);
      continue;
    }

    while (cursor < sorted.length - 2 && sorted[cursor + 1].t <= tFrame) {
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

/* -------------------------------------------------------------------------- */
/* Kern-Render (uncached)                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Rendert das Segment komplett neu (Download → Raster → Capture → Compose
 * → Encode) und schreibt das fertige MP4 nach `mp4Path`. Räumt sein
 * Arbeitsverzeichnis (inkl. Frames) im finally selbst auf.
 */
async function renderPdfSegmentUncached(
  opts: RenderPdfSegmentOpts,
  mp4Path: string,
  fps: number,
): Promise<void> {
  const viewport = opts.viewport ?? { width: 1280, height: 720 };
  const workDir = join(opts.outputDir, "pdf-render");
  const framesDir = join(workDir, "frames");
  await mkdir(framesDir, { recursive: true });

  const ctx = await getContext();
  const pageHolder: { current: Page | null } = { current: null };

  const run = async (): Promise<void> => {
    // 1. PDF laden.
    const pdfPath = join(workDir, "doc.pdf");
    await downloadPdf(opts.segment.pdfUrl, pdfPath);

    // 2. Seiten-PNGs rastern — exakt dieselbe Rasterung (pdftoppm, 150 dpi)
    //    wie der Upload für die Editor-Vorschau, damit Scroll-Ratios passen.
    const { pages } = await pdfToPng({ pdfPath, outDir: workDir, dpi: 150 });
    if (pages.length === 0) {
      throw new Error("[pdf-segment] pdftoppm produced zero pages");
    }
    let usedPages = pages;
    if (pages.length > MAX_PAGES) {
      // eslint-disable-next-line no-console
      console.warn(
        `[pdf-segment] page cap: ${pages.length} → ${MAX_PAGES} pages`,
      );
      usedPages = pages.slice(0, MAX_PAGES);
    }

    // 3. Viewer-HTML (Toolbar + Seiten-Stack) schreiben.
    const html = buildPdfViewerHtml(
      usedPages.map((p) => `file://${p}`),
      { fileName: opts.segment.fileName, pageCount: usedPages.length },
    );
    const htmlPath = join(workDir, "render.html");
    await writeFile(htmlPath, html, "utf8");

    // 4. Puppeteer-Capture.
    const page = await ctx.context.newPage();
    pageHolder.current = page;
    await page.setViewport({
      width: viewport.width,
      height: viewport.height,
      deviceScaleFactor: 1,
    });

    // file://-Load — externe Resourcen wären reine Wartezeit; nur
    // file:// + data: durchlassen (gleiche Härtung wie personalized-gdocs).
    await page.setRequestInterception(true);
    page.on("request", (req) => {
      const u = req.url();
      if (u.startsWith("file:") || u.startsWith("data:")) {
        req.continue().catch(() => undefined);
      } else {
        req.abort().catch(() => undefined);
      }
    });

    await page.goto(`file://${htmlPath}`, {
      waitUntil: "domcontentloaded",
      timeout: 15_000,
    });

    // Alle Seiten-PNGs fertig decodieren lassen, bevor wir screenshotten.
    await page
      .evaluate(() =>
        Promise.all(
          Array.from(document.images).map((img) =>
            img.decode().catch(() => undefined),
          ),
        ),
      )
      .catch(() => undefined);
    await new Promise((r) => setTimeout(r, 200));

    // Scroll-Verhalten deterministisch machen + auf 0 zurücksetzen.
    await page
      .evaluate(() => {
        document.documentElement.style.overflow = "auto";
        document.body.style.overflow = "auto";
        (document.documentElement.style as unknown as {
          scrollBehavior: string;
        }).scrollBehavior = "auto";
        (document.body.style as unknown as { scrollBehavior: string })
          .scrollBehavior = "auto";
        window.scrollTo(0, 0);
      })
      .catch(() => undefined);

    // 4a. Toolbar-Snapshot (top, 1280 x TOOLBAR_HEIGHT). Die Toolbar ist
    //     position:fixed — beim fullPage-Screenshot bliebe sie nicht oben,
    //     also separat clippen.
    const toolbarBuf = (await page.screenshot({
      type: "png",
      clip: {
        x: 0,
        y: 0,
        width: viewport.width,
        height: PDF_TOOLBAR_HEIGHT_PX,
      },
      fromSurface: true,
    })) as Buffer;

    // 4b. Doc-Snapshot OHNE Toolbar: Toolbar komplett aus dem DOM entfernen
    //     (display:none hatte im gdocs-Pfad Race-Conditions mit dem
    //     fullPage-Reflow) + Layout-Reservierungen neutralisieren, damit
    //     der fullPage-Screenshot bei y=0 mit der ersten Seite beginnt.
    await page.evaluate(() => {
      const bar = document.querySelector(".pdfv-toolbar");
      if (bar && bar.parentNode) bar.parentNode.removeChild(bar);

      const body = document.body;
      body.style.setProperty("padding-top", "0", "important");
      body.style.setProperty("padding-bottom", "0", "important");
      body.style.setProperty("margin", "0", "important");
      body.style.setProperty("min-height", "0", "important");

      const stack = document.querySelector(".pdfv-doc-stack") as
        | HTMLElement
        | null;
      if (stack) {
        stack.style.setProperty("margin-top", "0", "important");
        stack.style.setProperty("margin-bottom", "0", "important");
      }

      document.documentElement.scrollTop = 0;
      document.body.scrollTop = 0;
      window.scrollTo(0, 0);
    });

    // Zwei rAFs: Style-Reset durch den Layout-Cycle + Compositor-Pass
    // abwarten, bevor Puppeteer den fullPage-Snapshot triggert.
    await page.evaluate(
      () =>
        new Promise<void>((r) =>
          requestAnimationFrame(() => requestAnimationFrame(() => r())),
        ),
    );

    const docPngBuf = (await page.screenshot({
      type: "png",
      fullPage: true,
      omitBackground: false,
    })) as Buffer;

    const docMeta = await sharp(docPngBuf).metadata();
    const docPixelWidth = docMeta.width ?? viewport.width;
    const docPixelHeight = docMeta.height ?? viewport.height;

    // Gleiche Formel wie GDocs: sichtbarer Doc-Bereich = Viewport minus
    // Toolbar; maxScroll = Doc-Gesamthöhe minus sichtbarer Bereich.
    const docVisibleH = Math.max(1, viewport.height - PDF_TOOLBAR_HEIGHT_PX);
    const maxScroll = Math.max(0, docPixelHeight - docVisibleH);

    const frameIntervalMs = 1000 / fps;
    const totalFrames = Math.max(
      1,
      Math.ceil(opts.durationMs / frameIntervalMs),
    );

    const hasFrames =
      opts.segment.captureMode === "scroll-recorded" &&
      Array.isArray(opts.segment.scrollFrames) &&
      opts.segment.scrollFrames.length > 0;

    // Cursor-Overlay (Studio-Aufnahme): pro Frame Pixel-Position + PNG.
    const hasCursor =
      Array.isArray(opts.segment.cursorFrames) &&
      opts.segment.cursorFrames.length > 0;
    const cursorPng = hasCursor ? await getCursorPng(viewport.height) : null;
    const cursorPlan = cursorPng
      ? buildCursorPlan(
          opts.segment.cursorFrames,
          totalFrames,
          viewport,
          fps,
          cursorPng,
        )
      : null;

    // 5. sharp-Compose pro Frame: Toolbar oben + verschobener Doc-Crop auf
    //    Drive-grauem Grund (+ optional Cursor obendrauf).
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
      const composites: sharp.OverlayOptions[] = [
        { input: toolbarBuf, top: 0, left: 0 },
        { input: docCrop, top: PDF_TOOLBAR_HEIGHT_PX, left: 0 },
      ];
      const place = cursorPlan?.[i];
      if (cursorPng && place) {
        composites.push({
          input: cursorPng.buf,
          top: place.top,
          left: place.left,
        });
      }
      const frameBuf = await sharp({
        create: {
          width: viewport.width,
          height: viewport.height,
          channels: 3,
          background: PDF_VIEWER_BG, // Drive-Viewer-Grau (#525659)
        },
      })
        .composite(composites)
        .jpeg({ quality: 80 })
        .toBuffer();
      const frameName = `frame-${String(i).padStart(4, "0")}.jpg`;
      await writeFile(join(framesDir, frameName), frameBuf);
    };

    if (
      (opts.segment.captureMode === "static-hero" ||
        maxScroll === 0 ||
        !hasFrames) &&
      !cursorPlan
    ) {
      // Static-Variante: 1 Frame komponieren, N-mal speichern.
      await writeFrame(0, 0);
      const firstBuf = await sharp(
        join(framesDir, "frame-0000.jpg"),
      ).toBuffer();
      for (let i = 1; i < totalFrames; i++) {
        const frameName = `frame-${String(i).padStart(4, "0")}.jpg`;
        await writeFile(join(framesDir, frameName), firstBuf);
      }
    } else if (
      opts.segment.captureMode === "static-hero" ||
      maxScroll === 0 ||
      !hasFrames
    ) {
      // Kein Scroll, aber Cursor-Bewegung → jeden Frame einzeln komponieren
      // (Scroll-Position konstant 0).
      for (let start = 0; start < totalFrames; start += CONCURRENCY) {
        const batch: Promise<void>[] = [];
        for (
          let i = start;
          i < Math.min(totalFrames, start + CONCURRENCY);
          i++
        ) {
          batch.push(writeFrame(i, 0));
        }
        await Promise.all(batch);
      }
    } else {
      const captureStart = Date.now();
      // eslint-disable-next-line no-console
      console.log(
        `[pdf-segment] sharp-render N=${opts.segment.scrollFrames!.length} samples, maxScroll=${maxScroll}, totalFrames=${totalFrames}, docPixelHeight=${docPixelHeight}, pages=${usedPages.length}`,
      );

      const plan = buildScrollPlanFromFrames(
        opts.segment.scrollFrames as ScrollFrame[],
        totalFrames,
        maxScroll,
        fps,
      );

      for (let start = 0; start < totalFrames; start += CONCURRENCY) {
        const batch: Promise<void>[] = [];
        for (
          let i = start;
          i < Math.min(totalFrames, start + CONCURRENCY);
          i++
        ) {
          batch.push(writeFrame(i, plan[i] ?? 0));
        }
        await Promise.all(batch);
      }

      // eslint-disable-next-line no-console
      console.log(
        `[pdf-segment] sharp-render done in ${Date.now() - captureStart}ms (${totalFrames} frames)`,
      );
    }

    // 6. Frames → MP4 (identische Encoder-Args wie der gdocs-Pfad).
    await imageSeqToMp4({ framesDir, outputPath: mp4Path, fps });
  };

  try {
    await withTimeout(run(), HARD_TIMEOUT_MS, "renderPdfSegment");
  } finally {
    if (pageHolder.current) {
      await pageHolder.current.close().catch(() => undefined);
    }
    await ctx.close();
    // Best-effort: PDF + Seiten-PNGs + Frames entfernen — das fertige MP4
    // liegt außerhalb von workDir.
    await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

/* -------------------------------------------------------------------------- */
/* Public API (mit Cache)                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Rendert ein PDF-Segment zu einem 1280x720-MP4 nach `opts.outputPath`.
 *
 * Weil das Ergebnis pro Kampagne für alle Leads identisch ist, läuft der
 * eigentliche Render pro Cache-Key genau einmal pro Prozess (parallele
 * Leads teilen die Promise); danach wird nur noch aus dem Cache kopiert.
 */
export async function renderPdfSegment(
  opts: RenderPdfSegmentOpts,
): Promise<void> {
  const fps = opts.fps ?? 30;
  const key = buildCacheKey(opts, fps);
  const target = join(PDF_SEG_CACHE_DIR, `${key}.mp4`);

  const existing = PDF_SEG_CACHE.get(key);
  if (existing) {
    try {
      const p = await existing;
      if (existsSync(p)) {
        // mtime touchen, damit der TTL-Sweep aktive Einträge nicht killt.
        const now = new Date();
        await utimes(p, now, now).catch(() => {});
        // eslint-disable-next-line no-console
        console.log(`[pdf-segment] cache hit (${key.slice(0, 8)})`);
        await copyFile(p, opts.outputPath);
        return;
      }
    } catch {
      // rejected — unten frisch aufbauen
    }
    PDF_SEG_CACHE.delete(key);
  }

  const job = (async () => {
    await mkdir(PDF_SEG_CACHE_DIR, { recursive: true });
    void sweepPdfSegCache();

    if (existsSync(target)) {
      // Disk-Hit ohne Memory-Eintrag (z.B. nach Worker-Restart) — nicht
      // blind vertrauen: könnte ein Torso eines gekillten Prozesses sein.
      try {
        const { probeVideoDuration } = await import("../../lib/ffprobe");
        const d = await probeVideoDuration(target);
        if (typeof d === "number" && d > 0) {
          const now = new Date();
          await utimes(target, now, now).catch(() => {});
          // eslint-disable-next-line no-console
          console.log(
            `[pdf-segment] cache hit from disk (${key.slice(0, 8)})`,
          );
          return target;
        }
      } catch {
        // invalide — neu aufbauen
      }
      await rm(target, { force: true }).catch(() => {});
    }

    const tmp = `${target}.tmp.${process.pid}.${Date.now()}`;
    try {
      await renderPdfSegmentUncached(opts, tmp, fps);
      await rename(tmp, target); // atomar (gleiches FS)
      return target;
    } finally {
      await rm(tmp, { force: true }).catch(() => {});
    }
  })();

  PDF_SEG_CACHE.set(key, job);
  job.catch(() => PDF_SEG_CACHE.delete(key));

  const cachedPath = await job;
  await copyFile(cachedPath, opts.outputPath);
}
