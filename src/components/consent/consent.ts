"use client";

/**
 * Leichtgewichtiger Consent-Store (§ 25 TDDDG / Art. 6 DSGVO).
 *
 * Die Einwilligung selbst wird in einem First-Party-Cookie gespeichert —
 * das ist ohne Einwilligung zulaessig (technisch erforderlich, um die
 * Wahl des Nutzers zu respektieren). Version hochzaehlen, wenn neue
 * Kategorien/Dienste dazukommen: dann wird der Banner erneut gezeigt.
 *
 * Konstanten + Parser leben in `./consent-parse` (kein "use client"),
 * damit Server-Components sie importieren können — hier re-exportiert
 * für abwärtskompatible Imports.
 */

export {
  CONSENT_COOKIE,
  CONSENT_VERSION,
  CONSENT_MAX_AGE_DAYS,
  parseConsentCookie,
  type ConsentCategories,
  type ConsentState,
} from "./consent-parse";

import {
  CONSENT_COOKIE,
  CONSENT_VERSION,
  CONSENT_MAX_AGE_DAYS,
  parseConsentCookie,
  type ConsentCategories,
  type ConsentState,
} from "./consent-parse";

export const OPEN_SETTINGS_EVENT = "vc:open-cookie-settings";
export const CONSENT_CHANGED_EVENT = "vc:consent-changed";

export function readConsent(): ConsentState | null {
  if (typeof document === "undefined") return null;
  const raw = document.cookie
    .split("; ")
    .find((c) => c.startsWith(`${CONSENT_COOKIE}=`))
    ?.slice(CONSENT_COOKIE.length + 1);
  return parseConsentCookie(raw);
}

export function writeConsent(categories: {
  statistics: boolean;
  marketing: boolean;
}): ConsentState {
  const state: ConsentState = {
    version: CONSENT_VERSION,
    timestamp: new Date().toISOString(),
    categories: {
      necessary: true,
      statistics: categories.statistics,
      marketing: categories.marketing,
    },
  };
  const maxAge = CONSENT_MAX_AGE_DAYS * 24 * 60 * 60;
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  // Cookie muss auf `.videocomet.de` liegen, damit sowohl Marketing- als auch
  // App-Subdomain denselben Consent lesen. Domain nur setzen wenn wir NICHT
  // auf localhost sind (Localhost akzeptiert keine Domain-Cookies).
  const isVcDe = /\.?videocomet\.de$/i.test(window.location.hostname);
  const domain = isVcDe ? "; Domain=.videocomet.de" : "";
  document.cookie = `${CONSENT_COOKIE}=${encodeURIComponent(
    JSON.stringify(state),
  )}; Max-Age=${maxAge}; Path=/; SameSite=Lax${secure}${domain}`;
  window.dispatchEvent(new CustomEvent(CONSENT_CHANGED_EVENT, { detail: state }));
  return state;
}

/** Für Skript-Gates: hasConsent("marketing") vor dem Laden prüfen. */
export function hasConsent(category: keyof ConsentCategories): boolean {
  if (category === "necessary") return true;
  return readConsent()?.categories[category] === true;
}

export function openCookieSettings() {
  window.dispatchEvent(new CustomEvent(OPEN_SETTINGS_EVENT));
}
