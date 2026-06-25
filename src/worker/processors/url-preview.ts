/**
 * Processor fuer URL-Mediathek-Preview-Jobs.
 *
 * Strategie pro Typ:
 *   - gdoc / gsheet / gslides / gform / gdrive_file
 *       Versuch: Google-Thumbnail-API (`docs.google.com/.../export?format=...`
 *       liefert PDF, daraus rastern wir die erste Seite — vermeidet Puppeteer-
 *       Login-Probleme). Wenn das fehlschlaegt → Puppeteer-Screenshot des
 *       Public-Doc-Views.
 *   - youtube
 *       `i.ytimg.com/vi/<id>/hqdefault.jpg` — direkt fetchen, kein Puppeteer.
 *   - generic
 *       Puppeteer-Screenshot.
 *
 * Preview-Output: JPEG, 1280x800, q=78. Upload zu Bunny PDF-Zone unter
 * `url-previews/<userId>/<mediaUrlId>.jpg`.
 *
 * Stale-TTL:
 *   - Google* / generic: 7 Tage (Content kann sich aendern)
 *   - YouTube: 30 Tage (Thumbnail stabil)
 *
 * SSRF: vor der Navigation prueft `assertUrlIsSafe()` nochmal — User koennte
 * die URL nach dem Save geaendert haben (TOCTOU), oder DNS-Rebinding versucht.
 */

import type { Job } from "bullmq";
import sharp from "sharp";
import type { Page } from "puppeteer-core";
import { uploadFile } from "@/lib/bunny/storage";
import { assertUrlIsSafe, SsrfBlockedError } from "@/lib/media-urls/ssrf-guard";
import { updateMediaUrlPreview } from "@/lib/media-urls/repo";
import type { UrlPreviewJob } from "../url-preview-queue";
import { getContext } from "../lib/browser-pool";

const PREVIEW_WIDTH = 1280;
const PREVIEW_HEIGHT = 800;
const JPEG_QUALITY = 78;
const NAV_TIMEOUT_MS = 15_000;
const POST_LOAD_DELAY_MS = 800;

const STALE_TTL_DAYS_GOOGLE = 7;
const STALE_TTL_DAYS_YOUTUBE = 30;
const STALE_TTL_DAYS_GENERIC = 7;

function staleTtlDays(type: string): number {
  if (type === "youtube") return STALE_TTL_DAYS_YOUTUBE;
  if (type.startsWith("g")) return STALE_TTL_DAYS_GOOGLE;
  return STALE_TTL_DAYS_GENERIC;
}

async function fetchAsBuffer(url: string): Promise<Buffer | null> {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(10_000),
      redirect: "follow",
    });
    if (!res.ok) return null;
    const ab = await res.arrayBuffer();
    return Buffer.from(ab);
  } catch {
    return null;
  }
}

/**
 * YouTube-Thumbnail-URL (oeffentlich, keine Auth noetig).
 */
