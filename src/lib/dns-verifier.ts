/**
 * DNS-Verifikation fuer Custom-Domains.
 *
 * Prueft zwei Dinge:
 *  1. Der Hostname resolvt auf unseren Server. Akzeptiert wird:
 *     - direkter A-Record auf SERVER_IP
 *     - CNAME-Kette die letztlich auf cname.videocomet.de oder SERVER_IP fuehrt
 *  2. Der TXT-Record `_videocomet.<hostname>` enthaelt unseren vc-verify-Token.
 *
 * Beide Checks haben harte Timeouts (3s pro Lookup), damit der Worker nicht
 * haengt wenn ein autoritativer Nameserver tot ist.
 */

import { Resolver } from "node:dns/promises";

const LOOKUP_TIMEOUT_MS = 3_000;
const DEFAULT_SERVER_IP = "178.105.208.68";
const DEFAULT_CNAME_TARGET = "cname.videocomet.de";

/**
 * Public recursive DNS-Resolver — bewusst NICHT Docker's eingebetteter
 * Resolver (127.0.0.11). Der cached TXT/CNAME-Records mit dem ersten TTL
 * den er sieht und ignoriert Updates am Public-DNS. Wir wollen aber bei
 * jedem Verifier-Tick frische Antworten von authoritative.
 *
 * 1.1.1.1 (Cloudflare) und 8.8.8.8 (Google) als Fallback. Beide haben
 * niedrige Cache-TTLs fuer kleine Records und respektieren NS-TTL.
 */
const PUBLIC_DNS_SERVERS = ["1.1.1.1", "8.8.8.8"] as const;

function makeResolver(): Resolver {
  const r = new Resolver({ timeout: LOOKUP_TIMEOUT_MS, tries: 1 });
  r.setServers([...PUBLIC_DNS_SERVERS]);
  return r;
}

function getExpectedIp(): string {
  return process.env.SERVER_IP ?? DEFAULT_SERVER_IP;
}

function getExpectedCname(): string {
  return (process.env.CNAME_TARGET ?? DEFAULT_CNAME_TARGET).replace(/\.$/, "").toLowerCase();
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let t: NodeJS.Timeout | undefined;
  const guard = new Promise<never>((_, reject) => {
    t = setTimeout(() => reject(new Error(`${label} timeout after ${ms}ms`)), ms);
  });
  return Promise.race([p, guard]).finally(() => {
    if (t) clearTimeout(t);
  }) as Promise<T>;
}

export interface DnsCheck {
  ok: boolean;
  /** Effective answer for the hostname — useful for diagnostics. */
  resolved?: string;
  message?: string;
}

/**
 * Versucht den Hostname zu resolven und prueft, ob er auf uns zeigt.
 * Akzeptiert sowohl direkten A-Record als auch CNAME-Kette die letztlich
 * auf cname.videocomet.de fuehrt.
 */
export async function checkDns(hostname: string): Promise<DnsCheck> {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  const expectedIp = getExpectedIp();
  const expectedCname = getExpectedCname();
  const dns = makeResolver();

  // 1) CNAME-Check
  try {
    const cnames = await withTimeout(dns.resolveCname(host), LOOKUP_TIMEOUT_MS, "CNAME");
    const matched = cnames.find((c) => c.toLowerCase().replace(/\.$/, "") === expectedCname);
    if (matched) {
      return { ok: true, resolved: matched, message: `CNAME → ${matched}` };
    }
    // CNAME existiert, zeigt aber woanders hin
    return {
      ok: false,
      resolved: cnames.join(", "),
      message: `CNAME zeigt auf ${cnames[0]}, erwartet ${expectedCname}`,
    };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    // ENODATA = "no CNAME record" → wir versuchen A
    if (code !== "ENODATA" && code !== "ENOTFOUND") {
      return { ok: false, message: `CNAME-Lookup fehlgeschlagen: ${(err as Error).message}` };
    }
  }

  // 2) A-Record-Check
  try {
    const addrs = await withTimeout(dns.resolve4(host), LOOKUP_TIMEOUT_MS, "A");
    if (addrs.includes(expectedIp)) {
      return { ok: true, resolved: expectedIp, message: `A → ${expectedIp}` };
    }
    return {
      ok: false,
      resolved: addrs.join(", "),
      message: `A-Record zeigt auf ${addrs.join(", ")}, erwartet ${expectedIp}`,
    };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === "ENOTFOUND" || code === "ENODATA") {
      return { ok: false, message: "DNS-Record fehlt (NXDOMAIN/ENODATA)." };
    }
    return { ok: false, message: `A-Lookup fehlgeschlagen: ${(err as Error).message}` };
  }
}

export interface TxtCheck {
  ok: boolean;
  message?: string;
}

/**
 * Prueft den `_videocomet.<hostname>` TXT-Record auf den vc-verify-Token.
 * TXT-Werte koennen quotedstring sein und in Chunks (255 chars) aufgeteilt —
 * dns.resolveTxt liefert ein 2D-Array (records[chunks[]]), wir flatten.
 */
export async function checkTxt(hostname: string, expectedToken: string): Promise<TxtCheck> {
  const name = `_videocomet.${hostname.toLowerCase().replace(/\.$/, "")}`;
  const expected = `vc-verify=${expectedToken}`;
  const dns = makeResolver();
  try {
    const records = await withTimeout(dns.resolveTxt(name), LOOKUP_TIMEOUT_MS, "TXT");
    const flat = records.map((chunks) => chunks.join("")).map((s) => s.trim());
    if (flat.some((s) => s === expected)) {
      return { ok: true, message: "TXT-Token gefunden." };
    }
    if (flat.length === 0) {
      return { ok: false, message: "TXT-Record vorhanden aber leer." };
    }
    return {
      ok: false,
      message: `TXT vorhanden (${flat.length} Eintraege), aber kein vc-verify=<token> mit unserem Token.`,
    };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === "ENOTFOUND" || code === "ENODATA") {
      return { ok: false, message: `Kein TXT-Record an ${name} gefunden.` };
    }
    return { ok: false, message: `TXT-Lookup fehlgeschlagen: ${(err as Error).message}` };
  }
}

export interface FullDomainVerification {
  dnsOk: boolean;
  dnsMessage?: string;
  txtOk: boolean;
  txtMessage?: string;
  ready: boolean; // beides ok
}

export async function verifyDomain(
  hostname: string,
  expectedToken: string,
): Promise<FullDomainVerification> {
  const [dnsRes, txtRes] = await Promise.all([
    checkDns(hostname),
    checkTxt(hostname, expectedToken),
  ]);
  return {
    dnsOk: dnsRes.ok,
    dnsMessage: dnsRes.message,
    txtOk: txtRes.ok,
    txtMessage: txtRes.message,
    ready: dnsRes.ok && txtRes.ok,
  };
}
