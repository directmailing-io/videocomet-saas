/**
 * Hostname-Validation, Normalisierung und Klassifikation (Subdomain vs Apex).
 *
 * Strikt: wir verbieten Wildcards, IP-Adressen, IDN-Roh (Punycode-Encoded
 * akzeptieren wir aber). Hostnames werden zur Speicherung lowercase und
 * trailing-dot-frei normalisiert.
 */

const HOSTNAME_RE =
  /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;

const RESERVED_TLDS = new Set(["test", "example", "invalid", "localhost"]);

/**
 * Liste von Hostnames, die wir NICHT als Custom-Domain akzeptieren — schuetzt
 * vor versehentlichem Hijacking unserer eigenen Domains.
 */
const FORBIDDEN_HOSTS = new Set<string>([
  "videocomet.de",
  "www.videocomet.de",
  "app.videocomet.de",
  "cname.videocomet.de",
  "api.videocomet.de",
  "admin.videocomet.de",
]);

export type DomainKind = "subdomain" | "apex";

export interface HostnameValidationOk {
  ok: true;
  hostname: string;
  kind: DomainKind;
}

export interface HostnameValidationErr {
  ok: false;
  error: string;
}

export type HostnameValidation = HostnameValidationOk | HostnameValidationErr;

/**
 * Normalisiert und validiert einen vom User eingegebenen Hostname.
 *  - trim, trailing-dot weg, lowercase
 *  - Verbotene Hosts ablehnen (eigene Domains)
 *  - Wildcards / IPs ablehnen
 *  - DNS-Konformitaet via Regex
 *  - Test/Example-TLDs ablehnen
 *  - Klassifikation: hat genau 2 Labels (`kunde.de`) → apex, sonst subdomain
 */
export function validateHostname(input: string): HostnameValidation {
  let h = (input ?? "").trim().toLowerCase();
  if (!h) return { ok: false, error: "Hostname darf nicht leer sein." };

  // Trailing dot entfernen (Fully-Qualified-Notation)
  h = h.replace(/\.$/, "");

  // Protokoll-Praefix oder Pfad weg
  h = h.replace(/^https?:\/\//, "").replace(/\/.*$/, "");

  // Wildcard nicht erlaubt
  if (h.includes("*")) {
    return { ok: false, error: "Wildcard-Domains werden nicht unterstützt." };
  }

  // IP-Adresse nicht erlaubt
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h)) {
    return { ok: false, error: "IP-Adressen sind nicht erlaubt." };
  }

  if (FORBIDDEN_HOSTS.has(h)) {
    return {
      ok: false,
      error: "Dieser Hostname ist reserviert und kann nicht verbunden werden.",
    };
  }

  if (!HOSTNAME_RE.test(h)) {
    return { ok: false, error: "Ungueltiger Hostname-Format." };
  }

  const labels = h.split(".");
  const tld = labels[labels.length - 1];
  if (RESERVED_TLDS.has(tld)) {
    return {
      ok: false,
      error: `TLD .${tld} ist nicht erlaubt (Test/Beispiel-TLD).`,
    };
  }

  // Klassifikation: 2 Labels = Apex (kunde.de), >2 = Subdomain (video.kunde.de)
  const kind: DomainKind = labels.length === 2 ? "apex" : "subdomain";

  return { ok: true, hostname: h, kind };
}

/**
 * Erzeugt einen kryptografisch zufaelligen TXT-Verifikationstoken.
 * Format: 24 hex chars → 96 bits Entropy.
 */
export function generateVerifyToken(): string {
  // Bewusst kein crypto.randomBytes-Import damit die Datei auch in
  // Edge-Runtime tickt — wir nutzen Web-Crypto.
  const bytes = new Uint8Array(12);
  // crypto ist in Node 18+ und in Edge global verfügbar.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const c = (globalThis as any).crypto;
  if (c?.getRandomValues) {
    c.getRandomValues(bytes);
  } else {
    // Fallback (rein theoretisch — sollte nie zuschlagen).
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Der TXT-Record-Name, an dem der Token erwartet wird, ist immer
 * `_videocomet.<hostname>`. Diese Helper hilft bei UI-Display und beim
 * DNS-Lookup.
 */
export function verifyRecordName(hostname: string): string {
  return `_videocomet.${hostname}`;
}

/**
 * Der erwartete TXT-Record-Wert.
 */
export function verifyRecordValue(token: string): string {
  return `vc-verify=${token}`;
}
