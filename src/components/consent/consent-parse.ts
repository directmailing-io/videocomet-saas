/**
 * Reine Parser-Funktion für den Consent-Cookie — kein `"use client"`,
 * damit Server-Components (Root-Layout via next/headers) und der
 * Client-Store denselben Code teilen können. Kein DOM-Zugriff.
 *
 * Toleriert v1-Bestandscookies (aus der Zeit vor der Marketing-Kategorie):
 * fehlt `marketing`, wird `false` als Default gemappt — der Banner
 * verschwindet trotzdem sofort nach Reload. So müssen Bestandsnutzer
 * nicht noch mal klicken, bekommen aber auch keinen Marketing-Pixel
 * ohne aktive Zustimmung untergeschoben.
 */

export const CONSENT_COOKIE = "vc_consent";
export const CONSENT_VERSION = 2;
export const CONSENT_MAX_AGE_DAYS = 180;

export interface ConsentCategories {
  necessary: true;
  statistics: boolean;
  marketing: boolean;
}

export interface ConsentState {
  version: number;
  timestamp: string;
  categories: ConsentCategories;
}

export function parseConsentCookie(
  raw: string | undefined | null,
): ConsentState | null {
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
