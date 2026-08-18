/**
 * Signiertes Cookie für Public-Review-Sessions (Migration 0059).
 *
 * Analog zu `share-cookie.ts`, aber mit `/review/<token>` Pfad-Scope.
 * Nutzt dasselbe SHARE_COOKIE_SECRET — kein neues Env-Var, weil kein
 * anderes Sicherheits-Modell (nur ein zweites signed-Cookie-Feature).
 *
 * Schema:  `<token>.<expEpochSec>.<hmacHex>`
 * Name:    `vc_review_<tokenPrefix8>` — pro-Token, damit paralleles
 *          Reviewen mehrerer Videos ohne Cookie-Kollision funktioniert.
 * Path:    `/review/<token>` — verhindert Leak an andere Review-Pfade.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import { requireShareCookieSecret } from "@/lib/share-cookie";

/** Cookie-Name pro Token: `vc_review_<first 8 of token>`. */
export function reviewCookieName(token: string): string {
  const prefix = token.slice(0, 8).replace(/[^A-Za-z0-9]/g, "");
  return `vc_review_${prefix}`;
}

function sign(payload: string): string {
  const secret = requireShareCookieSecret();
  return createHmac("sha256", secret).update(payload).digest("hex");
}

export interface SignedReviewCookie {
  value: string;
  name: string;
  maxAge: number;
  path: string;
  expires: Date;
}

/** Erzeugt ein signiertes Cookie. Default-TTL 24 h — Reviewer bleibt einen
 *  Arbeitstag ohne Passwort-Re-Prompt eingeloggt. */
export function signReviewCookie(
  token: string,
  ttlSec = 24 * 60 * 60,
): SignedReviewCookie {
  const expEpoch = Math.floor(Date.now() / 1000) + ttlSec;
  const payload = `${token}.${expEpoch}`;
  const hmac = sign(payload);
  return {
    value: `${payload}.${hmac}`,
    name: reviewCookieName(token),
    maxAge: ttlSec,
    path: `/review/${token}`,
    expires: new Date(expEpoch * 1000),
  };
}

/** Verifiziert das Cookie constant-time gegen SHARE_COOKIE_SECRET. */
export function verifyReviewCookie(
  token: string,
  value: string | undefined | null,
): boolean {
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
