/**
 * Personalized Google-Docs video capture.
 *
 * Pipeline:
 *   1. Download the Doc as HTML (`format=html` export).
 *   2. Substitute `{{placeholders}}` with per-lead values.
 *   3. Write the personalized HTML to a temp file and load it in Puppeteer
 *      via `file://` (no Google chrome, no login redirects, no cookie
 *      banners).
 *   4. Capture a JPEG sequence the same way `recordCapture` does — either
 *      a single static-hero shot replayed N times, or an interpolated
 *      scroll playback mapped to the rendered document height.
 *
 * Why this exists: the previous gdocs path captured the LIVE Google Docs
 * URL, which (a) showed the Google UI chrome and (b) bypassed placeholder
 * substitution entirely. Worse, the scroll recorder reported
 * `document.body.scrollHeight` from the preview SHELL, not from
 * `.kix-page`, so recorded scrolls played back static.
 *
 * This module is independent from `scroll-recorder.ts` — duplicated helpers
 * (`shootFrame`, `scrollPageTo`, `buildScrollPlanFromFrames`) are inlined
 * so the gdocs capture stays self-contained and we can evolve it without
 * affecting the live-URL Website-segment path.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
import type { Page } from "puppeteer-core";
import type { ScrollFrame } from "@/lib/segments/types";
import { getContext } from "./browser-pool";
import {
  renderGDocsToHtml,
  cleanupRenderedGDocs,
  GDOCS_TOOLBAR_HEIGHT_PX,
} from "./gdocs-render-pipeline";

export interface RenderGDocsOpts {
  docsUrl: string;
  vars: Record<string, string>;
  outputDir: string;
  durationMs: number;
  mode: "static-hero" | "scroll-recorded";
  scrollFrames?: ScrollFrame[];
  viewport?: { width: number; height: number };
  /** Frames per second. Default 30. */
  fps?: number;
}

export interface RenderGDocsResult {
  durationSec: number;
  framesDir: string;
  frameCount: number;
  fps: number;
}

const HARD_TIMEOUT_MS = 180_000;

/**
 * Wraps a promise with a hard wall-clock timeout.
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
          () =>
            reject(
              new Error(`[personalized-gdocs] ${label} timed out after ${ms}ms`),
            ),
          ms,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Sets `scrollY`; tolerates closed pages. */
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

/** Shoots a single JPEG frame into `framesDir/frame-NNNN.jpg`. */
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
 * Builds a per-frame scrollTop plan (pixels) from a normalised
 * `[{t,y}]` sample list. Same algorithm as `scroll-recorder.ts`:
 * linearly interpolate between the two bracket samples for each output
 * frame's timestamp, clamp [0,1], multiply by maxScroll.
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

/**
 * Downloads, personalises and captures a Google Doc as a JPEG sequence.
 *
 * Behaviour matrix:
 *   - mode = "static-hero":         single shot @ scrollTop=0, replayed N times
 *   - mode = "scroll-recorded" +    interpolated scroll playback over the
 *     non-empty scrollFrames:       rendered document height
 *   - mode = "scroll-recorded" +    behaves as static-hero (defensive)
 *     empty scrollFrames:
 *
 * Hard 90s timeout wraps the entire run. The Page and context are always
 * closed in a `finally`.
 */
