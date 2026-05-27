/**
 * Tracking helpers shared by the /api/track/* endpoints.
 *
 * - hashIp() turns an IP into a stable, non-reversible identifier (SHA-256
 *   with a server-side secret), so we can count distinct visitors without
 *   storing personally identifying data — DSGVO-compliant.
 * - isBotUserAgent() flags well-known mail-client image proxies and generic
 *   bots so analytics can be filtered. We never reject the request; we just
 *   tag the event with `{ bot: true }`.
 * - getClientIp() picks the original client IP out of the proxy chain.
 * - transparentGif() returns a 1x1 GIF Buffer for tracking-pixel responses.
 */

import { createHash } from "node:crypto";
import type { NextRequest } from "next/server";

export function hashIp(ip: string, secret: string): string {
  if (!ip) return "";
  return createHash("sha256").update(`${ip}|${secret}`).digest("hex");
}

const BOT_PATTERNS = [
  /googleimageproxy/i,
  /yahoomailproxy/i,
  /yahoo!?\s*mail/i,
  /outlook/i,
  /microsoft\s*office/i,
  /gmail/i,
  /apple-mail-image/i,
  /\bbot\b/i,
  /crawler/i,
  /spider/i,
  /facebookexternalhit/i,
  /linkedinbot/i,
  /slackbot/i,
  /whatsapp/i,
  /telegrambot/i,
  /twitterbot/i,
  /headlesschrome/i,
];

export function isBotUserAgent(ua: string | null | undefined): boolean {
  if (!ua) return true;
  return BOT_PATTERNS.some((re) => re.test(ua));
}

export function getClientIp(req: NextRequest): string {
  // x-forwarded-for can be "client, proxy1, proxy2". First entry is the
  // original client. Fallback to other common headers, then to "" as a
  // last resort (we never throw — tracking must not fail).
  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  return (
    req.headers.get("x-real-ip") ??
    req.headers.get("cf-connecting-ip") ??
    req.headers.get("true-client-ip") ??
    ""
  );
}

// 1x1 transparent GIF (43 bytes). Decoded from the canonical base64.
const TRANSPARENT_GIF_BASE64 = "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

export function transparentGif(): Buffer {
  return Buffer.from(TRANSPARENT_GIF_BASE64, "base64");
}

/**
 * Cookie / tracking secret used for IP-hashing. Falls back to a stable but
 * weak value if COOKIE_SECRET is unset (tracking still works, just hashes
 * differ across deploys).
 */
export function getTrackingSecret(): string {
  return process.env.COOKIE_SECRET ?? "videocomet-tracking-default";
}
