/**
 * Cookie-Banner-Dismissal.
 *
 * Versucht, in der aktuellen Puppeteer-Page Cookie-Consent-Banner
 * automatisch zu schließen, damit Captures (Scroll-Video, Screenshots)
 * nicht von einem Modal verdeckt werden.
 *
 * Strategie (in dieser Reihenfolge, über `timeoutMs` in 250ms-Ticks):
 *   1. Bekannte Accept-Selektoren klicken — in ALLEN Frames der Page
 *      (Sourcepoint/consentmanager rendern in iframes).
 *   2. Deep-Scan pro Frame inkl. offener Shadow-Roots (Usercentrics!):
 *      klickbare Elemente per Text ("Alle akzeptieren", "Cookies
 *      willkommen!", …) oder Klasse/ID (`accept-all`, `acceptAll`, …).
 *   3. Am Ende IMMER ein Hide-Pass: persistentes <style> versteckt bekannte
 *      CMP-Container (wirkt auch für Banner, die erst später mounten) und
 *      eine Heuristik entfernt fixed/sticky-Overlays mit Cookie-Text.
 *      Scroll-Locks auf html/body werden aufgehoben.
 *
 * Klicken ist der Primärweg (entfernt auch Backdrop/Blur sauber); das
 * Verstecken ist das Sicherheitsnetz für unbekannte CMPs — für die
 * Video-Aufnahme zählt nur, dass nichts über der Seite liegt.
 *
 * Failure-Modes:
 *   - Page geschlossen / crasht  → swallowed, returns false
 *   - Frame detached beim Klick  → swallowed, nächster Frame
 */

import type { Frame, Page } from "puppeteer-core";

/** Bekannte Accept-Selektoren (Standard-CMPs + verbreitete Shop-Apps). */
const COOKIE_BANNER_SELECTORS: string[] = [
  // OneTrust
  "#onetrust-accept-btn-handler",
  // Cookiebot
  "#CybotCookiebotDialogBodyButtonAccept",
  "#CybotCookiebotDialogBodyLevelButtonAccept",
  "#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll",
  // Usercentrics (v1 ohne Shadow-DOM; v2/v3 via Deep-Scan)
  '[data-testid="uc-accept-all-button"]',
  // Consentmanager
  "#cmpwelcomebtnyes",
  ".cmpboxbtnyes",
  // Borlabs (WordPress)
  "._brlbs-btn-accept-all",
  'a[data-cookie-accept-all]',
  // Complianz
  ".cmplz-accept",
  // CookieYes
  ".cky-btn-accept",
  // Klaro
  ".cm-btn-success",
  ".klaro .cm-btn-accept-all",
  // CookieFirst
  '[data-cookiefirst-action="accept"]',
  // CCM19
  ".ccm--button-primary",
  "#ccm-widget .ccm--save-settings",
  // tarteaucitron
  "#tarteaucitronPersonalize2",
  // Pandectes (Shopify)
  "#pandectes-banner .cc-allow",
  ".pd-cp-ui-accept",
  // Shopify native privacy banner
  "#shopify-pc__banner__btn-accept",
  // Custom-Modals (z.B. inuvet.com)
  "#modal-accept-all",
  // Didomi
  "#didomi-notice-agree-button",
  // Iubenda
  ".iubenda-cs-accept-btn",
  // Osano
  ".osano-cm-accept-all",
  // Quantcast Choice
  '#qc-cmp2-ui button[mode="primary"]',
  // Sourcepoint (rendert im iframe; sp_choice_type_11 = Accept All)
  ".sp_choice_type_11",
  'button[title="Accept All"]',
  'button[title="Alle akzeptieren"]',
  // Finsweet Cookie Consent (Webflow)
  '[fs-cc="allow"]',
  // HubSpot CMS Banner
  "#hs-eu-confirmation-button",
  // Wix native
  '[data-hook="consent-banner-apply-button"]',
  // Squarespace
  ".sqs-cookie-banner-v2-accept",
  // Google Funding Choices
  ".fc-cta-consent",
  // Cookie Notice (WordPress)
  "#cn-accept-cookie",
  // Moove GDPR (WordPress)
  ".moove-gdpr-infobar-allow-all",
  // Civic Cookie Control
  "#ccc-notify-accept",
  // cookie-script.com
  "#cookiescript_accept",
  // Termly
  ".t-acceptAllButton",
  // Generische Klassen / IDs
  ".accept-all-cookies",
  ".accept-cookies",
  ".cookie-accept",
  "#accept-cookies",
  '[aria-label*="akzeptieren" i]',
  '[aria-label*="accept all" i]',
];

