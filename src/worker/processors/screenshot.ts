/**
 * Screenshot processor.
 *
 * Two flows, branched by URL host:
 *
 *   1) Google-Docs URLs (`docs.google.com`)
 *      The DOCX is fetched, converted to PDF via LibreOffice, rasterised to
 *      page PNGs via Poppler, and all artefacts (page-N.png + preview.html
 *      that wraps them in a pixel-perfect Google-Docs chrome) are uploaded
 *      to Bunny under `screenshots/<jobId>/`. The Modal can then load the
 *      preview.html in an iframe and scroll it 1:1 like the final video
 *      render does. We never run puppeteer for the gdocs path.
 *      The result is written to Redis as:
 *        previewUrl, pageImageUrls (JSON array), docWidth, docHeight,
 *        pageCount.
 *
 *   2) Website URLs
 *      A headless Chromium page captures a fullPage JPEG and uploads it to
 *      `screenshots/<jobId>.jpg`. Cookie banners are dismissed best-effort.
 *      Result written to Redis as: imageUrl, width, height.
 *
 * Status hash is `screenshot:<jobId>` with a 30-minute TTL.
 *
 * Failure modes (both flows):
 *   - URL invalid / unreachable     → status = "failed", error = message
 *   - page.goto / pipeline timeout  → status = "failed"
 *   - Upload to Bunny fails         → status = "failed"
 *   - Anything else thrown          → status = "failed"
 */

import type { Job } from "bullmq";
import type { Page } from "puppeteer-core";
import { uploadFile } from "@/lib/bunny/storage";
import { getContext } from "../lib/browser-pool";
import {
  prepareCleanPage,
  acquireHostSlot,
  RenderNotReadyError,
  type CleanPageSession,
} from "../lib/clean-render";
import { renderGDocsToBunnyHostedHtml } from "../lib/gdocs-render-pipeline";
import {
  getScreenshotJobRedisKey,
  SCREENSHOT_REDIS_TTL_SECONDS,
  type ScreenshotJobData,
} from "../screenshot-queue";
import { getRedisConnection } from "../queue";
import { assertUrlIsSafe } from "@/lib/media-urls/ssrf-guard";

export type { ScreenshotJobData };

const GOTO_TIMEOUT_MS = 30_000;
const VIEWPORT = { width: 1280, height: 800 };

/**
 * Stores the job's result back in Redis under `screenshot:<jobId>`.
 *
 * Two flavours of result:
 *   - Website screenshot:  imageUrl + width + height (legacy JPG path).
 *   - Google-Docs HTML:    previewUrl + pageImageUrls + docWidth/docHeight
 *                          + pageCount (Bunny-hosted iframe-ready bundle).
 */
async function writeJobResult(
  jobId: string,
  fields: {
    status: "pending" | "running" | "done" | "failed";
    imageUrl?: string;
    width?: number;
    height?: number;
    error?: string;
    previewUrl?: string;
    pageImageUrls?: string;
    docWidth?: number;
    docHeight?: number;
    pageCount?: number;
  },
): Promise<void> {
  const redis = getRedisConnection();
  const key = getScreenshotJobRedisKey(jobId);
  const payload: Record<string, string> = { status: fields.status };
  if (fields.imageUrl !== undefined) payload.imageUrl = fields.imageUrl;
  if (fields.width !== undefined) payload.width = String(fields.width);
  if (fields.height !== undefined) payload.height = String(fields.height);
  if (fields.error !== undefined) payload.error = fields.error;
  if (fields.previewUrl !== undefined) payload.previewUrl = fields.previewUrl;
  if (fields.pageImageUrls !== undefined)
    payload.pageImageUrls = fields.pageImageUrls;
  if (fields.docWidth !== undefined) payload.docWidth = String(fields.docWidth);
  if (fields.docHeight !== undefined)
    payload.docHeight = String(fields.docHeight);
  if (fields.pageCount !== undefined)
    payload.pageCount = String(fields.pageCount);
  await redis.hset(key, payload);
  await redis.expire(key, SCREENSHOT_REDIS_TTL_SECONDS);
}

/**
 * Processes a single screenshot job. Always writes a terminal Redis state
 * (`done` or `failed`) before returning / throwing so the GET endpoint
 * never hangs in `running`.
 *
 * Branches by source:
 *   - Google-Docs URL → DOCX→PDF→PNGs uploaded to Bunny + HTML wrapper
 *     hosted on Bunny so the Modal can load it via iframe. No puppeteer
 *     involved; the doc dimensions come from the PNG headers.
 *   - Anything else  → live page capture via puppeteer, JPG to Bunny.
 */
