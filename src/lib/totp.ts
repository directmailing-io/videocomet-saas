/**
 * TOTP-Zwei-Faktor für Admin-Konten (RFC 6238, SHA-1, 6 Stellen, 30 s).
 *
 * Bewusst ohne zusätzliche npm-Abhängigkeit: HMAC-SHA1 + Base32 sind mit
 * node:crypto in ~60 Zeilen erledigt und kompatibel mit Google
 * Authenticator, Authy, 1Password, Apple Passwörter.
 *
 * Speicherung: Das Secret liegt AES-256-GCM-verschlüsselt in
 * `users.totp_secret_enc`. Der Schlüssel wird per HKDF aus COOKIE_SECRET
 * abgeleitet (Pflicht-Env, existiert seit Tag 1 — keine neue Variable, die
 * beim Deploy vergessen werden kann, vgl. SHARE_COOKIE_SECRET-Vorfall).
 *
 * Kurzlebige signierte Tokens (`signShortToken`) tragen den Zwischenstand
 * "Passwort korrekt, Code fehlt noch" bzw. "Setup läuft" zwischen zwei
 * Requests, ohne Server-State.
 */

import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  hkdfSync,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const STEP_SECONDS = 30;
const DIGITS = 6;

// ── Base32 ────────────────────────────────────────────────────────────────

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (let i = 0; i < buf.length; i++) {
    const byte = buf[i];
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(str: string): Buffer {
  const clean = str.toUpperCase().replace(/=+$/, "").replace(/[^A-Z2-7]/g, "");
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const ch of clean) {
    value = (value << 5) | BASE32_ALPHABET.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

// ── TOTP ──────────────────────────────────────────────────────────────────

export function generateTotpSecret(): string {
  // 20 Byte = 160 Bit, RFC-Empfehlung für SHA-1.
  return base32Encode(randomBytes(20));
}

function hotp(secret: Buffer, counter: number): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const mac = createHmac("sha1", secret).update(msg).digest();
  const offset = mac[mac.length - 1] & 0x0f;
  const code =
    ((mac[offset] & 0x7f) << 24) |
    ((mac[offset + 1] & 0xff) << 16) |
    ((mac[offset + 2] & 0xff) << 8) |
    (mac[offset + 3] & 0xff);
  return String(code % 10 ** DIGITS).padStart(DIGITS, "0");
}

export function totpCode(secretBase32: string, at: number = Date.now()): string {
  const counter = Math.floor(at / 1000 / STEP_SECONDS);
  return hotp(base32Decode(secretBase32), counter);
}

/**
 * Prüft einen Code mit ±1 Zeitfenster (Uhr-Drift zwischen Handy und Server).
 * Vergleich zeitkonstant.
 */
export function verifyTotp(secretBase32: string, code: string, at: number = Date.now()): boolean {
  const input = code.replace(/\s+/g, "");
  if (!/^\d{6}$/.test(input)) return false;
  const secret = base32Decode(secretBase32);
  const counter = Math.floor(at / 1000 / STEP_SECONDS);
  const inputBuf = Buffer.from(input);
  for (const delta of [-1, 0, 1]) {
    const expected = Buffer.from(hotp(secret, counter + delta));
    if (expected.length === inputBuf.length && timingSafeEqual(expected, inputBuf)) return true;
  }
  return false;
}

export function otpauthUrl(secretBase32: string, accountEmail: string, issuer = "VIDEOCOMET"): string {
  const label = encodeURIComponent(`${issuer}:${accountEmail}`);
  const params = new URLSearchParams({
    secret: secretBase32,
    issuer,
    algorithm: "SHA1",
    digits: String(DIGITS),
    period: String(STEP_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

// ── Verschlüsselung + signierte Kurzzeit-Tokens ───────────────────────────

function masterSecret(): Buffer {
  const v = process.env.COOKIE_SECRET;
  if (!v || v.length < 16) {
    throw new Error("COOKIE_SECRET fehlt oder ist zu kurz (für TOTP-Verschlüsselung nötig).");
  }
  return Buffer.from(v, "utf8");
}

function derivedKey(info: string): Buffer {
  return Buffer.from(hkdfSync("sha256", masterSecret(), "videocomet-totp-v1", info, 32));
}

export function encryptTotpSecret(secretBase32: string): string {
  const key = derivedKey("totp-secret");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(secretBase32, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString("base64"), tag.toString("base64"), ct.toString("base64")].join(":");
}

export function decryptTotpSecret(payload: string): string {
  const [ivB64, tagB64, ctB64] = payload.split(":");
  if (!ivB64 || !tagB64 || !ctB64) throw new Error("TOTP-Payload ungültig");
  const key = derivedKey("totp-secret");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(ctB64, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

/**
 * Signiertes Kurzzeit-Token: `base64url(json).base64url(hmac)`. Der
 * Payload ist NICHT geheim (nur signiert) — deshalb kommt ein Secret dort
 * nur verschlüsselt hinein (siehe Setup-Flow).
 */
export function signShortToken(payload: Record<string, unknown>, ttlSec: number, purpose: string): string {
  const body = Buffer.from(
    JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + ttlSec, p: purpose }),
  ).toString("base64url");
  const mac = createHmac("sha256", derivedKey(`token:${purpose}`)).update(body).digest("base64url");
  return `${body}.${mac}`;
}

export function verifyShortToken<T extends Record<string, unknown>>(
  token: string,
  purpose: string,
): (T & { exp: number }) | null {
  const [body, mac] = token.split(".");
  if (!body || !mac) return null;
  const expected = createHmac("sha256", derivedKey(`token:${purpose}`)).update(body).digest("base64url");
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as T & {
      exp: number;
      p: string;
    };
    if (parsed.p !== purpose) return null;
    if (typeof parsed.exp !== "number" || parsed.exp < Math.floor(Date.now() / 1000)) return null;
    return parsed;
  } catch {
    return null;
  }
}
