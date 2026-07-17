import type { Page } from "puppeteer-core";

/**
 * Schicht 3 des Clean-Render-Systems: Overlay-Watchdog.
 *
 * Cookie-Banner erscheinen beim Load — Newsletter-Popups (Klaviyo!) und
 * Chat-Widgets aber erst 5–15 s SPÄTER, also mitten in der Aufnahme.
 * Der Watchdog läuft deshalb als setInterval IM Page-Context während der
 * gesamten Capture-Dauer und räumt in jedem Tick auf:
 *
 *   1. Chat-Widgets pauschal verstecken (bekannte Container).
 *   2. Newsletter-/Popup-Heuristik: fixed/absolute Overlays mit
 *      E-Mail-Input oder Popup-Signatur → erst Close-Button klicken,
 *      sonst verstecken. Backdrops gleich mit.
 *   3. Scroll-Locks auf html/body lösen (Popups setzen overflow:hidden).
 *
 * Konservative Guards wie im Hide-Pass von cookie-dismiss.ts: nie main/nav/
 * video/canvas-Wrapper anfassen, Kappe pro Tick, idempotent via data-Attribut.
 */

/** Chat-/Support-Widgets, die während der Aufnahme nie sichtbar sein sollen. */
const CHAT_WIDGET_SELECTORS: string[] = [
  // Userlike
  '[id^="userlike"]',
  ".umm-mobile-widget",
  // Crisp
  ".crisp-client",
  // Intercom
  "#intercom-container",
  ".intercom-lightweight-app",
  // Gorgias
  "#gorgias-chat-container",
  // Zendesk
  'iframe[title*="Schaltfläche"][id^="launcher"]',
  "#launcher",
  'iframe[data-product="web_widget"]',
  // Tidio
  "#tidio-chat",
  // LiveChat
  "#chat-widget-container",
  // Tawk.to
  'iframe[title="chat widget"]',
  // HubSpot Chat
  "#hubspot-messages-iframe-container",
  // Freshchat
  "#fc_frame",
  // Smartsupp
  "#smartsupp-widget-container",
  // Trengo
  "#trengo-web-widget",
  // WhatsApp-Bubbles (verbreitete Shopify-Apps)
  ".wa-chat-box",
  "#whatsapp-chat-widget",
  // Klaviyo Chat / Forms Teaser
  '[class*="kl-teaser"]',
  // Cookiebot-Nachzügler-Badge
  "#CookiebotWidget",
  // Usercentrics Fingerprint-Button
  "#uc-btn-open-main-corner-modal",
  ".uc-embedding-container",
];

/**
 * Watchdog-Skript, läuft via page.evaluate. Startet ein Intervall und legt
 * eine Stop-Funktion + Zähler auf window ab.
 */
