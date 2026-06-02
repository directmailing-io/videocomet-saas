/**
 * Light website-screenshot for Phase-1 Preflight.
 *
 * Purpose: produce one 640×360 WebP per Lead at MINIMUM cost so the operator
 * can quickly eyeball the URL in the review grid. This is intentionally NOT
 * the same code path as `video-render.ts` because:
 *
 *   - We don't need a video, only a single frame.
 *   - The viewport is 640×360 (operator-prescribed) not 1280×720.
 *   - We can tolerate a much shorter timeout (~8 s) because slow sites are
 *     already classified by the URL-probe stage.
 *
 * Design decisions:
 *
 *   - **One persistent Chromium per process, new BrowserContext per job.**
 *     Launching Chromium takes 1-2 s; doing that per Lead at concurrency-24
 *     would dominate wall-time and chew RAM. A fresh BrowserContext gives
 *     us cookie/storage isolation between Leads (no `mailing_list_modal=1`
 *     leaking from lead N to lead N+1) without the launch cost.
 *
 *   - **Browser singleton lives in MODULE scope**, not exported via the
 *     existing `browser-pool.ts`. The video-render pool uses defaultViewport
 *     1280×720 plus heavier launch flags; sharing it would either force the
 *     preflight to override on every page or force the render to inherit
 *     our smaller viewport. Two small singletons are simpler than one
 *     parameterised pool.
 *
 *   - **Auto-reconnect on `disconnected`.** Page.crash, OOM, or container-
 *     side SIGKILL of Chromium would otherwise wedge every subsequent job
 *     until process restart.
 */

import puppeteer, {
  type Browser,
  type Page,
} from "puppeteer-core";

const VIEWPORT_WIDTH = 640;
const VIEWPORT_HEIGHT = 360;
// `networkidle2` ist für B2B-Webseiten mit Tracker-Salat (Analytics,
// Hotjar, Chat-Widgets) zu strikt — viele erreichen nie "idle". Wir
// benutzen `domcontentloaded` (Layout ist da) und nehmen den Screenshot
// auch bei Soft-Timeout. Phase 2 (Video-Render) verwendet eigene,
// fortgeschrittenere CDP-Mechanik — Phase 1 muss nur ein gutes Vorschau-
// bild liefern, nicht pixel-perfekt sein.
const GOTO_TIMEOUT_MS = 15_000;
const SETTLE_DELAY_MS = 800;
const SCREENSHOT_QUALITY = 60;

/**
 * Selectors that commonly wrap a cookie / consent banner. We try each in
 * turn AND look for a likely "accept" button INSIDE the container.
 *
 * Kept narrow on purpose: false-positive clicks on a regular CTA button can
 * trigger a full-page navigation which then makes the screenshot useless.
 */
const COOKIE_CONTAINER_SELECTORS: readonly string[] = [
  "[id*=cookie]",
  "[class*=cookie]",
  "[class*=consent]",
  "#onetrust-banner-sdk",
  "#CybotCookiebotDialog",
  "[data-testid*=cookie]",
  '[aria-label*="cookie" i]',
];

let browserPromise: Promise<Browser> | null = null;

function chromiumPath(): string {
  // Matches the same env contract used by `browser-pool.ts`. Worker
  // Dockerfile sets CHROMIUM_PATH=/usr/bin/chromium.
  return process.env.CHROMIUM_PATH ?? "/usr/bin/chromium";
}

async function launchBrowser(): Promise<Browser> {
  const browser = await puppeteer.launch({
    executablePath: chromiumPath(),
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--disable-extensions",
      "--hide-scrollbars",
      "--disable-features=TranslateUI",
    ],
    defaultViewport: {
      width: VIEWPORT_WIDTH,
      height: VIEWPORT_HEIGHT,
      deviceScaleFactor: 1,
    },
  });

  browser.on("disconnected", () => {
    console.warn("[preflight:browser] disconnected — will relaunch on next use");
    browserPromise = null;
  });

  return browser;
}

