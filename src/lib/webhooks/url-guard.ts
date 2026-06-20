/**
 * SSRF-Defense für Outgoing-Webhooks.
 *
 * Pipeline (in der Reihenfolge):
 *   1. URL-Parsing (rejects malformed)
 *   2. Schema-Whitelist: `https:` (immer), `http:` nur bei
 *      `WEBHOOK_ALLOW_HTTP=1` (für lokales Dev / Mock-Hooks).
 *   3. Hostname-Block-Suffixe: `localhost`, `*.local`, `*.localhost`.
 *   4. Port-Whitelist: 80/443 in Dev, nur 443 in Production.
 *   5. Numeric-only Hostnames blocken (decimal/hex/oktal-Form als
 *      IP-Tarnung — Browser/`URL`-Parser akzeptieren das).
 *   6. DNS-Lookup auf ALLE Adressen (`{ all: true }`) und Match gegen
 *      eine inline-CIDR-Blocklist (kein extra Paket):
 *        IPv4: 0.0.0.0/8, 10/8, 100.64/10, 127/8, 169.254/16, 172.16/12,
 *              192.168/16, 224/4, 240/4
 *        IPv6: ::1/128, fc00::/7, fe80::/10, ::ffff:0:0/96 (IPv4-mapped
 *              → re-check als IPv4)
 *
 * Aufruf-Zeitpunkte:
 *   - In der "Endpoint anlegen/aktualisieren"-Route (frühe Fehlermeldung).
 *   - VOR JEDER Delivery im Worker (DNS-Rebinding-Defense — der gleiche
 *     Hostname kann beim zweiten Lookup eine private IP zurückgeben).
 *
 * Worker sollte zusätzlich `pinnedFetch(url)` benutzen, das mit
 * `undici.Agent.connect.lookup` die DNS-Resolution beim Connect
 * fix-pinned und die TOCTOU-Lücke zwischen Validate und Connect
 * schließt.
 */

import { lookup as dnsLookup } from "node:dns/promises";
import type { LookupAddress } from "node:dns";
import { Agent, type Dispatcher } from "undici";
import { WebhookUrlBlockedError } from "./types";

type GuardResult = { ok: true; url: URL } | { ok: false; reason: string };

// IPv4-Blocklist als (prefix, bits) — Match ist auf den oberen `bits`.
const IPV4_BLOCKS: Array<[string, number]> = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.168.0.0", 16],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
];

// IPv6-Blocklist als (prefix, bits)
const IPV6_BLOCKS: Array<[string, number]> = [
  ["::1", 128],
  ["fc00::", 7],
  ["fe80::", 10],
];

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let out = 0;
  for (const part of parts) {
    if (!/^\d+$/.test(part)) return null;
    const n = Number.parseInt(part, 10);
    if (n < 0 || n > 255) return null;
    out = (out * 256 + n) >>> 0;
  }
  return out >>> 0;
}

function ipv4InCidr(ip: string, cidr: string, bits: number): boolean {
  const a = ipv4ToInt(ip);
  const b = ipv4ToInt(cidr);
  if (a === null || b === null) return false;
  if (bits === 0) return true;
  const mask = bits === 32 ? 0xffffffff : (0xffffffff << (32 - bits)) >>> 0;
  return (a & mask) === (b & mask);
}

/**
 * Expandiert eine IPv6-Adresse zu 8 16-bit Words. Behandelt `::`
 * Compression und IPv4-mapped (`::ffff:1.2.3.4`).
 */
