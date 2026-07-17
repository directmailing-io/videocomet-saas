import type { Page } from "puppeteer-core";

/**
 * Schicht 0 des Clean-Render-Systems: Consent-Zustände VOR der Navigation
 * setzen, damit CMP-Banner gar nicht erst rendern.
 *
 * Wir preseeden nur CMPs mit stabilen, dokumentierten Cookie-/localStorage-
 * Formaten. Fragile Formate (Usercentrics, Pandectes, Iubenda, Klaro,
 * Didomi, Sourcepoint) werden bewusst NICHT preseeded — die fängt der
 * Klick-/API-Layer (cookie-dismiss.ts) bzw. der Adblocker ab. Ein falsch
 * formatiertes Preseed-Cookie kann CMPs in einen kaputten Zustand bringen,
 * der schlimmer ist als ein sichtbares Banner.
 *
 * Alle Rezepte setzen "alles akzeptiert" — für die Aufnahme ist nur wichtig,
 * dass kein Banner erscheint; der Browser-Kontext ist ephemer.
 */

const CONSENT_STAMP = "vc-preseed";

type CookieRecipe = { name: string; value: string };

function encode(v: string): string {
  return encodeURIComponent(v);
}

/** Cookies, die für JEDEN Host gesetzt werden (first-party Formate). */
function buildCookieRecipes(): CookieRecipe[] {
  const nowIso = new Date().toISOString();
  return [
    // ── Cookiebot (Webflow, WordPress, custom — sehr verbreitet) ─────────
    {
      name: "CookieConsent",
      value: encode(
        `{stamp:'${CONSENT_STAMP}',necessary:true,preferences:true,statistics:true,marketing:true,method:'explicit',ver:1,utc:${Date.now()},region:'de'}`,
      ),
    },
    // ── OneTrust ──────────────────────────────────────────────────────────
    { name: "OptanonAlertBoxClosed", value: nowIso },
    {
      name: "OptanonConsent",
      value: encode(
        `isGpcEnabled=0&datestamp=${nowIso}&version=202401.1.0&interactionCount=1&landingPath=NotLandingPage&groups=C0001:1,C0002:1,C0003:1,C0004:1,C0005:1&AwaitingReconsent=false`,
      ),
    },
    // ── CookieFirst (titus.de, joe-nimble.com, dmax-shop.de) ──────────────
    {
      name: "cookiefirst-consent",
      value: encode(
        JSON.stringify({
          necessary: true,
          performance: true,
          functional: true,
          advertising: true,
          timestamp: Date.now(),
          type: "category",
          version: null,
        }),
      ),
    },
    // ── Complianz (WordPress, z. B. wurmkiste.at) ─────────────────────────
    { name: "cmplz_banner-status", value: "dismissed" },
    { name: "cmplz_consented_services", value: "" },
    { name: "cmplz_functional", value: "allow" },
    { name: "cmplz_marketing", value: "allow" },
    { name: "cmplz_statistics", value: "allow" },
    { name: "cmplz_preferences", value: "allow" },
    // ── CookieYes (WordPress) ─────────────────────────────────────────────
    {
      name: "cookieyes-consent",
      value:
        "consentid:dmMtcHJlc2VlZA,consent:yes,action:yes,necessary:yes,functional:yes,analytics:yes,performance:yes,advertisement:yes,other:yes",
    },
    // ── Borlabs Cookie v2/v3 (WordPress, DACH-Standard) ───────────────────
    {
      name: "borlabs-cookie",
      value: encode(
        JSON.stringify({
          consents: { essential: ["borlabs-cookie"] },
          domainPath: "",
          expires: "",
          uid: CONSENT_STAMP,
          version: "1",
        }),
      ),
    },
    // ── WebToffee / CookieLawInfo (WordPress) ─────────────────────────────
    { name: "viewed_cookie_policy", value: "yes" },
    { name: "cookielawinfo-checkbox-necessary", value: "yes" },
    { name: "cookielawinfo-checkbox-functional", value: "yes" },
    { name: "cookielawinfo-checkbox-analytics", value: "yes" },
    { name: "cookielawinfo-checkbox-performance", value: "yes" },
    { name: "cookielawinfo-checkbox-advertisement", value: "yes" },
    { name: "cookielawinfo-checkbox-others", value: "yes" },
    // ── Moove GDPR (WordPress) ────────────────────────────────────────────
    { name: "moove_gdpr_popup", value: encode('{"strict":"1","thirdparty":"1","advanced":"1"}') },
    // ── Wix native Consent ────────────────────────────────────────────────
    {
      name: "consent-policy",
      value: encode('{"ess":1,"func":1,"anl":1,"adv":1,"dt3":1,"ta":1}'),
    },
    // ── HubSpot CMS Banner ────────────────────────────────────────────────
    { name: "__hs_opt_out", value: "no" },
    {
      name: "__hs_cookie_cat_pref",
      value: "1:true,2:true,3:true",
    },
    // ── Shopware 6 ────────────────────────────────────────────────────────
    { name: "cookie-preference", value: "1" },
    // ── Finsweet Cookie Consent (Webflow-Standard) ────────────────────────
    {
      name: "fs-cc",
      value: encode(
        JSON.stringify({
          id: CONSENT_STAMP,
          consents: { analytics: true, essential: true, marketing: true, personalization: true, uncategorized: true },
        }),
      ),
    },
    // ── Osano ─────────────────────────────────────────────────────────────
    {
      name: "osano_consentmanager",
      value: "",
    },
    // ── jimdo / one.com Onepager: EU-Cookie-Simple-Varianten ──────────────
    { name: "cookieconsent_status", value: "allow" }, // Insites cookieconsent (sehr verbreitet bei Onepagern)
    { name: "cc_cookie_accept", value: "cc_cookie_accept" },
  ].filter((r) => r.value !== "");
}