async function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    browserPromise = launchBrowser().catch((err) => {
      browserPromise = null;
      throw err;
    });
  }
  const browser = await browserPromise;
  if (!browser.connected) {
    browserPromise = null;
    return getBrowser();
  }
  return browser;
}

/**
 * Best-effort cookie-banner dismiss. We swallow ALL errors — a missing
 * banner is the common case and any error here would otherwise stop the
 * actual screenshot.
 *
 * A successful click can trigger a same-page navigation (some CMPs reload
 * the page after consent). We wait 500 ms afterwards so the resulting
 * layout-shift settles before the screenshot.
 */
async function dismissCookieBanner(page: Page): Promise<boolean> {
  try {
    const clicked = await page.evaluate((selectors: readonly string[]) => {
      const acceptTextRe = /accept|akzept|zustimm|ok|verstanden|einverstanden/i;
      for (const sel of selectors) {
        const containers = Array.from(document.querySelectorAll<HTMLElement>(sel));
        for (const container of containers) {
          if (!container.offsetParent && container.offsetHeight === 0) continue;
          const buttons = Array.from(
            container.querySelectorAll<HTMLElement>(
              'button, [role="button"], a[role="button"], input[type="button"], input[type="submit"]',
            ),
          );
          const match = buttons.find((b) => {
            const text = (b.textContent || b.getAttribute("value") || "").trim();
            return acceptTextRe.test(text);
          });
          if (match) {
            match.click();
            return true;
          }
        }
      }
      return false;
    }, COOKIE_CONTAINER_SELECTORS);

    if (clicked) {
      // Layout-shift settle.
      await new Promise<void>((r) => {
        const t = setTimeout(r, 500);
        t.unref();
      });
    }
    return clicked;
  } catch {
    // Page closed / navigated mid-eval / iframe-scoped CSP — none of these
    // are show-stoppers for the screenshot.
    return false;
  }
}

export interface CaptureLightScreenshotInput {
  url: string;
  signal?: AbortSignal;
}

export interface CaptureLightScreenshotResult {
  webp: Buffer;
  durationMs: number;
}

/**
 * Captures a single 640×360 WebP screenshot of `url`.
 *
 * Error model — throws a `Error` with a stable `message` so the processor
 * can branch on it:
 *   - "screenshot_timeout" : `page.goto` exceeded GOTO_TIMEOUT_MS
 *   - "screenshot_crashed" : the Page or Browser crashed mid-capture
 *   - "screenshot_aborted" : the caller's AbortSignal fired
 * Any other Error indicates an unexpected failure (e.g. Bunny upload
 * helpers reused by callers); the processor maps those to
 * `screenshot_unavailable`.
 *
 * NOTE: the WORKER must hold a reference to the returned Buffer until the
 * Bunny upload completes — there is no on-disk artefact.
 */