function ipv6ToWords(ip: string): number[] | null {
  const v4Mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  if (v4Mapped) {
    const intVal = ipv4ToInt(v4Mapped[1]!);
    if (intVal === null) return null;
    const hi = (intVal >>> 16) & 0xffff;
    const lo = intVal & 0xffff;
    return [0, 0, 0, 0, 0, 0xffff, hi, lo];
  }

  const dblIdx = ip.indexOf("::");
  let head: string[];
  let tail: string[];
  if (dblIdx === -1) {
    head = ip.split(":");
    tail = [];
  } else {
    head = ip.slice(0, dblIdx).split(":").filter((s) => s !== "");
    tail = ip.slice(dblIdx + 2).split(":").filter((s) => s !== "");
  }

  const fillCount = 8 - head.length - tail.length;
  if (fillCount < 0) return null;
  const words: number[] = [];
  for (const part of head) {
    if (!/^[0-9a-f]{1,4}$/i.test(part)) return null;
    words.push(Number.parseInt(part, 16));
  }
  for (let i = 0; i < fillCount; i++) words.push(0);
  for (const part of tail) {
    if (!/^[0-9a-f]{1,4}$/i.test(part)) return null;
    words.push(Number.parseInt(part, 16));
  }
  return words.length === 8 ? words : null;
}

function ipv6InCidr(ip: string, cidr: string, bits: number): boolean {
  const a = ipv6ToWords(ip);
  const b = ipv6ToWords(cidr);
  if (!a || !b) return false;
  let remaining = bits;
  for (let i = 0; i < 8; i++) {
    if (remaining <= 0) return true;
    const take = Math.min(16, remaining);
    const mask = take === 16 ? 0xffff : ((0xffff << (16 - take)) & 0xffff);
    if ((a[i]! & mask) !== (b[i]! & mask)) return false;
    remaining -= take;
  }
  return true;
}

function isIpv4Mapped(words: number[]): { mapped: true; ipv4: string } | { mapped: false } {
  if (
    words[0] === 0 && words[1] === 0 && words[2] === 0 && words[3] === 0 &&
    words[4] === 0 && words[5] === 0xffff
  ) {
    const hi = words[6]!;
    const lo = words[7]!;
    const ip = `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
    return { mapped: true, ipv4: ip };
  }
  return { mapped: false };
}

/**
 * Prüft eine konkrete IP gegen die Blocklist. Family 4 nutzt die
 * IPv4-Liste, Family 6 prüft erst auf IPv4-mapped (und cycled in v4),
 * dann gegen die IPv6-Liste.
 */
export function isIpBlocked(ip: string, family: 4 | 6): { blocked: true; reason: string } | { blocked: false } {
  if (family === 4) {
    for (const [prefix, bits] of IPV4_BLOCKS) {
      if (ipv4InCidr(ip, prefix, bits)) {
        return { blocked: true, reason: `URL zeigt auf privates Netzwerk: ${ip}` };
      }
    }
    return { blocked: false };
  }
  const words = ipv6ToWords(ip);
  if (!words) {
    return { blocked: true, reason: `Konnte IPv6 nicht parsen: ${ip}` };
  }
  const mapped = isIpv4Mapped(words);
  if (mapped.mapped) {
    return isIpBlocked(mapped.ipv4, 4);
  }
  for (const [prefix, bits] of IPV6_BLOCKS) {
    if (ipv6InCidr(ip, prefix, bits)) {
      return { blocked: true, reason: `URL zeigt auf privates Netzwerk: ${ip}` };
    }
  }
  return { blocked: false };
}

/**
 * Erkennt numeric-only Hostnames (decimal/hex/octal Form) — Klassiker
 * SSRF-Bypass: `http://2852039166/` resolved zu `169.254.169.254`
 * (AWS-Metadata). Unsere Policy: numeric-Hostname IMMER ablehnen.
 */
function looksLikeNumericHost(host: string): boolean {
  if (/^\d+$/.test(host)) return true;
  if (/^0x[0-9a-f]+$/i.test(host)) return true;
  if (/^0\d+$/.test(host)) return true;
  return false;
}

/**
 * Validiert die Ziel-URL gegen die SSRF-Policy. Worker ruft das VOR
 * jeder Delivery erneut auf (Defense-in-Depth gegen DNS-Rebinding).
 *
 * Return-Form ist bewusst minimal (`{ ok, url } | { ok, reason }`) —
 * andere Agents (Backend, Route) konsumieren diese Form als Frozen-
 * Contract. Worker bekommt die pinnable IP über `pinnedFetch(url)`,
 * das intern erneut auflöst.
 */
export async function validateWebhookUrl(input: string): Promise<GuardResult> {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return { ok: false, reason: "URL ungültig" };
  }

  // 2. Schema
  const allowHttp = process.env.WEBHOOK_ALLOW_HTTP === "1";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && allowHttp)) {
    return { ok: false, reason: "Nur HTTPS erlaubt" };
  }

  // 3. Hostname-Block-Suffixe
  const host = url.hostname.toLowerCase();
  if (!host) {
    return { ok: false, reason: "Hostname fehlt" };
  }
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) {
    return { ok: false, reason: "Loopback nicht erlaubt" };
  }

  // 4. Port-Whitelist
  if (url.port !== "") {
    const port = Number.parseInt(url.port, 10);
    const isProd = process.env.NODE_ENV === "production";
    const allowed = isProd ? [443] : [80, 443];
    if (!allowed.includes(port)) {
      return { ok: false, reason: `Port ${url.port} nicht erlaubt` };
    }
  }

  // 5. Numeric-only Hostname (decimal/hex/octal IP-Tarnung)
  if (looksLikeNumericHost(host)) {
    return { ok: false, reason: "Numeric-Hostname nicht erlaubt" };
  }

  // 6. DNS-Lookup auf ALLE Adressen — auch IP-Literals laufen hier durch
  //    (`dns.lookup` gibt sie ungemoddt zurück), sodass die CIDR-Prüfung
  //    auch für `https://127.0.0.1/` und `https://[::1]/` greift.
  let addrs: LookupAddress[];
  try {
    addrs = await dnsLookup(host, { all: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, reason: `DNS-Lookup fehlgeschlagen: ${msg}` };
  }
  if (addrs.length === 0) {
    return { ok: false, reason: "Hostname hat keine IP" };
  }

  // Wenn IRGENDEINE der zurückgegebenen IPs privat ist, lehnen wir ab.
  for (const a of addrs) {
    const family = a.family === 6 ? 6 : 4;
    const verdict = isIpBlocked(a.address, family);
    if (verdict.blocked) {
      return { ok: false, reason: verdict.reason };
    }
  }

  return { ok: true, url };
}

