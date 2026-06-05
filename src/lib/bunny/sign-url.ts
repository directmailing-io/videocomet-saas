/**
 * Bunny.net Token-Authentication URL signer.
 *
 * Bunny pullzones (including Stream libraries) can be locked down with
 * "Token Authentication". When enabled, every CDN URL must carry a
 * `?token=<sig>&expires=<unix>` pair, where the signature is computed as:
 *
 *     base64url( sha256_raw( securityKey + url_path + expires ) )
 *
 * Notes verified against Bunny's CDN docs
 * (https://docs.bunny.net/docs/cdn-token-authentication):
 *   - `securityKey` is the per-pullzone "Token Authentication Key" — for
 *     our Stream library it lives in `BUNNY_STREAM_TOKEN_AUTH_KEY`.
 *   - `url_path` is the URL's pathname (leading "/" included), NO query.
 *   - `expires` is a Unix-seconds timestamp (string-concat as base-10).
 *   - The hash is raw SHA-256 bytes, base64-encoded, then URL-safe-ified
 *     (`+` → `-`, `/` → `_`, trailing `=` stripped). NOT hex — hex would
 *     also produce a 200 in some Bunny configs but base64url is the
 *     documented and universally accepted form for Stream HLS playback.
 *
 * Only `vz-*.b-cdn.net/<guid>/playlist.m3u8` URLs (and other URLs hosted
 * on the configured Stream CDN) are signed — Bunny Storage CDN URLs
 * (videocomet-pdf.b-cdn.net etc.) have a separate token-auth setting and
 * are not handled here.
 */

import { createHash } from "node:crypto";
import { getBunnyStreamEnv } from "./env";

/** Default TTL for signed playback URLs (1 hour). */
export const DEFAULT_HLS_SIGN_TTL_SEC = 3600;

/**
 * Returns `true` if the given URL looks like it belongs to our Bunny Stream
 * CDN (vz-*.b-cdn.net) and therefore *might* need token-auth signing.
 */
export function isBunnyStreamUrl(rawUrl: string): boolean {
  try {
    const u = new URL(rawUrl);
    const env = getBunnyStreamEnv();
    if (u.hostname === env.cdnHostname) return true;
    // Defensive fallback: any vz-*.b-cdn.net host.
    return /^vz-[a-z0-9-]+\.b-cdn\.net$/i.test(u.hostname);
  } catch {
    return false;
  }
}

/**
 * Signs a Bunny Stream URL (HLS playlist, MP4 fallback, thumbnail, …) with
 * the pullzone token-auth key.
 *
 * Behaviour:
 *   - If the URL is not a Bunny Stream URL → returned unchanged.
 *   - If `BUNNY_STREAM_TOKEN_AUTH_KEY` is unset (token-auth disabled on the
 *     pullzone) → returned unchanged. This keeps dev envs working without
 *     copying production secrets.
 *   - Existing `?token=`/`?expires=` query params are stripped before
 *     re-signing — callers can safely pass an already-signed URL.
 */
export function signStreamHlsUrl(
  rawUrl: string,
  ttlSec: number = DEFAULT_HLS_SIGN_TTL_SEC,
): string {
  if (!isBunnyStreamUrl(rawUrl)) return rawUrl;

  const env = getBunnyStreamEnv();
  if (!env.tokenAuthKey) {
    // No key configured — return as-is; the request will succeed only if
    // token-auth is disabled on the pullzone.
    return rawUrl;
  }

  const u = new URL(rawUrl);
  // Strip any prior signing params so we never double-sign.
  u.searchParams.delete("token");
  u.searchParams.delete("expires");

  const expires = Math.floor(Date.now() / 1000) + Math.max(60, Math.floor(ttlSec));
  const path = u.pathname; // includes leading "/"

  const hash = createHash("sha256");
  hash.update(env.tokenAuthKey + path + String(expires));
  const sig = hash
    .digest("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");

  // Bunny accepts the params in either order — we use token,expires for
  // readability. Insert at the FRONT so any existing query (?v=720 etc.)
  // stays intact and human-readable.
  u.searchParams.set("token", sig);
  u.searchParams.set("expires", String(expires));
  return u.toString();
}
