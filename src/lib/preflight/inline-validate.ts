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
 * Strategie — bewusst KONSERVATIV, um den B2B-Outreach-Fall nicht zu
 * sabotieren, in dem ein Kunde mehrere Ansprechpartner derselben Firma
 * kontaktiert (8-15 Leads pro Domain sind normal):
 *
 *   1. Gleiche Email     → echtes Duplikat (Email ist eindeutig pro Person).
 *   2. Gleiche Person (Vor+Nachname) AUF derselben Domain → echtes
 *      Duplikat (gleiche Zeile zweimal in der CSV).
 *
 *   Domain ALLEINE ist KEIN Duplikat-Kriterium — Marie@firma.de und
 *   Max@firma.de sind zwei verschiedene Menschen.
 *
 * Returns: Map<duplicateLeadId, originalLeadId>. Originale (erste
 * Vorkommen) erscheinen NICHT als Schlüssel.
 */
export function findDuplicates(
  leads: DuplicateInput[],
): Map<string, string> {
  const dupes = new Map<string, string>();
  const emailFirstSeen = new Map<string, string>();
  const personHostFirstSeen = new Map<string, string>();

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
    const firstName = pick(lead.data, ["firstName", "Vorname", "first_name"]);
    const lastName = pick(lead.data, ["lastName", "Nachname", "last_name"]);

    const host = websiteUrl ? normalizeHost(websiteUrl) : null;
    const email = emailRaw ? normalizeEmail(emailRaw) : null;
    const personKey =
      firstName && lastName && host
        ? `${firstName.toLowerCase().trim()}|${lastName
            .toLowerCase()
            .trim()}|${host}`
        : null;

    // 1. Email ist die definitive Match-Quelle.
    if (email && emailFirstSeen.has(email)) {
      dupes.set(lead.id, emailFirstSeen.get(email)!);
      continue;
    }

    // 2. Gleiche Person+Domain → wahrscheinlich doppelte CSV-Zeile.
    if (personKey && personHostFirstSeen.has(personKey)) {
      dupes.set(lead.id, personHostFirstSeen.get(personKey)!);
      continue;
    }

    if (email) emailFirstSeen.set(email, lead.id);
    if (personKey) personHostFirstSeen.set(personKey, lead.id);
  }

  return dupes;
}
