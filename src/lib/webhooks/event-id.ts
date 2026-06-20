/**
 * Erzeugt zeitgeordnete, eindeutige Event-IDs der Form `evt_<26-chars>`.
 *
 * Format-Entscheidung:
 *   - UUIDv7: ersten 48 Bit sind Unix-Millisekunden → IDs sind über die
 *     Zeit aufsteigend sortierbar, was Empfängern die Verarbeitung in
 *     Reihenfolge erleichtert und in unseren DB-Logs (`webhook_deliveries`)
 *     gute B-Tree-Lokalität ergibt.
 *   - Crockford-Base32 (ohne I/L/O/U, deshalb ambiguity-frei beim
 *     Vorlesen) statt Hex: kompakter (26 vs. 32 Zeichen für 128 Bit), aber
 *     vollständig in URLs einbettbar, ohne Padding.
 *   - Prefix `evt_` für menschliche Lesbarkeit/Filterung in Logs.
 *
 * Inline-Implementation:
 *   - `crypto.randomBytes(10)` für die 74 random-Bits (UUIDv7 hat 48 Bit
 *     Time + 4 Bit Version + 12 Bit rand_a + 2 Bit Variant + 62 Bit
 *     rand_b ⇒ insgesamt 74 random-Bits, die in 10 Bytes hinein passen
 *     wenn man die festen Bits an den richtigen Positionen patcht).
 *   - Wir bauen 16 Bytes (= 128 Bit), enkodieren als Crockford-Base32.
 *
 * Keine zusätzlichen Dependencies (kein `uuid`-Paket nötig, obwohl es
 * im Projekt verfügbar wäre — die UUIDv7-Unterstützung dort ist neu und
 * wir wollen die Format-Garantie hier explizit dokumentieren).
 */

import { randomBytes } from "node:crypto";

const CROCKFORD_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/**
 * Setzt das obere `bits`-bit Suffix einer Position. Hilft beim Patchen
 * der Versions- und Variant-Bits in den UUIDv7-Bytes.
 */
function patchByte(b: number, mask: number, value: number): number {
  return ((b & ~mask) | value) & 0xff;
}

/**
 * Kodiert 16 Bytes (= 128 Bit) als 26-stelliges Crockford-Base32. Da
 * 26 × 5 = 130 Bit ≥ 128 Bit ist, paddet die letzte Stelle mit Nullbits
 * — das tut UUIDv7 nicht weh (rand_b sind zufällige Bits am Ende).
 */
function encodeBase32(bytes: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    value = (value << 8) | bytes[i]!;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += CROCKFORD_ALPHABET[(value >>> bits) & 0x1f];
    }
  }
  if (bits > 0) {
    out += CROCKFORD_ALPHABET[(value << (5 - bits)) & 0x1f];
  }
  return out;
}

/**
 * Monotonie-Garantie innerhalb derselben Millisekunde: wir merken die
 * letzte verwendete Time-Component und schieben nach vorn, wenn der
 * Aufrufer zwei IDs in derselben ms generiert. So bleibt die
 * Sortierung über `id` deterministisch zeitlich aufsteigend, auch bei
 * Bursts.
 */
let lastMs = 0;

/**
 * @returns z.B. `evt_01HXZQ8M7K1N3P5R7S9V1W2X4Y` — 4-stelliger Prefix +
 *   26 Crockford-Base32 Zeichen ohne I/L/O/U.
 */
export function generateEventId(): string {
  let ms = Date.now();
  if (ms <= lastMs) ms = lastMs + 1;
  lastMs = ms;

  const rand = randomBytes(10); // 80 random-Bits
  const buf = Buffer.alloc(16);

  // Bytes 0-5: unix_ts_ms (48 bit big-endian)
  buf[0] = (ms / 2 ** 40) & 0xff;
  buf[1] = (ms / 2 ** 32) & 0xff;
  buf[2] = (ms / 2 ** 24) & 0xff;
  buf[3] = (ms / 2 ** 16) & 0xff;
  buf[4] = (ms / 2 ** 8) & 0xff;
  buf[5] = ms & 0xff;

  // Bytes 6-7: ver (4 bit = 0b0111) + rand_a (12 bit)
  buf[6] = patchByte(rand[0]!, 0xf0, 0x70);
  buf[7] = rand[1]!;

  // Bytes 8-15: var (2 bit = 0b10) + rand_b (62 bit)
  buf[8] = patchByte(rand[2]!, 0xc0, 0x80);
  buf[9] = rand[3]!;
  buf[10] = rand[4]!;
  buf[11] = rand[5]!;
  buf[12] = rand[6]!;
  buf[13] = rand[7]!;
  buf[14] = rand[8]!;
  buf[15] = rand[9]!;

  return `evt_${encodeBase32(buf)}`;
}