/**
 * localStorage-Rezepte, injiziert via evaluateOnNewDocument (läuft vor
 * jedem Site-Script). Deckt CMPs ab, die localStorage statt Cookies nutzen.
 */
const LOCALSTORAGE_PRESEED = `(() => {
  try {
    const now = Date.now();
    const set = (k, v) => { try { localStorage.setItem(k, v); } catch (_) {} };
    // Consentmanager.net
    set("__cmpconsent", "");
    // Cookie Notice (WordPress, hu-manity)
    set("cookie_notice_accepted", "true");
    // Elementor / WP simple banners
    set("cookieBannerDismissed", "true");
    set("cookie-banner-dismissed", "true");
    set("cookiesAccepted", "true");
    set("cookies-accepted", "true");
    set("cookieConsent", "true");
    set("cookie_consent", "accepted");
    set("gdpr-consent", "accepted");
    set("gdpr_consent", "true");
    // Squarespace
    set("squarespace-cookie-banner-v2", "true");
    // Shopify Sense/privacy banner localStorage flag (einige Themes)
    set("shopify_cookie_consent", "accepted");
  } catch (_) {}
})();`;

/**
 * Setzt Consent-Cookies für den Ziel-Host (inkl. Parent-Domain, damit
 * www./shop.-Subdomains abgedeckt sind) und injiziert localStorage-Preseeds.
 * Muss VOR page.goto() aufgerufen werden. Fehler sind nie fatal.
 */
export async function preseedConsent(page: Page, targetUrl: string): Promise<void> {
  let url: URL;
  try {
    url = new URL(targetUrl);
  } catch {
    return;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return;

  try {
    const recipes = buildCookieRecipes();
    const expires = Math.floor(Date.now() / 1000) + 60 * 60 * 24;

    // Parent-Domain berechnen: www.shop.example.de → .example.de
    // (naive eTLD-Behandlung reicht hier: bei 2-Level-Hosts Host selbst nutzen)
    const parts = url.hostname.split(".");
    const parentDomain =
      parts.length > 2 ? "." + parts.slice(-2).join(".") : url.hostname;

    const cookies = recipes.map((r) => ({
      name: r.name,
      value: r.value,
      domain: parentDomain,
      path: "/",
      expires,
      httpOnly: false,
      secure: url.protocol === "https:",
    }));

    await page.setCookie(...cookies);
  } catch (err) {
    console.warn(
      `[consent-preseed] cookie preseed failed for ${url.hostname}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  try {
    await page.evaluateOnNewDocument(LOCALSTORAGE_PRESEED);
  } catch (err) {
    console.warn(
      `[consent-preseed] localStorage preseed failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
