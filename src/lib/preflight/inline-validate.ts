/**
 * Inline-Validation: synchroner Sofort-Check pro Lead, läuft ohne Worker
 * direkt im API-Request beim Preflight-Start. Fängt billige Fehler ab
 * (leere Pflichtfelder, kaputte URLs, Duplikate), bevor irgendein
 * Puppeteer-Job in der Queue landet.
 *
 * Konventionen:
 *  - Pflichtfelder: `firstName` und `websiteUrl` in `lead.data`. Diese Keys
 *    sind die im Column-Mapping verwendeten Placeholder, die das Frontend
 *    in der Mapping-Phase setzt.
 *  - URLs müssen ein gültiges http/https-Schema und einen externen Host
 *    haben (kein localhost / private-IP-Range — Akquise-Webseiten sind
 *    immer öffentlich erreichbar).
 *  - Duplikate werden über normalisierte URL UND/ODER lowercase-Email
 *    erkannt. Das erste Vorkommen ist "Original" und behält seinen Slot.
 */

import type {
  InlineValidationIssue,
  InlineValidationResult,
} from "./types";

// RFC-5322-light. Bewusst kein vollständiger Parser — die Pipeline will
// nur offensichtliche Tippfehler fangen, nicht Edge-Cases wie quoted-locals.
const EMAIL_RE = /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i;

const PRIVATE_HOST_RES: RegExp[] = [
  /^localhost$/i,
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[0-1])\./,
  /^0\.0\.0\.0$/,
  /^\[?::1\]?$/,
];

/**
 * Liest ein Feld aus dem flachen `lead.data`-Bag. Akzeptiert mehrere
 * gebräuchliche Aliase, weil das Column-Mapping je nach CSV unterschiedlich
 * benannte Spalten auf dieselbe semantische Bedeutung mappt.
 */
function pick(data: Record<string, unknown>, keys: string[]): string | null {
  for (const k of keys) {
    const v = data[k];
    if (typeof v === "string" && v.trim().length > 0) return v.trim();
  }
  return null;
}

function isValidUrl(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return false;
  if (!u.hostname) return false;
  for (const re of PRIVATE_HOST_RES) {
    if (re.test(u.hostname)) return false;
  }
  // Hostname muss mindestens einen Punkt haben (keine Single-Label-Hosts).
  if (!u.hostname.includes(".")) return false;
  return true;
}

/**
 * Prüft einen einzelnen Lead gegen die Pflichtfelder- und Format-Regeln.
 * Liefert eine Liste menschenlesbarer Issue-Keys; ein leeres Array
 * bedeutet "alles gut".
 */
export function validateLeadInline(
  leadData: Record<string, unknown>,
): InlineValidationResult {
  const issues: InlineValidationIssue[] = [];

  const firstName = pick(leadData, ["firstName", "Vorname", "first_name"]);
  if (!firstName) issues.push("missing_firstName");

  const websiteUrl = pick(leadData, [
    "websiteUrl",
    "website",
    "Webseite",
    "url",
    "URL",
    "Website",
  ]);
  if (!websiteUrl) {
    issues.push("missing_websiteUrl");
  } else if (!isValidUrl(websiteUrl)) {
    issues.push("invalid_url");
  }

  const email = pick(leadData, ["email", "Email", "E-Mail", "e-mail", "mail"]);
  if (email && !EMAIL_RE.test(email)) {
    issues.push("invalid_email");
  }

  return { ok: issues.length === 0, issues };
}

/**
 * Normalisiert einen Host: lowercase, `www.`-Strip, Trailing-Dot-Strip.
 * Liefert null, wenn die URL nicht parsebar ist (in dem Fall werden wir
 * für Duplikat-Detection gar nicht erst auf diesen Lead matchen).
 */
function normalizeHost(rawUrl: string): string | null {
  try {
    const u = new URL(rawUrl);
    let h = u.hostname.toLowerCase();
    if (h.startsWith("www.")) h = h.slice(4);
    if (h.endsWith(".")) h = h.slice(0, -1);
    return h || null;
  } catch {
    return null;
  }
}

function normalizeEmail(raw: string): string | null {
  const t = raw.trim().toLowerCase();
  return t.length > 0 ? t : null;
}

export interface DuplicateInput {
  id: string;
  data: Record<string, unknown>;
}

/**
 * Sucht innerhalb eines Lead-Batches nach Duplikaten.
 *
 * Strategie:
 *   1. Normalisiere host + email pro Lead.
 *   2. Lege zwei Lookup-Maps an (host → firstLeadId, email → firstLeadId).
 *   3. Jeder Lead, dessen host ODER email bereits in der Map ist, wird als
 *      Duplikat markiert auf das **erste** Vorkommen.
 *
 * Returns: Map<duplicateLeadId, originalLeadId>. Originale (erste
 * Vorkommen) erscheinen NICHT als Schlüssel.
 *
 * Reihenfolge ist die Input-Reihenfolge — bei CSV-Upload entspricht das der
 * rowIndex-Sortierung und damit dem deterministisch ersten Lead.
 */
export function findDuplicates(
  leads: DuplicateInput[],
): Map<string, string> {
  const dupes = new Map<string, string>();
  const hostFirstSeen = new Map<string, string>();
  const emailFirstSeen = new Map<string, string>();

  for (const lead of leads) {
    const websiteUrl = pick(lead.data, [
      "websiteUrl",
      "website",
      "Webseite",
      "url",
      "URL",
      "Website",
    ]);
    const emailRaw = pick(lead.data, [
      "email",
      "Email",
      "E-Mail",
      "e-mail",
      "mail",
    ]);

    const host = websiteUrl ? normalizeHost(websiteUrl) : null;
    const email = emailRaw ? normalizeEmail(emailRaw) : null;

    // Match against email first — exakter als Host, der bei Multi-Tenant-
    // Hostern (z.B. wix.com) zu false positives führen kann.
    if (email && emailFirstSeen.has(email)) {
      dupes.set(lead.id, emailFirstSeen.get(email)!);
      continue;
    }
    if (host && hostFirstSeen.has(host)) {
      dupes.set(lead.id, hostFirstSeen.get(host)!);
      continue;
    }

    if (email) emailFirstSeen.set(email, lead.id);
    if (host) hostFirstSeen.set(host, lead.id);
  }

  return dupes;
}
