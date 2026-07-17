import type { Page } from "puppeteer-core";
import { enableAdblock } from "./adblock-engine";
import { preseedConsent } from "./consent-preseed";
import { dismissCookieBanners, type DismissResult } from "./cookie-dismiss";
import { startOverlayWatchdog, type WatchdogHandle } from "./overlay-watchdog";
import {
  assessRenderReadiness,
  RenderNotReadyError,
} from "./render-readiness";
import { recordDomainRenderResult } from "@/lib/db/queries/domain-render-profiles";

export { acquireHostSlot } from "./host-throttle";
export { RenderNotReadyError } from "./render-readiness";

/**
 * Orchestrator des Clean-Render-Systems. Bündelt die fünf Schichten zu zwei
 * Einhängepunkten für die Capture-Pipelines:
 *
 *   const clean = await prepareCleanPage(page, url);   // VOR page.goto()
 *   await page.goto(...); await settle();
 *   await clean.stabilize();                            // statt dismissCookieBanners()
 *   ... Aufnahme ...
 *   await clean.finish(true);                           // Telemetrie + Cleanup
 *
 * Schichten:
 *   0 Consent-Preseed (Cookies/localStorage vor Navigation)
 *   1 Adblocker (EasyList Cookie + Fanboy Annoyance)
 *   2 Dismiss (CMP-APIs → Klick → ESC → Hide)
 *   3 Overlay-Watchdog (läuft während der ganzen Aufnahme)
 *   4 QA-Gate (Fehlerseiten-Detection + 1× Reload-Retry)
 *   5 Telemetrie (domain_render_profiles)
 */