/**
 * Erzeugt einen undici-Dispatcher, dessen `connect.lookup` die
 * DNS-Resolution selbst macht und JEDE aufgelöste IP gegen die
 * Blocklist prüft. Wenn der Lookup eine private IP zurückgibt, wird
 * der Connect mit einem `WebhookUrlBlockedError` abgebrochen — der
 * Worker fängt das spezifisch und markiert die Delivery als blocked.
 *
 * Damit ist das TOCTOU-Loch zwischen
 *   `validateWebhookUrl(url)` ─── public IP ───►  *attacker flippt DNS*
 *   ─── undici connect: private IP ───► Pwn
 * geschlossen, denn die Verifikation passiert beim Connect-Lookup.
 *
 * NB: Wir nehmen die ERSTE öffentliche IP — wenn der Resolver mehrere
 * zurückgibt, ist das die deterministische Wahl. Mixed-Antworten mit
 * EINER privaten IP failen den Connect komplett.
 */
export function pinnedFetch(_url: URL): Dispatcher {
  return new Agent({
    connect: {
      lookup: (host, _opts, cb) => {
        dnsLookup(host, { all: true })
          .then((addrs) => {
            if (addrs.length === 0) {
              cb(new WebhookUrlBlockedError(`Hostname hat keine IP: ${host}`), "", 4);
              return;
            }
            for (const a of addrs) {
              const family = a.family === 6 ? 6 : 4;
              const verdict = isIpBlocked(a.address, family);
              if (verdict.blocked) {
                cb(new WebhookUrlBlockedError(verdict.reason), "", family);
                return;
              }
            }
            const first = addrs[0]!;
            cb(null, first.address, first.family === 6 ? 6 : 4);
          })
          .catch((err: unknown) => {
            const msg = err instanceof Error ? err.message : String(err);
            cb(new WebhookUrlBlockedError(`DNS-Lookup fehlgeschlagen: ${msg}`), "", 4);
          });
      },
    },
  });
}
