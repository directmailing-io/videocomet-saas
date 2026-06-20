/**
 * Stripe-style HMAC-SHA256-Signaturen für Outgoing-Webhooks.
 *
 * Format des `X-VideoComet-Signature`-Headers:
 *   t=<unix-seconds>,v1=<hex-hmac-sha256(secret, "t.rawBody")>
 *
 * - `t` ist die UTC-Sekunden-Zeit zum Sign-Zeitpunkt. Empfänger MÜSSEN
 *   prüfen, dass |now - t| ≤ Toleranz (default 5 min), um Replay-Attacks
 *   zu blocken.
 * - `v1` ist das HMAC der konkatenierten String `${t}.${rawBody}`.
 *   Wichtig: `rawBody` ist der EXAKTE Byte-String, den wir auch über die
 *   Leitung schicken — kein Re-Serialize beim Empfänger.
 *
 * `verifySignature` ist primär für Tests und für ein potentielles Self-
 * Ping/Receiving-Webhooks-Feature gedacht. Für Outgoing genügen wir uns
 * der Signing-Hälfte.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

export interface SignResult {
  t: number;
  v1: string;
  header: string;
}

/**
 * Berechnet die Signatur für `rawBody` mit `secret`. Wenn `ts` nicht
 * gegeben wird, nimmt die Funktion `floor(Date.now()/1000)`. Tests
 * können `ts` deterministisch setzen.
 */
export function signRawBody(
  secret: string,
  rawBody: string,
  ts?: number,
): SignResult {
  const t = ts ?? Math.floor(Date.now() / 1000);
  const v1 = createHmac("sha256", secret).update(`${t}.${rawBody}`).digest("hex");
  return { t, v1, header: `t=${t},v1=${v1}` };
}

interface ParsedHeader {
  t: number;
  v1: string;
}

/**
 * Parst `t=…,v1=…`. Whitespace zwischen Komma-Tokens wird toleriert,
 * Reihenfolge ist egal. Unbekannte Tokens werden ignoriert (forward-
 * compatible mit `v2=…` in der Zukunft).
 */
function parseHeader(headerValue: string): ParsedHeader | null {
  let t: number | null = null;
  let v1: string | null = null;
  for (const rawPart of headerValue.split(",")) {
    const part = rawPart.trim();
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    const key = part.slice(0, eq);
    const val = part.slice(eq + 1);
    if (key === "t") {
      if (!/^\d+$/.test(val)) return null;
      t = Number.parseInt(val, 10);
    } else if (key === "v1") {
      if (!/^[0-9a-f]+$/i.test(val)) return null;
      v1 = val.toLowerCase();
    }
  }
  if (t === null || v1 === null) return null;
  return { t, v1 };
}

export interface VerifyOptions {
  /** Default: 300 (5 min). */
  toleranceSec?: number;
  /** Default: `Date.now()`. Tests können das injizieren. */
  nowMs?: number;
}

/**
 * Prüft den Signatur-Header gegen den `rawBody`. Verwirft, wenn:
 *   - Header malformed
 *   - `|now - t|` größer als `toleranceSec`
 *   - HMAC nicht matched (`timingSafeEqual`, konstant in der Zeit)
 *
 * Gibt true zurück bei gültiger Signatur, sonst false (wirft nicht).
 */
export function verifySignature(
  secret: string,
  rawBody: string,
  headerValue: string,
  opts: VerifyOptions = {},
): boolean {
  const parsed = parseHeader(headerValue);
  if (!parsed) return false;

  const toleranceSec = opts.toleranceSec ?? 300;
  const nowMs = opts.nowMs ?? Date.now();
  const drift = Math.abs(Math.floor(nowMs / 1000) - parsed.t);
  if (drift > toleranceSec) return false;

  const expected = createHmac("sha256", secret)
    .update(`${parsed.t}.${rawBody}`)
    .digest("hex");

  // timingSafeEqual erfordert gleich-lange Buffer; bei Längen-Mismatch
  // schon hier raus (z.B. Empfänger sendet Hex-Stub).
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(parsed.v1, "hex");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