/** Läuft in page.evaluate: Plattform + CMP anhand von Globals/DOM erkennen. */
function detectPlatformAndCmpInPage(): { platform: string; cmp: string } {
  const w = window as unknown as Record<string, any>;
  const html = document.documentElement.outerHTML.slice(0, 200_000);
  const generator =
    document
      .querySelector('meta[name="generator"]')
      ?.getAttribute("content") ?? "";

  let platform = "unknown";
  if (w.Shopify || /cdn\.shopify\.com/.test(html)) platform = "shopify";
  else if (/shopware/i.test(generator) || /\/bundles\/storefront\//.test(html))
    platform = "shopware";
  else if (/wordpress/i.test(generator) || /\/wp-(content|includes)\//.test(html))
    platform = "wordpress";
  else if (w.wixBiSession || /wix\.com/i.test(generator)) platform = "wix";
  else if (document.documentElement.hasAttribute("data-wf-domain") || /webflow/i.test(generator))
    platform = "webflow";
  else if (w.Static?.SQUARESPACE_CONTEXT || /squarespace/i.test(generator))
    platform = "squarespace";
  else if (/hubspot/i.test(generator) || w.hsVars) platform = "hubspot";
  else if (/typo3/i.test(generator)) platform = "typo3";
  else if (/joomla/i.test(generator)) platform = "joomla";
  else if (w.Jimdo || /jimdo/i.test(generator)) platform = "jimdo";

  let cmp = "unknown";
  if (w.Cookiebot) cmp = "cookiebot";
  else if (w.OneTrust || w.OptanonWrapper !== undefined) cmp = "onetrust";
  else if (w.UC_UI || document.getElementById("usercentrics-root"))
    cmp = "usercentrics";
  else if (w.Pandectes || document.getElementById("pandectes-banner"))
    cmp = "pandectes";
  else if (w.CookieFirst) cmp = "cookiefirst";
  else if (w.BorlabsCookie) cmp = "borlabs";
  else if (typeof w.cmplz_accept_all === "function" || w.complianz)
    cmp = "complianz";
  else if (document.querySelector(".cky-consent-container")) cmp = "cookieyes";
  else if (w.klaro) cmp = "klaro";
  else if (w.tarteaucitron) cmp = "tarteaucitron";
  else if (w.Didomi) cmp = "didomi";
  else if (w.Osano) cmp = "osano";
  else if (w._iub) cmp = "iubenda";
  else if (w._sp_ || document.querySelector('[id^="sp_message_container"]'))
    cmp = "sourcepoint";
  else if (document.getElementById("cmpbox")) cmp = "consentmanager";
  else if (document.getElementById("qc-cmp2-container")) cmp = "quantcast";
  else if (document.getElementById("shopify-pc__banner")) cmp = "shopify-native";
  else if (document.getElementById("hs-eu-cookie-confirmation")) cmp = "hubspot";
  else if (typeof w.__tcfapi === "function") cmp = "tcf-unknown";
  else if (
    !document.querySelector(
      '[id*="cookie" i], [class*="cookie" i], [id*="consent" i], [class*="consent" i]',
    )
  )
    cmp = "none";

  return { platform, cmp };
}

export type CleanPageSession = {
  /**
   * Nach goto + settle aufrufen (ersetzt den direkten dismissCookieBanners-
   * Call). Führt Dismiss + QA-Gate (mit 1× Reload-Retry) aus und startet
   * den Overlay-Watchdog. Wirft RenderNotReadyError, wenn die Seite auch
   * nach Reload eine Fehlerseite/Interstitial zeigt.
   */
  stabilize: (opts?: { dismissTimeoutMs?: number; skipWatchdog?: boolean }) => Promise<DismissResult>;
  /**
   * Nach der Aufnahme aufrufen (try/finally): stoppt den Watchdog,
   * deaktiviert den Adblocker und schreibt die Telemetrie.
   */
  finish: (success: boolean, problem?: string | null) => Promise<void>;
};

/**
 * VOR page.goto() aufrufen. Aktiviert Adblocker + Consent-Preseed und gibt
 * die Session für stabilize/finish zurück. Nie throwend.
 */
export async function prepareCleanPage(
  page: Page,
  url: string,
): Promise<CleanPageSession> {
  // tsx/esbuild (keepNames) wrappt innere Funktionen mit einem __name-Helper.
  // Beim Serialisieren via page.evaluate fehlt der im Browser-Context →
  // "__name is not defined". No-op-Shim in jedem Document dieser Page.
  try {
    await page.evaluateOnNewDocument(
      "self.__name = self.__name || function(f){return f};",
    );
  } catch {
    // best-effort
  }

  let disableAdblock: () => Promise<void> = async () => {};
  try {
    disableAdblock = await enableAdblock(page);
  } catch {
    // ohne Blocker weiter
  }
  try {
    await preseedConsent(page, url);
  } catch {
    // ohne Preseed weiter
  }

  let watchdog: WatchdogHandle | null = null;
  let dismiss: DismissResult | null = null;
  let detected = { platform: "unknown", cmp: "unknown" };
  let finished = false;

  const hostname = (() => {
    try {
      return new URL(url).hostname;
    } catch {
      return "";
    }
  })();

  const runDismissAndDetect = async (timeoutMs: number): Promise<void> => {
    dismiss = await dismissCookieBanners(page, timeoutMs);
    try {
      detected = await page.evaluate(detectPlatformAndCmpInPage);
    } catch {
      // Detection ist best-effort
    }
  };

  return {
    stabilize: async (opts) => {
      const timeoutMs = opts?.dismissTimeoutMs ?? 3_000;
      await runDismissAndDetect(timeoutMs);

      // QA-Gate: Fehlerseite/Interstitial? → 1× Reload mit Backoff.
      let readiness = await assessRenderReadiness(page);
      if (!readiness.ok) {
        console.warn(
          `[clean-render] ${hostname}: not ready (${readiness.problem}) — reloading once: ${readiness.detail}`,
        );
        await new Promise((r) => setTimeout(r, 2_500 + Math.random() * 2_000));
        try {
          await page.reload({ waitUntil: "networkidle2", timeout: 30_000 });
        } catch {
          try {
            await page.reload({ waitUntil: "domcontentloaded", timeout: 15_000 });
          } catch {
            // reload gescheitert → Assessment unten entscheidet
          }
        }
        await new Promise((r) => setTimeout(r, 1_200));
        await runDismissAndDetect(timeoutMs);
        readiness = await assessRenderReadiness(page);
        if (!readiness.ok) {
          throw new RenderNotReadyError(readiness.problem, readiness.detail);
        }
        console.log(`[clean-render] ${hostname}: recovered after reload`);
      }

      if (!opts?.skipWatchdog) {
        watchdog = await startOverlayWatchdog(page);
      }
      return dismiss as unknown as DismissResult;
    },

    finish: async (success, problem) => {
      if (finished) return;
      finished = true;
      let watchdogCount = 0;
      if (watchdog) watchdogCount = await watchdog.stop();
      await disableAdblock();

      if (!hostname) return;
      const d = dismiss as DismissResult | null;
      const resolvedBy = d?.api
        ? `api:${d.api}`
        : d?.clicked
          ? "click"
          : (d?.hidden ?? 0) > 0
            ? "hide"
            : watchdogCount > 0
              ? "watchdog"
              : "none";
      await recordDomainRenderResult({
        hostname,
        platform: detected.platform,
        cmp: detected.cmp,
        resolvedBy,
        success,
        problem: problem ?? null,
      });
    },
  };
}
