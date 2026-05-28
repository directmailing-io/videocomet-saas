/**
 * Cookie-Banner-Dismissal.
 *
 * Versucht, in der aktuellen Puppeteer-Page gängige Cookie-Consent-Banner
 * (OneTrust, Cookiebot, Usercentrics, generische DSGVO-Banner, etc.)
 * automatisch zu schliessen. Wird vor jedem Capture aufgerufen, damit
 * die Hero-Section sauber sichtbar ist und nicht von einem Modal verdeckt
 * wird.
 *
 * Strategie:
 *   1. Bekannte CSS-Selektoren probieren (OneTrust, Cookiebot, ...).
 *   2. Falls keine treffen: per page.evaluate alle Buttons / role=button
 *      durchsuchen und nach Text-Mustern wie "Alle akzeptieren",
 *      "Akzeptieren", "Accept all" matchen.
 *
 * Failure-Modes:
 *   - Page geschlossen / crasht  → swallowed, returns false
 *   - Kein Banner im Timeout     → returns false
 *   - Click wirft                → swallowed, weiter mit nächstem Selector
 */

import type { Page } from "puppeteer-core";

/** Bekannte Cookie-Banner-Selektoren (Standard-CMP-Vendors + häufige Klassen). */
const COOKIE_BANNER_SELECTORS: string[] = [
  // OneTrust
  "#onetrust-accept-btn-handler",
  // Cookiebot
  "#CybotCookiebotDialogBodyButtonAccept",
  "#CybotCookiebotDialogBodyLevelButtonAccept",
  "#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll",
  // Usercentrics
  '[data-testid="uc-accept-all-button"]',
  // Cookielaw / TrustArc / etc.
  ".accept-all-cookies",
  ".accept-cookies",
  ".cookie-accept",
  "#accept-cookies",
  // Generic role / aria
  '[role="button"][aria-label*="cookie" i]',
  '[aria-label*="akzeptieren" i]',
];

/** Regex für Text-basiertes Matching (deutsch + englisch). */
const TEXT_RE = /^(alle akzeptieren|akzeptieren|zustimmen|einverstanden|accept all|accept|got it|i agree|ok)\.?$/i;

/**
 * Versucht über `timeoutMs` Millisekunden (in 200ms-Intervallen) ein
 * Cookie-Banner zu finden und zu schliessen.
 *
 * @returns `true` wenn ein Banner geklickt wurde, sonst `false`.
 */
export async function dismissCookieBanners(
  page: Page,
  timeoutMs = 5_000,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  const intervalMs = 200;

  while (Date.now() < deadline) {
    // Phase A: bekannte Selektoren.
    for (const selector of COOKIE_BANNER_SELECTORS) {
      try {
        const handle = await page.$(selector);
        if (handle) {
          await handle.click().catch(() => undefined);
          await handle.dispose().catch(() => undefined);
          await new Promise((r) => setTimeout(r, 500));
          // eslint-disable-next-line no-console
          console.log(`[cookie-dismiss] clicked ${selector}`);
          return true;
        }
      } catch {
        // weitermachen mit dem nächsten Selector
      }
    }

    // Phase B: Text-basiertes Matching über page.evaluate.
    try {
      const clicked = await page.evaluate((reSrc: string) => {
        const re = new RegExp(reSrc, "i");
        const candidates = Array.from(
          document.querySelectorAll<HTMLElement>(
            'button, [role="button"], a[role="button"]',
          ),
        );
        const match = candidates.find((el) => {
          const txt = (el.textContent || "").trim();
          if (!txt) return false;
          return re.test(txt);
        });
        if (match) {
          match.click();
          return match.tagName.toLowerCase() + ':' + (match.textContent || '').trim().slice(0, 40);
        }
        return null;
      }, TEXT_RE.source);

      if (clicked) {
        await new Promise((r) => setTimeout(r, 500));
        // eslint-disable-next-line no-console
        console.log(`[cookie-dismiss] clicked ${clicked}`);
        return true;
      }
    } catch {
      // page eval failed (page closed?) → next tick
    }

    await new Promise((r) => setTimeout(r, intervalMs));
  }

  // eslint-disable-next-line no-console
  console.log(`[cookie-dismiss] no banner found`);
  return false;
}
