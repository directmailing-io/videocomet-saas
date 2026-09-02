/**
 * SSRF-Guard fuer URL-Mediathek.
 *
 * Verhindert dass User-eingegebene URLs unseren Server zwingen, interne
 * Netzwerk-Ressourcen aufzurufen (Postgres, Redis, Coolify, etc.). Wird
 * sowohl beim POST /api/media-urls als auch IM Worker direkt vor jeder
 * Puppeteer-Navigation aufgerufen (Defense-in-Depth gegen DNS-Rebinding).
 *
 * Regeln:
 *   1. Schema MUSS http: oder https: sein. Block file:, gopher:, ftp:, etc.
 *   2. Hostname-Resolution → alle IPs muessen oeffentlich sein.
 *   3. Bekannte schlechte Hosts (localhost-Aliasse) hart blockieren.
 */

import { promises as dns } from "node:dns";
import { isIP } from "node:net";

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "ip6-localhost",
  "ip6-loopback",
  "metadata.google.internal",
  "metadata",
]);

/**
 * Private/Reserved CIDR-Ranges per RFC 1918 + RFC 4193 + reserved IPs.
 * Wir checken IPv4 + IPv6 separat.
 */
const BLOCKED_IPV4_PREFIXES = [
  /^10\./,
  /^127\./,
  /^169\.254\./, // Link-local (AWS/Hetzner-Metadata 169.254.169.254)
  /^172\.(1[6-9]|2[0-9]|3[0-1])\./,
  /^192\.168\./,
  /^0\./, // "this network"
  /^100\.(6[4-9]|[7-9][0-9]|1[01][0-9]|12[0-7])\./, // 100.64/10 Carrier-NAT (Docker/Cloud-intern)
  /^192\.0\.0\./, // IETF protocol assignments
  /^198\.1[89]\./, // Benchmark-Netz
  /^(22[4-9]|2[3-5][0-9])\./, // Multicast + reserviert + Broadcast
];

const BLOCKED_IPV6_PREFIXES = [
  /^::1$/, // loopback
  /^::$/, // unspecified
  /^fc/i, // ULA
  /^fd/i, // ULA
  /^fe80:/i, // link-local
  /^64:ff9b:/i, // NAT64 (kann auf private v4 zeigen)
];

/**
 * IPv4-mapped IPv6 (`::ffff:10.0.0.2`) auf die eingebettete v4-Adresse
 * reduzieren, damit die v4-Blocklist greift. Sonst könnte ein DNS-Record
 * mit `::ffff:169.254.169.254` die Prüfung umgehen.
 */
function unwrapMappedIpv4(ip: string): string {
  const m = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(ip);
  return m ? m[1] : ip;
}

export class SsrfBlockedError extends Error {
  public readonly reason: string;
  constructor(reason: string) {
    super(`URL blocked: ${reason}`);
    this.name = "SsrfBlockedError";
    this.reason = reason;
  }
}

function isBlockedIp(rawIp: string): boolean {
  const ip = unwrapMappedIpv4(rawIp);
  const ver = isIP(ip);
  if (ver === 4) {
    return BLOCKED_IPV4_PREFIXES.some((re) => re.test(ip));
  }
  if (ver === 6) {
    const norm = ip.toLowerCase();
    return BLOCKED_IPV6_PREFIXES.some((re) => re.test(norm));
  }
  return false;
}

/**
 * Validiert eine URL fuer Mediathek-Speicherung + Preview-Generation.
 *
 * Wirft `SsrfBlockedError` mit konkretem Grund wenn nicht erlaubt.
 * Sicher: niemals throw bei rein User-bedingten Inputs ohne Diagnose-Text.
 */
export async function assertUrlIsSafe(rawUrl: string): Promise<void> {
  let u: URL;
  try {
    u = new URL(rawUrl.trim());
  } catch {
    throw new SsrfBlockedError("Ungueltige URL");
  }

  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new SsrfBlockedError(`Schema '${u.protocol}' nicht erlaubt`);
  }

  const host = u.hostname.toLowerCase();
  if (BLOCKED_HOSTNAMES.has(host)) {
    throw new SsrfBlockedError(`Hostname '${host}' nicht erlaubt`);
  }

  // Wenn host bereits eine IP ist, direkt pruefen — kein DNS-Roundtrip.
  if (isIP(host)) {
    if (isBlockedIp(host)) {
      throw new SsrfBlockedError(`IP '${host}' liegt im privaten Netz`);
    }
    return;
  }

  // DNS-Resolution. Bei Multi-IP (z.B. CDN) muessen ALLE oeffentlich sein —
  // sonst koennten Angreifer ein Doppel-A-Record nutzen um eine private IP
  // hinter einer oeffentlichen zu verstecken.
  let addrs: string[];
  try {
    const records = await dns.lookup(host, { all: true });
    addrs = records.map((r) => r.address);
  } catch (err) {
    throw new SsrfBlockedError(
      `Hostname nicht aufloesbar: ${err instanceof Error ? err.message : "?"}`,
    );
  }
  if (addrs.length === 0) {
    throw new SsrfBlockedError("Keine IPs fuer Hostname");
  }
  for (const ip of addrs) {
    if (isBlockedIp(ip)) {
      throw new SsrfBlockedError(
        `Hostname '${host}' loest auf private IP '${ip}' auf`,
      );
    }
  }
}
