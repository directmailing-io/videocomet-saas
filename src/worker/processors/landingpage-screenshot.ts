/**
 * Pipeline-Stage `landingpageScreenshot` — Paket B.
 *
 * Dritter Thumbnail-Modus neben "frame" (Video-Frame-Extract) und
 * "custom_image" (Slide-artiger Thumbnail-Generator, Paket D). Wenn der User
 * `campaign.thumbnailMode === 'landingpage_screenshot'` waehlt, laden wir die
 * LIVE-Landingpage des Leads in einem Headless-Browser und legen einen
 * 1280×720-PNG-Screenshot davon als per-Lead-Thumbnail an
 * (`leads.customThumbnailUrl`). Der PDF-Brief (`docx-modify`) konsumiert das
 * Bild ueber die bestehende Fallback-Chain (customThumbnailUrl >
 * sharedThumbnailUrl > Frame-JPG).
 *
 * Smart-Cache:
 *   Kein Cross-Lead-Sharing — die LP enthaelt Lead-spezifische Daten
 *   (Name, Anrede, etc.). Anders als `thumbnailGenerate` im shared-Modus
 *   gibt es hier nur den per-Lead-Pfad.
 *
 * Preview-Modus:
 *   Wir haengen `?preview=1` an die URL, damit das LP-Tracking-Init im
 *   Browser sich abschaltet (siehe `src/app/lp-block/[slug]/tracker-init.tsx`)
 *   und kein "Aufruf" registriert wird, der die Analytics-Zahlen verfaelscht.
 *   Die normale Lead-Daten-Hydrierung bleibt unveraendert.
 *
 * Bunny-Zone & Pfad:
 *   Storage-Zone identisch zu `thumbnailGenerate` (Default-Zone
 *   `videocomet-pdf`). Remote-Pfad: `thumbnails/<runId>/<leadId>-lp.png` —
 *   der `-lp`-Suffix verhindert Kollisionen mit dem custom_image-Pfad
 *   (`thumbnails/<runId>/<leadId>.png`), falls beide Modi je auf dem
 *   gleichen Lead landen (z. B. Mode-Toggle waehrend Retry).
 *
 * Error-Handling:
 *   - Navigation-Timeout (10 s)         → RetryableError (BullMQ-Retry)
 *   - HTTP-Status != 2xx                → permanenter Fehler (LP kaputt)
 *   - Sharp-Composite-Fehler            → Upload des Original-PNGs ohne
 *                                         Overlay, Warning loggen, weiter
 *   - Bunny-Upload-Fehler               → bubble-up (Pipeline-Standard)
 */

