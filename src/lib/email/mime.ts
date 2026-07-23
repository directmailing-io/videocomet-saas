/**
 * RFC-konformer MIME-Builder für Outreach-Mails (Kontrakt Kapitel 4).
 *
 * Erzeugt eine multipart/alternative-Nachricht (plain + html) mit:
 *  - eigener Message-ID (`<uuid@videocomet.de>`, als Parameter — VOR dem
 *    Versand generiert, für deterministische NDR-Korrelation)
 *  - `List-Unsubscribe: <mailto:…>, <{APP_URL}/abmelden/{token}>`
 *  - `List-Unsubscribe-Post: List-Unsubscribe=One-Click` (RFC 8058)
 *
 * Output:
 *  - `raw`    → Roh-MIME (CRLF) für nodemailer (`sendMail({ raw })`)
 *  - `base64` → base64-encodetes MIME für Graph `sendMail` (MIME-Format)
 */

export interface BuildOutreachMimeInput {
  /** Absender-Anzeigename (optional). */
  fromName?: string | null;
  fromAddress: string;
  toAddress: string;
  subject: string;
  html: string;
  text: string;
  /**
   * Eigene Message-ID. Mit oder ohne spitze Klammern —
   * `uuid@videocomet.de` und `<uuid@videocomet.de>` sind beide ok.
   */
  messageId: string;
  /** mailto-Ziel für List-Unsubscribe (Postfach des Kunden). */
  unsubscribeMailto: string;
  /** HTTPS-Abmeldelink `{APP_URL}/abmelden/{token}`. */
  unsubscribeUrl: string;
  /** Override für Tests; default `new Date()`. */
  date?: Date;
}

export interface BuiltMime {
  raw: string;
  base64: string;
}

const CRLF = "\r\n";

/** RFC-2047-Encoding für Header-Werte mit Nicht-ASCII (UTF-8, Base64). */
function encodeHeaderWord(value: string): string {
  // eslint-disable-next-line no-control-regex
  if (/^[\x20-\x7e]*$/.test(value)) return value;
  const b64 = Buffer.from(value, "utf-8").toString("base64");
  return `=?UTF-8?B?${b64}?=`;
}

/** Display-Name für From/To: quoted, wenn Sonderzeichen enthalten. */
function formatAddress(name: string | null | undefined, address: string): string {
  const trimmed = (name ?? "").trim();
  if (!trimmed) return address;
  const encoded = encodeHeaderWord(trimmed);
  // Nur quoten, wenn nicht schon RFC-2047-encodet und Spezialzeichen drin.
  const display =
    encoded.startsWith("=?") || /^[A-Za-z0-9 ._-]*$/.test(encoded)
      ? encoded
      : `"${encoded.replace(/"/g, '\\"')}"`;
  return `${display} <${address}>`;
}

function normalizeMessageId(id: string): string {
  const t = id.trim();
  return t.startsWith("<") ? t : `<${t}>`;
}

/** Base64-Body mit 76-Zeichen-Zeilenumbruch (RFC 2045). */
function base64Body(content: string): string {
  const b64 = Buffer.from(content, "utf-8").toString("base64");
  const lines: string[] = [];
  for (let i = 0; i < b64.length; i += 76) {
    lines.push(b64.slice(i, i + 76));
  }
  return lines.join(CRLF);
}

function randomBoundary(): string {
  let rnd = "";
  for (let i = 0; i < 24; i++) {
    rnd += "abcdefghijklmnopqrstuvwxyz0123456789"[
      Math.floor(Math.random() * 36)
    ];
  }
  return `=_vc_${rnd}`;
}

export function buildOutreachMime(input: BuildOutreachMimeInput): BuiltMime {
  const boundary = randomBoundary();
  const date = input.date ?? new Date();

  const headers: string[] = [
    `From: ${formatAddress(input.fromName, input.fromAddress)}`,
    `To: ${input.toAddress}`,
    `Subject: ${encodeHeaderWord(input.subject)}`,
    `Date: ${date.toUTCString().replace("GMT", "+0000")}`,
    `Message-ID: ${normalizeMessageId(input.messageId)}`,
    `List-Unsubscribe: <mailto:${input.unsubscribeMailto}>, <${input.unsubscribeUrl}>`,
    `List-Unsubscribe-Post: List-Unsubscribe=One-Click`,
    `MIME-Version: 1.0`,
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
  ];

  const raw = [
    headers.join(CRLF),
    "",
    // Preamble für Nicht-MIME-Clients (praktisch nie sichtbar).
    "This is a multi-part message in MIME format.",
    `--${boundary}`,
    `Content-Type: text/plain; charset=UTF-8`,
    `Content-Transfer-Encoding: base64`,
    "",
    base64Body(input.text),
    `--${boundary}`,
    `Content-Type: text/html; charset=UTF-8`,
    `Content-Transfer-Encoding: base64`,
    "",
    base64Body(input.html),
    `--${boundary}--`,
    "",
  ].join(CRLF);

  return {
    raw,
    base64: Buffer.from(raw, "utf-8").toString("base64"),
  };
}