function youtubeThumbUrl(videoId: string): string {
  return `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
}

/**
 * Versucht ein Bunny-fertiges JPEG-Buffer zu erzeugen. Liefert NULL wenn
 * die Quelle nicht erreichbar war — Caller faellt dann auf Puppeteer zurueck.
 */
async function tryDirectPreview(
  type: string,
  externalResourceId: string | null,
): Promise<Buffer | null> {
  if (type === "youtube" && externalResourceId) {
    const raw = await fetchAsBuffer(youtubeThumbUrl(externalResourceId));
    if (!raw) return null;
    return sharp(raw)
      .resize(PREVIEW_WIDTH, PREVIEW_HEIGHT, {
        fit: "cover",
        position: "center",
      })
      .jpeg({ quality: JPEG_QUALITY })
      .toBuffer();
  }
  return null;
}

/**
 * Puppeteer-Fallback: rendert die Public-Page in einem headless Chromium
 * und macht einen 1280x800-Screenshot.
 *
 * Erkennt Google-Login-Walls per URL-Suffix `/u/0/`-Redirect oder
 * dem `accounts.google.com`-Host und gibt `null` zurueck — dann markiert
 * der Caller den Preview als `private`.
 */
async function puppeteerScreenshot(url: string): Promise<Buffer | "private" | null> {
  const ctx = await getContext();
  let page: Page | null = null;
  try {
    page = await ctx.context.newPage();
    await page.setViewport({
      width: PREVIEW_WIDTH,
      height: PREVIEW_HEIGHT,
      deviceScaleFactor: 1,
    });
    let response;
    try {
      response = await page.goto(url, {
        waitUntil: "networkidle2",
        timeout: NAV_TIMEOUT_MS,
      });
    } catch {
      return null;
    }
    const finalUrl = page.url();
    if (
      finalUrl.includes("accounts.google.com") ||
      finalUrl.includes("/ServiceLogin") ||
      finalUrl.includes("/signin")
    ) {
      return "private";
    }
    if (response && response.status() >= 400) return null;

    await new Promise((r) => setTimeout(r, POST_LOAD_DELAY_MS));

    const png = (await page.screenshot({
      type: "png",
      clip: { x: 0, y: 0, width: PREVIEW_WIDTH, height: PREVIEW_HEIGHT },
    })) as Buffer;

    return sharp(png).jpeg({ quality: JPEG_QUALITY }).toBuffer();
  } catch {
    return null;
  } finally {
    if (page) await page.close().catch(() => undefined);
  }
}

export async function processUrlPreviewJob(
  job: Job<UrlPreviewJob>,
): Promise<{ status: "ready" | "private" | "error" }> {
  const { mediaUrlId, userId, url, type } = job.data;

  // SSRF re-check (TOCTOU defense, DNS-Rebinding).
  try {
    await assertUrlIsSafe(url);
  } catch (err) {
    const msg = err instanceof SsrfBlockedError ? err.reason : String(err);
    await updateMediaUrlPreview(mediaUrlId, {
      previewStatus: "error",
      lastError: `SSRF-Guard: ${msg}`,
    });
    return { status: "error" };
  }

  // 1. Direct-Preview-Path versuchen (YouTube).
  const externalResourceId = extractResourceIdFromUrl(url, type);
  let jpeg: Buffer | null | "private" = null;
  jpeg = await tryDirectPreview(type, externalResourceId);

  // 2. Puppeteer-Fallback.
  if (!jpeg) {
    jpeg = await puppeteerScreenshot(url);
  }

  if (jpeg === "private") {
    await updateMediaUrlPreview(mediaUrlId, {
      previewStatus: "private",
      lastError: "Privater Link — keine Vorschau ohne Login moeglich.",
    });
    return { status: "private" };
  }
  if (!jpeg) {
    await updateMediaUrlPreview(mediaUrlId, {
      previewStatus: "error",
      lastError: "Preview-Generation fehlgeschlagen (HTTP/Timeout).",
    });
    return { status: "error" };
  }

  // 3. Upload zu Bunny.
  const remotePath = `url-previews/${userId}/${mediaUrlId}.jpg`;
  const uploaded = await uploadFile({
    buffer: jpeg as Buffer,
    remotePath,
    contentType: "image/jpeg",
  });

  const now = new Date();
  const expires = new Date(now.getTime() + staleTtlDays(type) * 86_400_000);

  await updateMediaUrlPreview(mediaUrlId, {
    previewBunnyPath: uploaded.remotePath,
    // Cache-Busting via Timestamp-Query — Bunny serviert die neue Version
    // sofort, statt 30-Tage-CDN-Cache zu warten.
    previewUrl: `${uploaded.url}?v=${now.getTime()}`,
    previewStatus: "ready",
    previewGeneratedAt: now,
    previewExpiresAt: expires,
    lastError: null,
  });

  return { status: "ready" };
}

/**
 * Extrahiert die Google-Doc-ID / YouTube-Video-ID aus der URL. Klein,
 * duplicated mit detect-type.ts — bewusst, weil dieser Worker eine
 * eigenstaendige Stage ist.
 */
function extractResourceIdFromUrl(url: string, type: string): string | null {
  const patterns: Record<string, RegExp> = {
    gdoc: /docs\.google\.com\/document\/d\/([a-zA-Z0-9_-]+)/i,
    gsheet: /docs\.google\.com\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/i,
    gslides: /docs\.google\.com\/presentation\/d\/([a-zA-Z0-9_-]+)/i,
    gform: /docs\.google\.com\/forms\/d\/([a-zA-Z0-9_-]+)/i,
    gdrive_file: /drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)/i,
    youtube: /(?:youtube\.com\/watch\?v=|youtu\.be\/)([A-Za-z0-9_-]{11})/i,
  };
  const re = patterns[type];
  if (!re) return null;
  return url.match(re)?.[1] ?? null;
}