/**
 * Text-Muster für Accept-Buttons (deutsch + englisch). Bewusst NICHT hart
 * an ^…$ verankert — Buttons haben oft Icons/Whitespace drumherum. Die
 * Längen-Guards passieren im Deep-Scan (kurze Labels bevorzugt).
 */
const ACCEPT_TEXT_RE =
  /^(alle[sn]? (cookies )?(akzeptieren|erlauben|zulassen|annehmen)|(cookies )?akzeptieren|zustimmen( und weiter)?|einverstanden|verstanden|cookies willkommen!?|alle auswählen und bestätigen|accept( all)?( cookies)?|allow all( cookies)?|agree( & close)?|i agree|got it|ok(ay)?)[.!]?$/i;

/** Klassen-/ID-Muster, die stark auf einen Accept-All-Button hindeuten. */
const ACCEPT_ATTR_RE =
  /(accept|allow|agree)[-_]?(all|cookies|btn)|acceptAllCookies|js-accept|consent-accept/i;

/** Container, die der Hide-Pass pauschal versteckt (persistentes <style>). */
const HIDE_CONTAINER_SELECTORS: string[] = [
  "#onetrust-banner-sdk",
  "#onetrust-consent-sdk",
  "#CybotCookiebotDialog",
  "#CybotCookiebotDialogBodyUnderlay",
  "#usercentrics-root",
  "#usercentrics-cmp-ui",
  "#cmpbox",
  "#cmpbox2",
  "#BorlabsCookieBox",
  "#BorlabsCookieWidget",
  "#cmplz-cookiebanner-container",
  ".cky-consent-container",
  ".cky-overlay",
  ".klaro",
  ".cookiefirst-root",
  "#ccm-widget",
  "#tarteaucitronRoot",
  "#pandectes-banner",
  ".pd-cp-ui",
  "#shopify-pc__banner",
  "#cookiebanner",
  "#cookie-banner",
  ".cookie-banner",
  "#cookieConsent",
  ".cc-window",
  ".cc-banner",
  "#didomi-host",
  "#qc-cmp2-container",
  "#iubenda-cs-banner",
  ".osano-cm-window",
  '[id^="sp_message_container"]',
  ".fc-consent-root",
  "#hs-eu-cookie-confirmation",
  '[data-hook="consent-banner-root"]',
  ".sqs-cookie-banner-v2",
  "#cookiescript_injected",
  "#cookie-notice",
  "#moove_gdpr_cookie_info_bar",
  "#ccc",
  "#termly-code-snippet-support",
  "#cookiefirst-root",
  '[data-cookiefirst-widget="banner"]',
  "#axeptio_overlay",
];

/**
 * Läuft in page.evaluate: sucht klickbare Accept-Elemente im Document
 * INKLUSIVE offener Shadow-Roots und klickt den besten Treffer.
 * Gibt ein Label des geklickten Elements zurück oder null.
 */
function deepClickAcceptInPage(
  textReSrc: string,
  attrReSrc: string,
): string | null {
  const textRe = new RegExp(textReSrc, "i");
  const attrRe = new RegExp(attrReSrc, "i");

  const clickables: HTMLElement[] = [];
  const walk = (root: Document | ShadowRoot | Element): void => {
    const all = root.querySelectorAll<HTMLElement>("*");
    for (const el of Array.from(all)) {
      const tag = el.tagName.toLowerCase();
      if (
        tag === "button" ||
        (tag === "a" && (el.getAttribute("href") ?? "#").length <= 1) ||
        el.getAttribute("role") === "button" ||
        (tag === "input" &&
          ["button", "submit"].includes(
            (el as HTMLInputElement).type ?? "",
          )) ||
        typeof (el as { onclick?: unknown }).onclick === "function"
      ) {
        clickables.push(el);
      }
      if (el.shadowRoot) walk(el.shadowRoot);
    }
  };
  walk(document);

  const visible = (el: HTMLElement): boolean => {
    const r = el.getBoundingClientRect();
    return r.width > 1 && r.height > 1;
  };

  // Kandidaten scoren: exakter Accept-Text schlägt Attribut-Matches.
  let best: { el: HTMLElement; score: number; label: string } | null = null;
  for (const el of clickables) {
    if (!visible(el)) continue;
    const txt = (el.textContent ?? "").replace(/\s+/g, " ").trim();
    const attrs = `${el.id} ${el.className}`;
    let score = 0;
    if (txt.length > 0 && txt.length <= 60 && textRe.test(txt)) {
      score = /alle|all/i.test(txt) ? 3 : 2;
    } else if (attrRe.test(attrs)) {
      score = 1;
    }
    if (score > (best?.score ?? 0)) {
      best = {
        el,
        score,
        label: `${el.tagName.toLowerCase()}:${(txt || attrs).slice(0, 50)}`,
      };
    }
  }
  if (best) {
    best.el.click();
    return best.label;
  }
  return null;
}

