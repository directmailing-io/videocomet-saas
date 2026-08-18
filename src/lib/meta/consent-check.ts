/**
 * Server-Side-Consent-Reader für Meta Pixel/CAPI.
 *
 * Der Consent-Banner (src/components/consent/CookieBanner.tsx) speichert die
 * Wahl als First-Party-Cookie `vc_consent` (Domain .videocomet.de). Bevor wir
 * serverseitig ein CAPI-Event senden, prüfen wir dass der User Marketing
 * akzeptiert hat — sonst dürfen wir nach TDDDG §25 nichts an Meta übertragen,
 * auch nicht via CAPI.
 */

import type { NextRequest } from "next/server";

const CONSENT_COOKIE = "vc_consent";
const CONSENT_VERSION = 2;

interface ParsedConsent {
  version: number;
  categories: {
    necessary: boolean;
    statistics: boolean;
    marketing: boolean;
  };
}

/** Parse den `vc_consent`-Cookie-Wert. NULL wenn fehlt/kaputt/veraltet. */
function parse(raw: string | null | undefined): ParsedConsent | null {
  if (!raw) return null;
  try {
    const decoded = decodeURIComponent(raw);
    const obj = JSON.parse(decoded) as Partial<ParsedConsent>;
    if (obj?.version !== CONSENT_VERSION) return null;
    if (typeof obj.categories?.marketing !== "boolean") return null;
    if (typeof obj.categories?.statistics !== "boolean") return null;
    return obj as ParsedConsent;
  } catch {
    return null;
  }
}

/** Liest den Consent-Cookie aus einem Next-Request. */
export function readConsentFromRequest(req: NextRequest): ParsedConsent | null {
  return parse(req.cookies.get(CONSENT_COOKIE)?.value);
}

/** Liest den Consent-Cookie aus einem generischen Cookie-Header-Value. */
export function readConsentFromCookieHeader(
  cookieHeader: string | null | undefined,
): ParsedConsent | null {
  if (!cookieHeader) return null;
  const match = cookieHeader
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${CONSENT_COOKIE}=`));
  if (!match) return null;
  return parse(match.slice(CONSENT_COOKIE.length + 1));
}

/** Convenience: `true` wenn Marketing-Kategorie aktiv. */
export function hasMarketingConsent(
  req: NextRequest | null | undefined,
  cookieHeader?: string | null,
): boolean {
  const parsed = req ? readConsentFromRequest(req) : parse(cookieHeader);
  return parsed?.categories.marketing === true;
}
