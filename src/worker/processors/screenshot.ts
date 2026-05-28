/**
 * Screenshot processor.
 *
 * Drives a headless Chromium page to capture a fullPage JPEG of an arbitrary
 * URL (typically Google Docs or a website hero) and uploads the result to
 * Bunny Storage under `screenshots/<jobId>.jpg`.
 *
 * The Next.js API enqueues `ScreenshotJobData` jobs on the `screenshot`
 * BullMQ queue; this processor handles them. Status + result are stashed in
 * Redis under the key `screenshot:<jobId>` (hash) with a 30-minute TTL so
 * stale records don't pile up.
 *
 * Special handling:
 *   - Google Docs URLs (`docs.google.com`) are rewritten to `/preview` so
 *     the editor chrome is hidden; we also wait briefly for the `.kix-page`
 *     content selector before measuring/shooting.
 *   - Cookie banners are dismissed (best effort) so the captured hero is
 *     clean.
 *
 * Failure modes:
 *   - URL invalid / unreachable     → status = "failed", error = message
 *   - page.goto timeout             → status = "failed"
 *   - Upload to Bunny fails         → status = "failed"
 *   - Anything else thrown          → status = "failed"
 */

import type { Job } from "bullmq";
import type { Page } from "puppeteer-core";
import { uploadFile } from "@/lib/bunny/storage";
import { getContext } from "../lib/browser-pool";
import { dismissCookieBanners } from "../lib/cookie-dismiss";
import {
  getScreenshotJobRedisKey,
  SCREENSHOT_REDIS_TTL_SECONDS,
  type ScreenshotJobData,
} from "../screenshot-queue";
import { getRedisConnection } from "../queue";

export type { ScreenshotJobData };

const GOTO_TIMEOUT_MS = 30_000;
const VIEWPORT = { width: 1280, height: 800 };

/**
 * Detects Google-Docs URLs and rewrites them to the public `/preview` view
 * which has no editor toolbars or sidebars — perfect for a clean capture.
 *
 * Handles common shapes:
 *   - …/document/d/<id>/edit?…   → …/document/d/<id>/preview
 *   - …/document/d/<id>/edit     → …/document/d/<id>/preview
 *   - …/document/d/<id>          → …/document/d/<id>/preview
 *   - …/document/d/<id>/view…    → …/document/d/<id>/preview
 *
 * Returns the original URL unchanged for any non-docs.google.com host.
 */
function rewriteGoogleDocsUrl(input: string): string {
  let parsed: URL;
  try {
    parsed = new URL(input);
  } catch {
    return input;
  }
  if (parsed.hostname !== "docs.google.com") return input;

  // Strip trailing slash for predictable matching.
  let path = parsed.pathname.replace(/\/+$/, "");
  // Replace whatever sits after /d/<id> with /preview.
  path = path.replace(
    /(\/document\/d\/[^/]+)(?:\/(?:edit|view|preview)(?:[/?#].*)?)?$/i,
    "$1/preview",
  );
  parsed.pathname = path;
  // Preview view does not need any query params.
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString();
}

/** Best-effort: wait for the Google-Docs `.kix-page` selector. */
async function waitForKixPages(page: Page): Promise<void> {
  try {
    await page.waitForSelector(".kix-page, .kix-page-content-wrap", {
      timeout: 5_000,
    });
  } catch {
    // Fall through — we'll still take whatever rendered.
  }
}

/**
 * Stores the job's result back in Redis under `screenshot:<jobId>`.
 */
async function writeJobResult(
  jobId: string,
  fields: {
    status: "pending" | "running" | "done" | "failed";
    imageUrl?: string;
    width?: number;
    height?: number;
    error?: string;
  },
): Promise<void> {
  const redis = getRedisConnection();
  const key = getScreenshotJobRedisKey(jobId);
  const payload: Record<string, string> = { status: fields.status };
  if (fields.imageUrl !== undefined) payload.imageUrl = fields.imageUrl;
  if (fields.width !== undefined) payload.width = String(fields.width);
  if (fields.height !== undefined) payload.height = String(fields.height);
  if (fields.error !== undefined) payload.error = fields.error;
  await redis.hset(key, payload);
  await redis.expire(key, SCREENSHOT_REDIS_TTL_SECONDS);
}

/**
 * Processes a single screenshot job. Always writes a terminal Redis state
 * (`done` or `failed`) before returning / throwing so the GET endpoint
 * never hangs in `running`.
 */
export async function screenshotProcessor(
  job: Job<ScreenshotJobData>,
): Promise<{ imageUrl: string; width: number; height: number }> {
  const { jobId, url } = job.data;

  await writeJobResult(jobId, { status: "running" });

  const ctx = await getContext();
  const pageHolder: { current: Page | null } = { current: null };

  try {
    const page = await ctx.context.newPage();
    pageHolder.current = page;
    await page.setViewport({
      width: VIEWPORT.width,
      height: VIEWPORT.height,
      deviceScaleFactor: 1,
    });

    const targetUrl = rewriteGoogleDocsUrl(url);
    const isGoogleDocs = (() => {
      try {
        return new URL(targetUrl).hostname === "docs.google.com";
      } catch {
        return false;
      }
    })();

    // Navigate with progressively cheaper waitUntil signals so trackers
    // don't kill the capture.
    try {
      await page.goto(targetUrl, {
        waitUntil: "networkidle2",
        timeout: GOTO_TIMEOUT_MS,
      });
    } catch (e) {
      try {
        await page.goto(targetUrl, {
          waitUntil: "domcontentloaded",
          timeout: 10_000,
        });
      } catch {
        throw e instanceof Error ? e : new Error(String(e));
      }
    }

    // Let CSS / hero-images settle.
    await new Promise((r) => setTimeout(r, 1_000));

    await dismissCookieBanners(page, 3_000).catch(() => false);

    if (isGoogleDocs) {
      await waitForKixPages(page);
    }

    // Force overflow auto so we can measure the real document height.
    await page
      .evaluate(() => {
        document.documentElement.style.overflow = "auto";
        document.body.style.overflow = "auto";
        window.scrollTo(0, 0);
      })
      .catch(() => undefined);

    const docHeight: number = await page.evaluate(
      () => document.documentElement.scrollHeight,
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

    return { imageUrl: upload.url, width: VIEWPORT.width, height };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await writeJobResult(jobId, { status: "failed", error: message }).catch(
      () => undefined,
    );
    throw err instanceof Error ? err : new Error(message);
  } finally {
    if (pageHolder.current) {
      await pageHolder.current.close().catch(() => undefined);
    }
    await ctx.close();
  }
}