/**
 * Läuft in page.evaluate: versteckt bekannte CMP-Container über ein
 * persistentes <style> (greift auch für später gemountete Banner),
 * entfernt heuristisch fixed/sticky-Overlays mit Cookie-Text und hebt
 * Scroll-Locks auf. Gibt die Anzahl heuristisch versteckter Elemente zurück.
 */
function hideCookieUiInPage(hideSelectors: string[]): number {
  const STYLE_ID = "__vc-cookie-hide";
  if (!document.getElementById(STYLE_ID)) {
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent =
      hideSelectors.join(",\n") +
      " { display: none !important; visibility: hidden !important; }";
    (document.head ?? document.documentElement).appendChild(style);
  }

  // Scroll-Locks lösen (viele CMPs setzen overflow:hidden auf html/body).
  document.documentElement.style.setProperty("overflow", "auto", "important");
  document.body?.style.setProperty("overflow", "auto", "important");

  // Heuristik: fixed/sticky-Overlays, die erkennbar Cookie-UI sind.
  const cookieTextRe =
    /cookie|consent|datenschutz|dsgvo|einwilligung|privatsphäre/i;
  const cookieAttrRe = /cookie|consent|cmp|gdpr|privacy/i;
  let hidden = 0;
  for (const el of Array.from(document.body?.querySelectorAll<HTMLElement>("*") ?? [])) {
    if (hidden >= 8) break; // Sicherheitskappe
    if (el.offsetParent !== null && el.style.display === "none") continue;
    const cs = window.getComputedStyle(el);
    if (cs.position !== "fixed" && cs.position !== "sticky") continue;
    if (cs.display === "none" || cs.visibility === "hidden") continue;
    const r = el.getBoundingClientRect();
    if (r.width < 40 || r.height < 40) continue;

    const attrs = `${el.id} ${el.className}`;
    const txt = (el.textContent ?? "").slice(0, 4000);
    const attrMatch = cookieAttrRe.test(attrs);
    const textMatch =
      cookieTextRe.test(txt) &&
      txt.replace(/\s+/g, " ").trim().length < 3500 &&
      el.querySelector("button, a, [role=button]") !== null;
    if (!attrMatch && !textMatch) continue;
    // Nie strukturelle Wrapper verstecken.
    if (el.querySelector("main, nav, header h1, video, canvas")) continue;

    el.style.setProperty("display", "none", "important");
    hidden++;
  }
  return hidden;
}

/**
 * Läuft in page.evaluate (nur Main-Frame): ruft offizielle CMP-JS-APIs auf.
 * Das ist der sauberste Weg — die CMP räumt selbst Backdrop, Scroll-Lock und
 * Folgedialoge weg. Gibt den Namen der getroffenen CMP zurück oder null.
 * Alle Aufrufe einzeln geguardet: eine kaputte API darf die nächste nicht
 * verhindern.
 */
function tryCmpApisInPage(): string | null {
  const w = window as unknown as Record<string, any>;
  const attempts: Array<[string, () => boolean]> = [
    [
      "usercentrics",
      () => {
        if (!w.UC_UI?.acceptAllConsents) return false;
        w.UC_UI.acceptAllConsents();
        w.UC_UI.closeCMP?.();
        return true;
      },
    ],
    [
      "cookiebot",
      () => {
        if (!w.Cookiebot?.submitCustomConsent) return false;
        w.Cookiebot.submitCustomConsent(true, true, true);
        w.Cookiebot.hide?.();
        return true;
      },
    ],
    [
      "onetrust",
      () => {
        if (!w.OneTrust?.AllowAll) return false;
        w.OneTrust.AllowAll();
        w.OneTrust.Close?.();
        return true;
      },
    ],
    [
      "complianz",
      () => {
        if (typeof w.cmplz_accept_all !== "function") return false;
        w.cmplz_accept_all();
        return true;
      },
    ],
    [
      "klaro",
      () => {
        const m = w.klaro?.getManager?.();
        if (!m?.changeAll) return false;
        m.changeAll(true);
        m.saveAndApplyConsents?.();
        return true;
      },
    ],
    [
      "tarteaucitron",
      () => {
        if (!w.tarteaucitron?.userInterface?.respondAll) return false;
        w.tarteaucitron.userInterface.respondAll(true);
        return true;
      },
    ],
    [
      "didomi",
      () => {
        if (!w.Didomi?.setUserAgreeToAll) return false;
        w.Didomi.setUserAgreeToAll();
        return true;
      },
    ],
    [
      "cookiefirst",
      () => {
        if (!w.CookieFirst?.acceptAllCategories) return false;
        w.CookieFirst.acceptAllCategories();
        return true;
      },
    ],
    [
      "osano",
      () => {
        if (!w.Osano?.cm) return false;
        w.Osano.cm.acceptAll?.();
        w.Osano.cm.hideDialog?.();
        return true;
      },
    ],
    [
      "shopify-privacy",
      () => {
        const cp = w.Shopify?.customerPrivacy;
        if (!cp?.setTrackingConsent) return false;
        cp.setTrackingConsent(true, () => undefined);
        return true;
      },
    ],
  ];

  for (const [name, attempt] of attempts) {
    try {
      if (attempt()) return name;
    } catch {
      // API vorhanden aber wirft → nächste
    }
  }
  return null;
}