export async function renderPersonalizedGDocs(
  opts: RenderGDocsOpts,
): Promise<RenderGDocsResult> {
  const viewport = opts.viewport ?? { width: 1280, height: 720 };
  const fps = opts.fps ?? 30;
  const framesDir = join(opts.outputDir, "frames");
  await mkdir(framesDir, { recursive: true });

  // 1-4. DOCX -> Platzhalter -> LibreOffice/PDF -> Poppler/PNG -> HTML-Stack.
  await mkdir(opts.outputDir, { recursive: true });
  const renderWorkDir = join(opts.outputDir, "gdocs-render");
  const rendered = await renderGDocsToHtml({
    docsUrl: opts.docsUrl,
    vars: opts.vars,
    workDir: renderWorkDir,
    dpi: 150,
  });
  const tempPath = rendered.htmlPath;

  const ctx = await getContext();
  const pageHolder: { current: Page | null } = { current: null };

  const run = async (): Promise<RenderGDocsResult> => {
    const page = await ctx.context.newPage();
    pageHolder.current = page;
    await page.setViewport({
      width: viewport.width,
      height: viewport.height,
      deviceScaleFactor: 1,
    });

    // Google's HTML-Export referenziert googleusercontent.com / fonts.gstatic.com.
    // Wir laden das HTML aus einer file:// URL — externe Resourcen sind reine
    // Wartezeit (oft >2s pro Bild) und blockieren den Per-Frame-Screenshot.
    // Lasse nur file:// + data: durch.
    await page.setRequestInterception(true);
    page.on("request", (req) => {
      const u = req.url();
      if (u.startsWith("file:") || u.startsWith("data:")) {
        req.continue().catch(() => undefined);
      } else {
        req.abort().catch(() => undefined);
      }
    });

    await page.goto(`file://${tempPath}`, {
      waitUntil: "domcontentloaded",
      timeout: 15_000,
    });

    // Inject a clean style override so the doc reads like a printed page
    // rather than the Google export's default white-on-grey background.
    await page
      .evaluate(() => {
        const style = document.createElement("style");
        style.textContent =
          "body{margin:0;background:white;font-family:Arial,sans-serif}";
        document.head.appendChild(style);
      })
      .catch(() => undefined);

    // Let fonts settle. file:// has no network so we don't need to wait for
    // networkidle — a fixed 800ms covers webfont swap-in.
    await new Promise((r) => setTimeout(r, 800));

    // Force overflow:auto and reset scroll so our measurement matches the
    // page that will actually scroll.
    await page
      .evaluate(() => {
        document.documentElement.style.overflow = "auto";
        document.body.style.overflow = "auto";
        (document.documentElement.style as unknown as {
          scrollBehavior: string;
        }).scrollBehavior = "auto";
        (document.body.style as unknown as { scrollBehavior: string }).scrollBehavior =
          "auto";
        window.scrollTo(0, 0);
      })
      .catch(() => undefined);

    // 1) Snapshot der Toolbar (top, 1280 x TOOLBAR_HEIGHT). Toolbar ist
    //    position:fixed, also bleibt sie beim fullPage Screenshot nicht
    //    automatisch oben — wir machen sie separat.
    await scrollPageTo(page, 0);
    const toolbarBuf = (await page.screenshot({
      type: "png",
      clip: {
        x: 0,
        y: 0,
        width: viewport.width,
        height: GDOCS_TOOLBAR_HEIGHT_PX,
      },
      fromSurface: true,
    })) as Buffer;

    // 2) Snapshot des Doc-Bereichs OHNE Toolbar. Wir entfernen die
    //    fixed Toolbar VOLLSTÄNDIG aus dem DOM (nicht display:none — das
    //    hatte in der Praxis Race-Conditions mit dem fullPage-Reflow, so
    //    dass die Toolbar im docPngBuf landete und im Video als zweite,
    //    scrollende Toolbar sichtbar wurde) und neutralisieren alle
    //    Layout-Reservierungen (Body-Padding, min-height, doc-stack
    //    margin-top), damit der fullPage-Screenshot pixelgenau bei y=0
    //    mit der ersten Doc-Page beginnt.
    await page.evaluate(
      (toolbarHeight: number) => {
        const bar = document.querySelector(".gd-toolbar");
        if (bar && bar.parentNode) bar.parentNode.removeChild(bar);

        // Body-Layout neutralisieren. Wir setzen Inline-Styles mit
        // setProperty(..., "important"), damit kein Cascade-Regel das
        // wieder zurückdreht.
        const body = document.body;
        body.style.setProperty("padding-top", "0", "important");
        body.style.setProperty("padding-bottom", "0", "important");
        body.style.setProperty("margin", "0", "important");
        body.style.setProperty("min-height", "0", "important");

        // doc-stack margin-top auf 0 — sonst hat der docPngBuf oben 24px
        // grauen Bereich, der beim Cropping als "leerer Vorlauf" auftaucht.
        const stack = document.querySelector(".gd-doc-stack") as
          | HTMLElement
          | null;
        if (stack) {
          stack.style.setProperty("margin-top", "0", "important");
          stack.style.setProperty("margin-bottom", "0", "important");
        }
        // Avoid using the toolbar height — we removed the toolbar entirely.
        void toolbarHeight;

        document.documentElement.scrollTop = 0;
        document.body.scrollTop = 0;
        window.scrollTo(0, 0);
      },
      GDOCS_TOOLBAR_HEIGHT_PX,
    );

    // Zwei rAFs warten — der erste schickt unseren Style-Reset durch den
    // Layout-Cycle, der zweite stellt sicher, dass die Compositor-Pass
    // abgeschlossen ist, bevor Puppeteer den fullPage-Snapshot triggert
    // (was intern den Viewport auf scrollHeight resized — wenn scrollHeight
    // hier noch den alten Wert liefert, klebt die Toolbar im PNG).
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

    // Echte Pixel-Dimensionen des Doc-Screenshots auslesen.
    const docMeta = await sharp(docPngBuf).metadata();
    const docPixelWidth = docMeta.width ?? viewport.width;
    const docPixelHeight = docMeta.height ?? viewport.height;

    // Der Modal hat im iframe einen scrollbaren Bereich
    // (clientHeight = viewport.height - TOOLBAR), gleichgesinnt:
    //   ratio = scrollTop / (scrollHeight - clientHeight)
    // Hier ist scrollHeight = docPixelHeight, clientHeight = (viewport.height - TOOLBAR).
    const docVisibleH = Math.max(1, viewport.height - GDOCS_TOOLBAR_HEIGHT_PX);
    const maxScroll = Math.max(0, docPixelHeight - docVisibleH);

    const frameIntervalMs = 1000 / fps;
    const totalFrames = Math.max(
      1,
      Math.ceil(opts.durationMs / frameIntervalMs),
    );

    const hasFrames =
      opts.mode === "scroll-recorded" &&
      Array.isArray(opts.scrollFrames) &&
      opts.scrollFrames.length > 0;

    // Hilfs-Composer: nimmt einen Doc-Y-Offset und schreibt einen JPG-Frame.
    const writeFrame = async (i: number, scrollY: number) => {
      const clampedY = Math.max(0, Math.min(maxScroll, Math.round(scrollY)));
      const cropHeight = Math.min(docVisibleH, docPixelHeight - clampedY);
      // Wenn Doc kürzer als visible-area: weiß auffüllen darunter.
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
          background: { r: 241, g: 243, b: 244 }, // gd-bg
        },
      })
        .composite([
          { input: toolbarBuf, top: 0, left: 0 },
          { input: docCrop, top: GDOCS_TOOLBAR_HEIGHT_PX, left: 0 },
        ])
        .jpeg({ quality: 80 })
        .toBuffer();
      const frameName = `frame-${String(i).padStart(4, "0")}.jpg`;
      await writeFile(join(framesDir, frameName), frameBuf);
    };

    if (opts.mode === "static-hero" || maxScroll === 0 || !hasFrames) {
      // Static-Variante: 1 Frame komponieren, N-mal speichern.
      await writeFrame(0, 0);
      const firstPath = join(framesDir, "frame-0000.jpg");
      const firstBuf = await sharp(firstPath).toBuffer();
      for (let i = 1; i < totalFrames; i++) {
        const frameName = `frame-${String(i).padStart(4, "0")}.jpg`;
        await writeFile(join(framesDir, frameName), firstBuf);
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
      `[personalized-gdocs] sharp-render N=${opts.scrollFrames!.length} frames, maxScroll=${maxScroll}, totalFrames=${totalFrames}, docPixelHeight=${docPixelHeight}`,
    );

    const plan = buildScrollPlanFromFrames(
      opts.scrollFrames as ScrollFrame[],
      totalFrames,
      maxScroll,
      fps,
    );

    // Parallel batches damit sharp mehrere Frames gleichzeitig generieren
    // kann. Concurrency 4 ist ein guter Trade-off — sharp ist multi-thread,
    // aber wir wollen die Memory-Spitze begrenzen.
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
      `[personalized-gdocs] sharp-render done in ${Date.now() - captureStart}ms (${totalFrames} frames)`,
    );

    return {
      durationSec: opts.durationMs / 1000,
      framesDir,
      frameCount: totalFrames,
      fps,
    };
  };

  try {
    return await withTimeout(run(), HARD_TIMEOUT_MS, "renderPersonalizedGDocs");
  } finally {
    if (pageHolder.current) {
      await pageHolder.current.close().catch(() => undefined);
    }
    await ctx.close();
    // Best-effort: PNG-Pages + Temp-Files entfernen. Falls jemand
    // outputDir noch braucht (frames/), behalten wir den Parent — wir
    // putzen nur den gdocs-render-Unterordner.
    await cleanupRenderedGDocs(rendered.workDir);
  }
}
