/**
 * Puppeteer browser pool.
 *
 * We keep ONE Chromium process for the lifetime of the worker, and hand out
 * a fresh incognito BrowserContext per lead. This avoids paying the launch
 * cost (~1-2s) per render while still isolating cookies/storage between
 * leads.
 *
 * If the browser dies (crash, OOM, SIGKILL) we transparently re-launch on
 * the next `getContext()` call.
 */

import puppeteer, {
  type Browser,
  type BrowserContext,
} from "puppeteer-core";

let browserPromise: Promise<Browser> | null = null;

function chromiumPath(): string {
  // The worker Dockerfile installs `chromium` (not `chromium-browser`) and
  // sets CHROMIUM_PATH=/usr/bin/chromium. Keep `/usr/bin/chromium` as the
  // default so local dev on Debian / Ubuntu container shells matches.
  return process.env.CHROMIUM_PATH ?? "/usr/bin/chromium";
}

async function launchBrowser(): Promise<Browser> {
  const browser = await puppeteer.launch({
    executablePath: chromiumPath(),
    headless: true,
    args: [
      // Hardening + Docker compatibility. NOTE: we intentionally omit
      // `--single-process` / `--no-zygote` from the previous flag-set —
      // they regress stability on long-running worker processes and break
      // some scroll animations on heavy pages.
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--disable-extensions",
      "--hide-scrollbars",
      "--disable-features=TranslateUI",
    ],
    // Default viewport; can be overridden per-page.
    defaultViewport: { width: 1280, height: 720, deviceScaleFactor: 1 },
  });

  browser.on("disconnected", () => {
    // eslint-disable-next-line no-console
    console.warn("[worker:browser] disconnected. Will relaunch on next use.");
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

export interface PooledContext {
  context: BrowserContext;
  close: () => Promise<void>;
}

/**
 * Acquires a fresh incognito context. The returned `close()` must be
 * called once the caller is done — it tears down the context (NOT the
 * browser itself).
 */
export async function getContext(): Promise<PooledContext> {
  const browser = await getBrowser();
  const context = await browser.createBrowserContext();
  return {
    context,
    close: async () => {
      try {
        await context.close();
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn("[worker:browser] context close failed:", err);
      }
    },
  };
}

/**
 * Shuts the shared browser down. Called from the worker's graceful
 * shutdown handler.
 */
export async function closeBrowserPool(): Promise<void> {
  if (!browserPromise) return;
  try {
    const browser = await browserPromise;
    await browser.close();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[worker:browser] shutdown failed:", err);
  } finally {
    browserPromise = null;
  }
}
