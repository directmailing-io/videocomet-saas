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
export const CONSENT_VERSION = 1;
export const CONSENT_MAX_AGE_DAYS = 180;
export const OPEN_SETTINGS_EVENT = "vc:open-cookie-settings";

export interface ConsentCategories {
  /** Immer true — Session, Consent-Cookie, Bot-Schutz. */
  necessary: true;
  /** Statistik/Analyse. Derzeit keine Dienste aktiv, aber vorbereitet. */
  statistics: boolean;
}

export interface ConsentState {
  version: number;
  timestamp: string;
  categories: ConsentCategories;
}

export function readConsent(): ConsentState | null {
  if (typeof document === "undefined") return null;
  const raw = document.cookie
    .split("; ")
    .find((c) => c.startsWith(`${CONSENT_COOKIE}=`))
    ?.slice(CONSENT_COOKIE.length + 1);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(decodeURIComponent(raw)) as ConsentState;
    if (parsed.version !== CONSENT_VERSION) return null;
    if (typeof parsed.categories?.statistics !== "boolean") return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writeConsent(categories: {
  statistics: boolean;
}): ConsentState {
  const state: ConsentState = {
    version: CONSENT_VERSION,
    timestamp: new Date().toISOString(),
    categories: { necessary: true, statistics: categories.statistics },
  };
  const maxAge = CONSENT_MAX_AGE_DAYS * 24 * 60 * 60;
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${CONSENT_COOKIE}=${encodeURIComponent(
    JSON.stringify(state),
  )}; Max-Age=${maxAge}; Path=/; SameSite=Lax${secure}`;
  window.dispatchEvent(new CustomEvent("vc:consent-changed", { detail: state }));
  return state;
}

/** Fuer kuenftige Skript-Gates: hasConsent("statistics") vor dem Laden pruefen. */
export function hasConsent(category: keyof ConsentCategories): boolean {
  if (category === "necessary") return true;
  return readConsent()?.categories[category] === true;
}

export function openCookieSettings() {
  window.dispatchEvent(new CustomEvent(OPEN_SETTINGS_EVENT));
}
