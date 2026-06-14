/**
 * Crypto-zufälliger URL-safer Token für Public-Share-Links.
 *
 * Wird sowohl von `campaign_shares.token` (Migration 0022) als auch potenziell
 * von künftigen Share-Features genutzt. Alphabet matched das von
 * `webcam-share.ts` (URL-safe, ohne ähnlich aussehende Zeichen wie `0/O`,
 * `1/l/I`), damit Owner Tokens nicht beim Vorlesen verwechseln.
 */

/** Slug-Alphabet: URL-safe, ohne ähnlich aussehende Zeichen (0/O, 1/l/I). */
export const SHARE_TOKEN_ALPHABET =
  "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/**
 * Generiert einen kryptografisch zufälligen Share-Token. Default-Länge 24 →
 * mehr als ausreichende Entropie (57^24 ≈ 1.6e+42 Möglichkeiten) — Tokens
 * sind global eindeutig (Migration 0022 erzwingt das via UNIQUE-Index) und
 * gegen Erraten geschützt.
 *
 * Web Crypto ist auf Node 18+ als `globalThis.crypto` verfügbar; wir nutzen
 * es statt `Math.random`, da der Token gegen Erraten geschützt sein muss.
 */
export function generateShareToken(length = 24): string {
  if (!Number.isInteger(length) || length < 16 || length > 48) {
    throw new Error("share token length must be 16–48");
  }
  const bytes = new Uint8Array(length);
  globalThis.crypto.getRandomValues(bytes);
  let out = "";
  for (let i = 0; i < length; i += 1) {
    out += SHARE_TOKEN_ALPHABET[bytes[i] % SHARE_TOKEN_ALPHABET.length];
  }
  return out;
}

export default generateShareToken;
