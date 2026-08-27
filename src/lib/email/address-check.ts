/**
 * Adress-Prüfung für den E-Mail-Versand: Syntax + DNS-Check, ob die
 * Domain überhaupt Mails annehmen kann (MX, Fallback A/AAAA nach RFC
 * 5321). Kaputte Adressen werden so gar nicht erst angeschrieben —
 * Bounces sind der größte Reputationskiller fürs Kunden-Postfach.
 *
 * Ergebnis-Klassen:
 *  - ok:             Domain hat Mailserver, Versand sinnvoll
 *  - invalid_syntax: keine gültige E-Mail-Adresse
 *  - no_mailserver:  Domain existiert nicht / kann keine Mails empfangen
 *  - unknown:        DNS nicht erreichbar o. ä. — NICHT blockieren
 */

import { resolve4, resolve6, resolveMx } from "node:dns/promises";

export type EmailAddressCheckStatus =
  | "ok"
  | "invalid_syntax"
  | "no_mailserver"
  | "unknown";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const POSITIVE_TTL_MS = 6 * 60 * 60 * 1_000;
const NEGATIVE_TTL_MS = 30 * 60 * 1_000;
const DNS_TIMEOUT_MS = 4_000;
const MAX_CACHE_ENTRIES = 10_000;

/** true = nimmt Mails an, false = sicher nicht, null = unbekannt. */
const domainCache = new Map<string, { ok: boolean; expiresAt: number }>();

function withTimeout<T>(p: Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(
      () => reject(new Error("dns_timeout")),
      DNS_TIMEOUT_MS,
    );
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (err) => {
        clearTimeout(t);
        reject(err);
      },
    );
  });
}

/** NXDOMAIN/NODATA = Domain kann sicher keine Mails empfangen. */
function isDefinitiveDnsMiss(err: unknown): boolean {
  const code = (err as { code?: string }).code;
  return code === "ENOTFOUND" || code === "ENODATA";
}

async function resolveDomainAcceptsMail(
  domain: string,
): Promise<boolean | null> {
  try {
    const mx = await withTimeout(resolveMx(domain));
    // "Null MX" (RFC 7505): einzelner Eintrag "." = nimmt explizit keine Mails an.
    const usable = mx.filter((r) => r.exchange && r.exchange !== ".");
    if (usable.length > 0) return true;
    if (mx.length > 0) return false;
  } catch (err) {
    if (!isDefinitiveDnsMiss(err)) return null;
  }
  // Kein MX: RFC-5321-Fallback auf A/AAAA.
  try {
    const a = await withTimeout(resolve4(domain));
    if (a.length > 0) return true;
  } catch (err) {
    if (!isDefinitiveDnsMiss(err)) return null;
  }
  try {
    const aaaa = await withTimeout(resolve6(domain));
    if (aaaa.length > 0) return true;
  } catch (err) {
    if (!isDefinitiveDnsMiss(err)) return null;
  }
  return false;
}

export async function checkEmailAddress(
  email: string,
): Promise<{ status: EmailAddressCheckStatus }> {
  const trimmed = (email ?? "").trim().toLowerCase();
  if (!EMAIL_RE.test(trimmed)) return { status: "invalid_syntax" };

  const domain = trimmed.split("@")[1]!;
  const cached = domainCache.get(domain);
  if (cached && cached.expiresAt > Date.now()) {
    return { status: cached.ok ? "ok" : "no_mailserver" };
  }

  const ok = await resolveDomainAcceptsMail(domain);
  if (ok === null) return { status: "unknown" };

  if (domainCache.size >= MAX_CACHE_ENTRIES) domainCache.clear();
  domainCache.set(domain, {
    ok,
    expiresAt: Date.now() + (ok ? POSITIVE_TTL_MS : NEGATIVE_TTL_MS),
  });
  return { status: ok ? "ok" : "no_mailserver" };
}

/** Klartext für UI + Message-Fehlertext (kein Fachjargon). */
export const ADDRESS_CHECK_MESSAGES: Record<EmailAddressCheckStatus, string> = {
  ok: "Die Adresse sieht gut aus und kann E-Mails empfangen.",
  invalid_syntax: "Das ist keine gültige E-Mail-Adresse. Bitte prüfen Sie die Schreibweise.",
  no_mailserver:
    "Diese Adresse kann keine E-Mails empfangen. Die Domain hinter dem @-Zeichen existiert nicht oder hat keinen Mailserver. Bitte prüfen Sie die Schreibweise.",
  unknown: "Die Adresse konnte gerade nicht geprüft werden. Der Versand wird trotzdem versucht.",
};