function startWatchdogInPage(chatSelectors: string[], intervalMs: number): void {
  const w = window as unknown as Record<string, any>;
  if (w.__vcWatchdogStop) return; // schon aktiv

  const STYLE_ID = "__vc-watchdog-hide";
  const MARK = "data-vc-watchdog";
  let dismissed = 0;

  // Chat-Widgets pauschal per Stylesheet (greift auch für späte Mounts).
  if (!document.getElementById(STYLE_ID)) {
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent =
      chatSelectors.join(",\n") +
      " { display: none !important; visibility: hidden !important; }";
    (document.head ?? document.documentElement).appendChild(style);
  }

  const closeTextRe = /^(×|✕|✖|x|schließen|close|no,? thanks|nein,? danke|kein interesse|vielleicht später|not now|jetzt nicht|maybe later|dismiss|weiter ohne)/i;
  const popupAttrRe = /popup|modal|newsletter|overlay|lightbox|drawer|needsclick|kl-private|klaviyo|omnisend|mailchimp|privy|justuno|optinmonster|sumome|wisepops|poptin/i;

  const isStructural = (el: Element): boolean =>
    el.querySelector("main, nav, video, canvas") !== null ||
    el.tagName === "MAIN" ||
    el.tagName === "NAV" ||
    el.id === "__next" ||
    el.id === "root";

  const tryCloseButton = (el: HTMLElement): boolean => {
    const candidates = el.querySelectorAll<HTMLElement>(
      'button, a, [role="button"], [aria-label], [class*="close" i], [class*="dismiss" i]',
    );
    for (const btn of Array.from(candidates)) {
      const label = (
        (btn.getAttribute("aria-label") ?? "") +
        " " +
        (btn.textContent ?? "")
      )
        .replace(/\s+/g, " ")
        .trim();
      const attrs = `${btn.id} ${btn.className}`;
      if (
        closeTextRe.test(label) ||
        /(^|[-_ ])close|dismiss/i.test(attrs) ||
        /schließen|close/i.test(btn.getAttribute("aria-label") ?? "")
      ) {
        const r = btn.getBoundingClientRect();
        if (r.width > 1 && r.height > 1) {
          try {
            btn.click();
            return true;
          } catch {
            /* weiter */
          }
        }
      }
    }
    return false;
  };

  const tick = (): void => {
    try {
      // Scroll-Locks lösen.
      const de = document.documentElement;
      if (getComputedStyle(de).overflow === "hidden") {
        de.style.setProperty("overflow", "auto", "important");
      }
      if (document.body && getComputedStyle(document.body).overflow === "hidden") {
        document.body.style.setProperty("overflow", "auto", "important");
      }

      let handledThisTick = 0;
      const all = Array.from(
        document.body?.querySelectorAll<HTMLElement>("*") ?? [],
      );
      for (const el of all) {
        if (handledThisTick >= 4) break;
        if (el.hasAttribute(MARK)) continue;
        const cs = getComputedStyle(el);
        if (cs.position !== "fixed") continue;
        if (cs.display === "none" || cs.visibility === "hidden") continue;
        const r = el.getBoundingClientRect();
        // Nur großflächige Overlays: mind. 25% der Viewport-Fläche ODER
        // voller Backdrop.
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const areaRatio = (r.width * r.height) / Math.max(1, vw * vh);
        const isBackdrop =
          r.width >= vw * 0.95 &&
          r.height >= vh * 0.95 &&
          (parseFloat(cs.opacity) < 1 || /rgba?\(/.test(cs.backgroundColor));
        if (areaRatio < 0.25 && !isBackdrop) continue;
        if (isStructural(el)) continue;

        const attrs = `${el.id} ${el.className} ${el.getAttribute("data-testid") ?? ""}`;
        const hasEmailInput =
          el.querySelector('input[type="email"], input[name*="email" i]') !==
          null;
        const attrMatch = popupAttrRe.test(attrs);
        if (!hasEmailInput && !attrMatch && !isBackdrop) continue;

        el.setAttribute(MARK, "1");
        // Erst höflich schließen (räumt Backdrop + Scroll-Lock der App weg) …
        const closed = hasEmailInput || attrMatch ? tryCloseButton(el) : false;
        if (!closed) {
          // … sonst hart verstecken.
          el.style.setProperty("display", "none", "important");
        }
        dismissed++;
        handledThisTick++;
        w.__vcWatchdogCount = dismissed;
      }
    } catch {
      /* Tick darf nie werfen */
    }
  };

  const handle = setInterval(tick, intervalMs);
  w.__vcWatchdogCount = 0;
  w.__vcWatchdogStop = () => {
    clearInterval(handle);
    delete w.__vcWatchdogStop;
  };
  tick();
}

export type WatchdogHandle = {
  /** Stoppt den Watchdog und liefert die Anzahl entschärfter Overlays. */
  stop: () => Promise<number>;
};

/**
 * Startet den Overlay-Watchdog auf der Page. Läuft im Page-Context weiter,
 * bis stop() gerufen wird oder die Page navigiert/schließt. Nie fatal.
 */
export async function startOverlayWatchdog(
  page: Page,
  intervalMs = 500,
): Promise<WatchdogHandle> {
  try {
    await page.evaluate(startWatchdogInPage, CHAT_WIDGET_SELECTORS, intervalMs);
  } catch (err) {
    console.warn(
      `[overlay-watchdog] start failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  return {
    stop: async () => {
      try {
        return await page.evaluate(() => {
          const w = window as unknown as Record<string, any>;
          const count = (w.__vcWatchdogCount as number) ?? 0;
          w.__vcWatchdogStop?.();
          return count;
        });
      } catch {
        return 0;
      }
    },
  };
}
