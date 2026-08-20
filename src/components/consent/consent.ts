"use client";

/**
 * Leichtgewichtiger Consent-Store (§ 25 TDDDG / Art. 6 DSGVO).
 *
 * Die Einwilligung selbst wird in einem First-Party-Cookie gespeichert —
 * das ist ohne Einwilligung zulaessig (technisch erforderlich, um die
 * Wahl des Nutzers zu respektieren). Version hochzaehlen, wenn neue
 * Kategorien/Dienste dazukommen: dann wird der Banner erneut gezeigt.
 */

export const CONSENT_COOKIE = "vc_consent";
/** v2: Marketing-Kategorie (Meta Pixel + CAPI) neu hinzugefügt. */
export const CONSENT_VERSION = 2;
export const CONSENT_MAX_AGE_DAYS = 180;
export const OPEN_SETTINGS_EVENT = "vc:open-cookie-settings";
export const CONSENT_CHANGED_EVENT = "vc:consent-changed";

export interface ConsentCategories {
  /** Immer true — Session, Consent-Cookie, Bot-Schutz. */
  necessary: true;
  /** Statistik/Analyse (derzeit keine Dienste aktiv, aber vorbereitet). */
  statistics: boolean;
  /** Marketing/Retargeting: Meta Pixel + Conversions API. */
  marketing: boolean;
}

export interface ConsentState {
  version: number;
  timestamp: string;
  categories: ConsentCategories;
}

/**
 * Parser für den Consent-Cookie-Wert, ohne document-Abhängigkeit — damit
 * derselbe Code sowohl serverseitig (SSR-Layout-Read via next/headers) als
 * auch clientseitig läuft. Toleriert v1-Cookies (Bestandsnutzer aus der
 * Zeit vor Marketing-Kategorie): wenn eine ältere, aber gültige Version
 * vorliegt, wird sie in das aktuelle Schema hochgezogen (marketing=false
 * als Default). So verschwindet der Banner sofort nach Reload — auch wenn
 * der User in dieser Session noch nicht neu geklickt hat.
 */
export function parseConsentCookie(raw: string | undefined): ConsentState | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(decodeURIComponent(raw)) as Partial<ConsentState> & {
      categories?: Partial<ConsentCategories>;
    };
    const cats = parsed.categories;
    if (!cats || typeof cats.statistics !== "boolean") return null;
    const marketing =
      typeof cats.marketing === "boolean" ? cats.marketing : false;
    return {
      version: CONSENT_VERSION,
      timestamp:
        typeof parsed.timestamp === "string"
          ? parsed.timestamp
          : new Date().toISOString(),
      categories: {
        necessary: true,
        statistics: cats.statistics,
        marketing,
      },
    };
  } catch {
    return null;
  }
}

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