export async function screenshotProcessor(
  job: Job<ScreenshotJobData>,
): Promise<{ imageUrl: string; width: number; height: number }> {
  const { jobId, url } = job.data;

  await writeJobResult(jobId, { status: "running" });

  const isGoogleDocs = (() => {
    try {
      return new URL(url).hostname === "docs.google.com";
    } catch {
      return false;
    }
  })();

  // ---------------------------------------------------------------------
  // Google-Docs path: render to Bunny-hosted HTML + page PNGs.
  // ---------------------------------------------------------------------
  if (isGoogleDocs) {
    try {
      const result = await renderGDocsToBunnyHostedHtml({
        docsUrl: url,
        storagePrefix: `screenshots/${jobId}`,
        dpi: 150,
      });

      await writeJobResult(jobId, {
        status: "done",
        previewUrl: result.htmlUrl,
        pageImageUrls: JSON.stringify(result.pageUrls),
        docWidth: result.docWidth,
        docHeight: result.docHeight,
        pageCount: result.pageCount,
      });

      // The legacy return shape expects an imageUrl/width/height triple —
      // we surface the HTML preview URL and the computed doc dims so any
      // existing caller that introspects the return value gets a usable
      // (if non-image) hint.
      return {
        imageUrl: result.htmlUrl,
        width: result.docWidth,
        height: result.docHeight,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await writeJobResult(jobId, { status: "failed", error: message }).catch(
        () => undefined,
      );
      throw err instanceof Error ? err : new Error(message);
    }
  }

  // ---------------------------------------------------------------------
  // Website path (unchanged): puppeteer fullPage JPG.
  // ---------------------------------------------------------------------
  const ctx = await getContext();
  const pageHolder: { current: Page | null } = { current: null };
  const cleanupHolder: {
    releaseSlot: (() => void) | null;
    clean: CleanPageSession | null;
  } = { releaseSlot: null, clean: null };
  let captureOk = false;
  let captureProblem: string | null = null;

  try {
    // Host-Throttle: max. 2 parallele Loads pro Host (Schicht 4b).
    cleanupHolder.releaseSlot = await acquireHostSlot(url);

    const page = await ctx.context.newPage();
    pageHolder.current = page;
    await page.setViewport({
      width: VIEWPORT.width,
      height: VIEWPORT.height,
      deviceScaleFactor: 1,
    });

    // SECURITY: URL aus Kundendaten — interne Netze blocken (SSRF).
    await assertUrlIsSafe(url);

    // Clean-Render Schicht 0+1: Adblocker + Consent-Preseed VOR goto.
    const clean = await prepareCleanPage(page, url);
    cleanupHolder.clean = clean;

    try {
      await page.goto(url, {
        waitUntil: "networkidle2",
        timeout: GOTO_TIMEOUT_MS,
      });
    } catch (e) {
      try {
        await page.goto(url, {
          waitUntil: "domcontentloaded",
          timeout: 10_000,
        });
      } catch {
        throw e instanceof Error ? e : new Error(String(e));
      }
    }
    await new Promise((r) => setTimeout(r, 1_000));

    // Clean-Render Schicht 2–4: Dismiss + QA-Gate. Watchdog überspringen —
    // gleich nach dem Screenshot ist Schluss. RenderNotReadyError propagiert
    // (Fehlerseiten-Screenshot wäre für den Preflight irreführend).
    try {
      await clean.stabilize({ dismissTimeoutMs: 3_000, skipWatchdog: true });
    } catch (err) {
      if (err instanceof RenderNotReadyError) throw err;
      // Sonstige stabilize-Fehler nie fatal.
    }

    // Force overflow auto so we can measure the real document height.
    await page
      .evaluate(() => {
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
    const height = Math.max(VIEWPORT.height, Math.floor(docHeight));

    const buf = (await page.screenshot({
      type: "jpeg",
      quality: 85,
      fullPage: true,
    })) as Buffer;

    const remotePath = `screenshots/${jobId}.jpg`;
    const upload = await uploadFile({
      buffer: buf,
      remotePath,
      contentType: "image/jpeg",
    });

    await writeJobResult(jobId, {
      status: "done",
      imageUrl: upload.url,
      width: VIEWPORT.width,
      height,
    });

    captureOk = true;
    return { imageUrl: upload.url, width: VIEWPORT.width, height };
  } catch (err) {
    captureProblem =
      err instanceof RenderNotReadyError ? err.problem : "capture_error";
    const message = err instanceof Error ? err.message : String(err);
    await writeJobResult(jobId, { status: "failed", error: message }).catch(
      () => undefined,
    );
    throw err instanceof Error ? err : new Error(message);
  } finally {
    // Telemetrie + Adblock-Disable (Schicht 5).
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