async function tryKnownSelectors(frame: Frame): Promise<string | null> {
  for (const selector of COOKIE_BANNER_SELECTORS) {
    try {
      const handle = await frame.$(selector);
      if (handle) {
        await handle.click().catch(() => undefined);
        await handle.dispose().catch(() => undefined);
        return selector;
      }
    } catch {
      // Frame weg oder Selector ungültig → nächster
    }
  }
  return null;
}

/** Strukturiertes Ergebnis für Telemetrie (Schicht 5). */
export type DismissResult = {
  /** Getroffene CMP-JS-API (z. B. "usercentrics"), sonst null. */
  api: string | null;
  /** Geklickter Selektor bzw. Deep-Scan-Label, sonst null. */
  clicked: string | null;
  /** Anzahl heuristisch versteckter Overlays. */
  hidden: number;
  /** true, wenn irgendeine Maßnahme gegriffen hat. */
  any: boolean;
};

/**
 * Versucht über `timeoutMs` Millisekunden ein Cookie-Banner zu schließen:
 * erst offizielle CMP-JS-APIs (Main-Frame), dann Klick in allen Frames
 * inkl. Shadow-DOM, dann ESC; zum Abschluss werden verbliebene/bekannte
 * Banner-Container per CSS versteckt.
 */
export async function dismissCookieBanners(
  page: Page,
  timeoutMs = 5_000,
): Promise<DismissResult> {
  const deadline = Date.now() + timeoutMs;
  const intervalMs = 250;
  let clicked: string | null = null;
  let api: string | null = null;

  while (Date.now() < deadline && !clicked && !api) {
    // Phase 0: offizielle CMP-JS-APIs (nur Main-Frame — CMPs hängen am
    // Top-Window, auch wenn ihre UI im iframe rendert).
    try {
      api = await page.evaluate(tryCmpApisInPage);
    } catch {
      // Page navigiert gerade o. ä.
    }
    if (api) break;

    for (const frame of page.frames()) {
      // Phase A: bekannte Selektoren.
      clicked = await tryKnownSelectors(frame);
      if (clicked) break;

      // Phase B: Deep-Scan (Text/Attribut, Shadow-DOM).
      try {
        clicked = await frame.evaluate(
          deepClickAcceptInPage,
          ACCEPT_TEXT_RE.source,
          ACCEPT_ATTR_RE.source,
        );
      } catch {
        // Frame nicht evaluierbar (cross-origin detached etc.)
      }
      if (clicked) break;
    }
    if (!clicked) await new Promise((r) => setTimeout(r, intervalMs));
  }

  if (api) {
    // eslint-disable-next-line no-console
    console.log(`[cookie-dismiss] cmp api ${api}`);
    await new Promise((r) => setTimeout(r, 600));
  } else if (clicked) {
    // eslint-disable-next-line no-console
    console.log(`[cookie-dismiss] clicked ${clicked}`);
    // Banner-Animationen ausblenden lassen.
    await new Promise((r) => setTimeout(r, 600));
  } else {
    // Phase C: ESC schließt viele Modals (Newsletter-Popups, manche CMPs).
    try {
      await page.keyboard.press("Escape");
    } catch {
      // Page weg
    }
  }

  // Hide-Pass läuft IMMER — Sicherheitsnetz für unbekannte CMPs und für
  // Banner, die nach dem Klick weitere Layer öffnen.
  let hidden = 0;
  try {
    hidden = await page.evaluate(hideCookieUiInPage, HIDE_CONTAINER_SELECTORS);
  } catch {
    // Page weg → egal, Capture-Caller behandelt das
  }
  if (hidden > 0) {
    // eslint-disable-next-line no-console
    console.log(`[cookie-dismiss] hid ${hidden} overlay(s) heuristically`);
  }
  if (!api && !clicked && hidden === 0) {
    // eslint-disable-next-line no-console
    console.log("[cookie-dismiss] no banner found");
  }
  return {
    api,
    clicked,
    hidden,
    any: Boolean(api) || Boolean(clicked) || hidden > 0,
  };
}