import { writeFile, readFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { Page } from "puppeteer-core";
import { uploadFile } from "@/lib/bunny/storage";
import { getContext } from "../lib/browser-pool";
import { applyPlayIconOverlay } from "../lib/play-icon-overlay";

/** Standard-Viewport fuer LP-Screenshots — entspricht Thumbnail-Aspect-Ratio. */
const VIEWPORT_WIDTH = 1280;
const VIEWPORT_HEIGHT = 720;

/** Hartes Navigation-Limit. Ueberschreiten → RetryableError. */
const GOTO_TIMEOUT_MS = 10_000;

/** Sicherheits-Wait nach networkidle, fuer lazy geladene Bilder. */
const POST_LOAD_DELAY_MS = 500;

/** Optional: Selektor-Warte, damit erstes Hero-Element steht. */
const SELECTOR_WAIT_MS = 5_000;
const HERO_SELECTORS = "video, iframe, img";

export interface LandingpageScreenshotInput {
  leadId: string;
  userId: string;
  runId: string;
  /**
   * Display-URL des Leads OHNE Protokoll — nur fuer Logging/Display, NICHT
   * fuer die Browser-Navigation (siehe `fullPageUrl`). Wird vom Pipeline-
   * Orchestrator bereits berechnet (Kurzform, ohne `https://`).
   */
  pageUrl: string;
  /**
   * Voll qualifizierte URL mit Protokoll fuer `page.goto`. Wir haengen
   * `?preview=1` intern an (oder `&preview=1`, je nach Vorhandensein eines
   * vorhandenen Query-Strings), damit das LP-Tracking sich abschaltet.
   */
  fullPageUrl: string;
  /** Play-Icon zentriert auf den Screenshot legen (Paket C). */
  playIconOverlay: boolean;
  /** Worker-tmp-Dir; PNG wird hier zwischengelagert. */
  outDir: string;
}

export interface LandingpageScreenshotOutput {
  /** Oeffentliche CDN-URL des hochgeladenen PNGs (`https://<zone>.b-cdn.net/…`). */
  thumbnailUrl: string;
  /** Bunny-Storage-Remote-Pfad (z. B. `thumbnails/<runId>/<leadId>-lp.png`). */
  remotePath: string;
}

/**
 * Markiert einen Fehler so, dass BullMQ den Job mit Backoff retried. Identisches
 * Pattern zu `BunnyEncodingRetryableError` in `wait-for-bunny-encoding.ts`.
 */
class LandingpageScreenshotRetryableError extends Error {
  override name = "RetryableError" as const;
  readonly retryable = true as const;
  constructor(message: string) {
    super(message);
  }
}

/** Haengt `?preview=1` oder `&preview=1` korrekt an die URL an. */
function withPreviewFlag(url: string): string {
  return url.includes("?") ? `${url}&preview=1` : `${url}?preview=1`;
}

/**
 * Rendert die Live-Landingpage in einem Headless-Chromium und liefert die
 * CDN-URL des erzeugten 1280×720-PNGs zurueck. Best-Effort fuer Play-Icon-
 * Overlay (Fallback: Original-PNG ohne Overlay).
 */
export async function runLandingpageScreenshot(
  input: LandingpageScreenshotInput,
): Promise<LandingpageScreenshotOutput> {
  const navUrl = withPreviewFlag(input.fullPageUrl);

  const ctx = await getContext();
  const pageHolder: { current: Page | null } = { current: null };

  // Lokale Tempfiles fuer Screenshot + Overlay-Composite.
  const localPath = join(input.outDir, `lp-thumb-${randomUUID()}.png`);
  const localPathWithOverlay = join(
    input.outDir,
    `lp-thumb-overlay-${randomUUID()}.png`,
  );

  try {
    const page = await ctx.context.newPage();
    pageHolder.current = page;
    await page.setViewport({
      width: VIEWPORT_WIDTH,
      height: VIEWPORT_HEIGHT,
      deviceScaleFactor: 1,
    });

    let response;
    try {
      response = await page.goto(navUrl, {
        waitUntil: "networkidle0",
        timeout: GOTO_TIMEOUT_MS,
      });
    } catch (err) {
      // Navigation-Timeout → BullMQ-Retry mit Backoff. Bei dauerhaft
      // unerreichbarer LP wird der Job nach den konfigurierten Attempts
      // endgueltig failen.
      const msg = err instanceof Error ? err.message : String(err);
      throw new LandingpageScreenshotRetryableError(
        `landingpage navigation timed out for lead=${input.leadId} url=${navUrl}: ${msg}`,
      );
    }

    // HTTP-Status pruefen. 4xx/5xx → LP-Konfig kaputt (z.B. Slug existiert
    // nicht, Custom-LP-Version offline). Kein Retry — Mode-Wahl muss vom
    // User korrigiert werden.
    if (response) {
      const status = response.status();
      if (status >= 400) {
        throw new Error(
          `landingpage HTTP ${status} for lead=${input.leadId} url=${navUrl} — check campaign config (slug, custom-LP version, custom-domain)`,
        );
      }
    }

    // Hero-Element abwarten (Soft-Timeout, ignorierbar). Wenn die LP kein
    // video/iframe/img hat, faellt das einfach durch — networkidle0 oben
    // ist bereits der eigentliche Sync-Punkt.
    await page
      .waitForSelector(HERO_SELECTORS, { timeout: SELECTOR_WAIT_MS })
      .catch(() => undefined);

    // Lazy-Load-Polster — Hero-Bilder etc.
    await new Promise((r) => setTimeout(r, POST_LOAD_DELAY_MS));

    const screenshotBuf = (await page.screenshot({
      type: "png",
      clip: {
        x: 0,
        y: 0,
        width: VIEWPORT_WIDTH,
        height: VIEWPORT_HEIGHT,
      },
    })) as Buffer;

    await writeFile(localPath, screenshotBuf);

    // Optional Play-Icon-Overlay (Paket C). Composite ist Best-Effort: bei
    // Fehlern kopiert `applyPlayIconOverlay` den Input nach Output und
    // loggt eine Warning — kein Throw, Pipeline laeuft weiter.
    let uploadSourcePath = localPath;
    if (input.playIconOverlay) {
      try {
        await applyPlayIconOverlay({
          inputPngPath: localPath,
          outputPngPath: localPathWithOverlay,
          width: VIEWPORT_WIDTH,
          height: VIEWPORT_HEIGHT,
        });
        uploadSourcePath = localPathWithOverlay;
      } catch (err) {
        // Defensiv — `applyPlayIconOverlay` wirft eigentlich nicht, aber wenn
        // doch, fallen wir auf das Original ohne Overlay zurueck.
        console.warn(
          `[landingpage-screenshot] play-icon overlay failed for lead=${input.leadId}; uploading without overlay:`,
          err instanceof Error ? err.message : err,
        );
        uploadSourcePath = localPath;
      }
    }

    const buffer = await readFile(uploadSourcePath);
    const remotePath = `thumbnails/${input.runId}/${input.leadId}-lp.png`;
    const uploaded = await uploadFile({
      buffer,
      remotePath,
      contentType: "image/png",
    });

    return {
      thumbnailUrl: uploaded.url,
      remotePath: uploaded.remotePath,
    };
  } finally {
    if (pageHolder.current) {
      await pageHolder.current.close().catch(() => undefined);
    }
    await ctx.close();
    // Tempfiles raeumen (best-effort).
    await unlink(localPath).catch(() => undefined);
    await unlink(localPathWithOverlay).catch(() => undefined);
  }
}
