/**
 * Signiertes Cookie für Public-Share-Sessions.
 *
 * Schema des Cookie-Werts:  `<token>.<expEpochSec>.<hmacHex>`
 *   - `<token>`        ist der Share-Token aus `campaign_shares.token`.
 *   - `<expEpochSec>`  ist der Ablauf als Unix-Sekunden.
 *   - `<hmacHex>`      ist HMAC-SHA256(SHARE_COOKIE_SECRET, "<token>.<expEpochSec>"),
 *                      hex-encodiert. Constant-Time verglichen mit
 *                      `timingSafeEqual` damit das Vorhandensein eines
 *                      gültigen Cookies nicht über Timing leakt.
 *
 * Cookie-Name ist token-präfixiert (`vc_share_<tokenPrefix8>`), damit der
 * gleiche Browser parallel mehrere Share-Sessions halten kann, ohne dass
 * sich Cookies gegenseitig überschreiben. Der Pfad-Scope (`/share/<token>`)
 * verhindert, dass das Cookie an andere Share-Pfade leakt.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

const SECRET_ENV = "SHARE_COOKIE_SECRET";

/**
 * Liest das Secret beim ersten Aufruf. Wir lazy-loaden, damit ein Tools-
 * Import in Test-Setups nicht direkt am Top-Level fehlschlägt. Die
 * Route-Handler rufen `requireSecret()` direkt im POST-Body auf, damit
 * der Modul-Load nicht crashed während Next.js die Routen scannt.
 */
export function requireShareCookieSecret(): string {
  const v = process.env[SECRET_ENV];
  if (!v || v.length < 32) {
    throw new Error(
      `Missing or too-short ${SECRET_ENV} (need ≥32 hex chars).`,
    );
  }
  return v;
}

/** Cookie-Name pro Token: `vc_share_<first 8 of token>`. */
export function cookieName(token: string): string {
  const prefix = token.slice(0, 8).replace(/[^A-Za-z0-9]/g, "");
  return `vc_share_${prefix}`;
}

/** Signiert `<token>.<expEpoch>` mit dem SHARE_COOKIE_SECRET. */
function sign(payload: string): string {
  const secret = requireShareCookieSecret();
  return createHmac("sha256", secret).update(payload).digest("hex");
}

export interface SignedShareCookie {
  /** Cookie-Wert (`<token>.<expEpoch>.<hmac>`). */
  value: string;
  /** Cookie-Name (`vc_share_<prefix>`). */
  name: string;
  /** Max-Age in Sekunden (= ttlSec). */
  maxAge: number;
  /** Pfad-Scope (`/share/<token>`). */
  path: string;
  /** Ablauf-Date für Cookie-Header. */
  expires: Date;
}

/**
 * Erzeugt einen signierten Cookie-Wert + Metadaten. `ttlSec` Default 24 h.
 */
export function signShareCookie(
  token: string,
  ttlSec = 24 * 60 * 60,
): SignedShareCookie {
  const expEpoch = Math.floor(Date.now() / 1000) + ttlSec;
  const payload = `${token}.${expEpoch}`;
  const hmac = sign(payload);
  return {
    value: `${payload}.${hmac}`,
    name: cookieName(token),
    maxAge: ttlSec,
    path: `/share/${token}`,
    expires: new Date(expEpoch * 1000),
  };
}

/**
 * Verifiziert ein Cookie für `token`. Returnt true nur bei:
 *   - korrekt geformter Wert (genau drei Segmente)
 *   - Token-Teil matched
 *   - Ablauf in der Zukunft
 *   - HMAC matched constant-time
 */
export function verifyShareCookie(token: string, value: string | undefined | null): boolean {
  if (!value) return false;
  const parts = value.split(".");
  if (parts.length !== 3) return false;
  const [cookieToken, expStr, mac] = parts;
  if (cookieToken !== token) return false;
  const exp = Number.parseInt(expStr, 10);
  if (!Number.isFinite(exp) || exp <= Math.floor(Date.now() / 1000)) {
    return false;
  }
  let expected: string;
  try {
    expected = sign(`${cookieToken}.${expStr}`);
  } catch {
    return false;
  }
  if (expected.length !== mac.length) return false;
  try {
    return timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(mac, "hex"));
  } catch {
    return false;
  }
}
