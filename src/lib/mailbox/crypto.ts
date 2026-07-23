/**
 * Symmetrische Verschlüsselung für Postfach-Credentials (SMTP-Passwörter,
 * M365-Refresh-Tokens).
 *
 * Algorithmus: AES-256-GCM — identisch zu `src/lib/crm/crypto.ts`, aber mit
 * eigenem Master-Key aus `process.env.MAILBOX_KEY_SECRET` (64-Hex-String
 * = 32 Byte), damit CRM- und Mailbox-Secrets unabhängig rotiert werden
 * können.
 *
 * Speicherformat:
 *   `<base64(iv)>:<base64(authTag)>:<base64(ciphertext)>`
 *
 * IV ist random 12 Byte (NIST-Empfehlung für GCM). authTag ist 16 Byte.
 */

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const SECRET_ENV = "MAILBOX_KEY_SECRET";
const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;
const KEY_BYTES = 32;
const KEY_HEX_LEN = KEY_BYTES * 2;

function getMasterKey(): Buffer {
  const v = process.env[SECRET_ENV];
  if (!v) {
    throw new Error(
      `Missing ${SECRET_ENV} env var. Generate with: openssl rand -hex 32`,
    );
  }
  if (v.length !== KEY_HEX_LEN || !/^[0-9a-fA-F]+$/.test(v)) {
    throw new Error(
      `${SECRET_ENV} must be ${KEY_HEX_LEN} hex chars (${KEY_BYTES} bytes). ` +
        `Got length=${v.length}.`,
    );
  }
  return Buffer.from(v, "hex");
}

/**
 * Boot-Time-Validator (Worker-Boot + erste Nutzung), damit ein fehlendes/
 * falsch gesetztes `MAILBOX_KEY_SECRET` sofort sichtbar wird und nicht erst
 * beim ersten Versand explodiert.
 */
export function assertMailboxSecret(): void {
  getMasterKey();
}

export function encryptMailboxSecret(plaintext: string): string {
  if (typeof plaintext !== "string" || plaintext.length === 0) {
    throw new Error("encryptMailboxSecret: plaintext is required");
  }
  const key = getMasterKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString("base64")}:${authTag.toString("base64")}:${ciphertext.toString("base64")}`;
}

export function decryptMailboxSecret(stored: string): string {
  if (typeof stored !== "string" || stored.length === 0) {
    throw new Error("decryptMailboxSecret: stored value is required");
  }
  const parts = stored.split(":");
  if (parts.length !== 3) {
    throw new Error(
      "decryptMailboxSecret: malformed payload (expected `iv:authTag:ciphertext` base64)",
    );
  }
  const key = getMasterKey();
  const iv = Buffer.from(parts[0]!, "base64");
  const authTag = Buffer.from(parts[1]!, "base64");
  const ciphertext = Buffer.from(parts[2]!, "base64");
  if (iv.length !== IV_BYTES) {
    throw new Error(
      `decryptMailboxSecret: IV has unexpected length ${iv.length} (expected ${IV_BYTES})`,
    );
  }
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  const plaintext = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);
  return plaintext.toString("utf8");
}