export async function captureLightScreenshot(
  input: CaptureLightScreenshotInput,
): Promise<CaptureLightScreenshotResult> {
  const startedAt = Date.now();
  const { url, signal } = input;

  if (signal?.aborted) {
    throw new Error("screenshot_aborted");
  }

  const browser = await getBrowser();
  const context = await browser.createBrowserContext();
  let page: Page | null = null;

  // Hook the caller's AbortSignal onto the page so a job-cancel propagates
  // into the live navigation.
  const onAbort = (): void => {
    void page?.close().catch(() => undefined);
  };
  signal?.addEventListener("abort", onAbort, { once: true });

  try {
    page = await context.newPage();
    await page.setViewport({
      width: VIEWPORT_WIDTH,
      height: VIEWPORT_HEIGHT,
      deviceScaleFactor: 1,
    });

    // Disable cache so adjacent leads don't see stale renders, and ignore
    // background download/upload of giant assets (they don't change the
    // first-paint screenshot anyway).
    await page.setCacheEnabled(false);

    // Track page crashes so we can throw a stable error message.
    let pageCrashed = false;
    page.on("error", () => {
      pageCrashed = true;
    });

    // Navigations-Strategie: wir warten primär auf `domcontentloaded`
    // (Layout ist sichtbar, das reicht für einen Vorschau-Screenshot).
    // Wenn die Seite über das Timeout-Fenster hinaus auflädt, machen wir
    // trotzdem ein Screenshot des aktuellen Zustands — solange die Page
    // nicht gecrasht ist. Damit fangen wir die typischen B2B-Seiten ab,
    // die wegen Trackern nie "networkidle2" erreichen aber visuell
    // längst nutzbar sind.
    let navigationFailed = false;
    try {
      await page.goto(url, {
        waitUntil: "domcontentloaded",
        timeout: GOTO_TIMEOUT_MS,
      });
    } catch (err) {
      if (pageCrashed) {
        throw new Error("screenshot_crashed");
      }
      if (signal?.aborted) {
        throw new Error("screenshot_aborted");
      }
      const message = err instanceof Error ? err.message : String(err);
      const isTimeout =
        err instanceof Error &&
        (err.name === "TimeoutError" || /timeout/i.test(message));
      const isHardNetError =
        /net::ERR_NAME_NOT_RESOLVED|net::ERR_CONNECTION_REFUSED|net::ERR_ABORTED|net::ERR_CERT_/i.test(
          message,
        );
      // Hard-Network-Errors → wir können nichts rendern.
      if (isHardNetError) {
        throw new Error(`screenshot_crashed: ${message}`);
      }
      // Bei Soft-Timeout versuchen wir trotzdem Screenshot zu machen.
      // Wenn dabei nochmal alles failt, bubblen wir den Fehler oben raus.
      if (isTimeout) {
        navigationFailed = true;
      } else {
        throw new Error(`screenshot_crashed: ${message}`);
      }
    }

    if (pageCrashed) {
      throw new Error("screenshot_crashed");
    }

    // Kurze Settle-Pause damit Above-The-Fold-Inhalte rendern können,
    // bevor wir das Bild knipsen.
    await new Promise((r) => setTimeout(r, SETTLE_DELAY_MS));

    await dismissCookieBanner(page);

    // Marker damit `navigationFailed` als "benutzt" markiert wird — auch
    // im Erfolgs-Pfad führt er nur zu Logging, nicht zu einem Throw.
    if (navigationFailed) {
      // eslint-disable-next-line no-console
      console.log("[preflight] soft-timeout, capturing partial render");
    }

    // `fullPage: false` — we ONLY want the 640×360 viewport (per spec).
    // `type: 'webp'` is supported in Chromium 86+; if a future Chromium
    // drops it the worker will throw with a clear message.
    let buf: Buffer;
    try {
      buf = (await page.screenshot({
        type: "webp",
        quality: SCREENSHOT_QUALITY,
        fullPage: false,
      })) as Buffer;
    } catch (err) {
      if (pageCrashed) throw new Error("screenshot_crashed");
      throw new Error(
        `screenshot_crashed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    return { webp: buf, durationMs: Date.now() - startedAt };
  } finally {
    signal?.removeEventListener("abort", onAbort);
    if (page) {
      await page.close().catch(() => undefined);
    }
    await context.close().catch(() => undefined);
  }
}

/**
 * Shuts the preflight browser down. Called from the worker's graceful
 * shutdown handler so a Ctrl+C / SIGTERM doesn't leave a stray Chromium
 * process around.
 */
export async function closePreflightBrowser(): Promise<void> {
  if (!browserPromise) return;
  try {
    const b = await browserPromise;
    await b.close();
  } catch (err) {
    console.warn("[preflight:browser] shutdown failed:", err);
  } finally {
    browserPromise = null;
  }
}
