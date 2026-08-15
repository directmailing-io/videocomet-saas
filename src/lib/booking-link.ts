/**
 * Universeller Buchungslink-Detektor (Landingpage v3, Konzept 5.6).
 *
 * EIN Feld "Buchungslink" im CTA-Block; wir erkennen den Anbieter an der
 * URL und bauen die korrekte Embed-URL. Pure Funktionen, keine DOM-Zugriffe:
 * Calendly braucht zusaetzlich `embed_domain=<hostname>` — das ergaenzt die
 * Client-Komponente (`booking-embed.tsx`), weil der Hostname erst im
 * Browser bekannt ist (Custom Domains!).
 *
 * Sicherheitsregel: nur http(s)-URLs werden akzeptiert, alles andere
 * (javascript:, data:, ftp:, Muell) faellt auf `provider: "unknown"` zurueck.
 */

import type { LeadData } from "./landing-blocks/types";

export type BookingProvider =
  | "calendly"
  | "cal-com"
  | "ms-bookings"
  | "google"
  | "hubspot"
  | "tidycal"
  | "unknown";

export interface BookingPrefill {
  name?: string;
  email?: string;
}

export interface BookingLinkInfo {
  provider: BookingProvider;
  /** Fertige iframe-URL (https-normalisiert) oder null wenn nicht embedbar. */
  embedUrl: string | null;
  canEmbed: boolean;
}

const UNKNOWN: BookingLinkInfo = {
  provider: "unknown",
  embedUrl: null,
  canEmbed: false,
};

/** host === domain oder Subdomain davon (www., app., …). */
function hostMatches(host: string, domain: string): boolean {
  return host === domain || host.endsWith("." + domain);
}

function setParams(url: URL, params: Record<string, string | undefined>): URL {
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") url.searchParams.set(key, value);
  }
  return url;
}

/**
 * Erkennt den Buchungs-Anbieter und baut die Embed-URL. Bestehende
 * Query-Parameter der Eingabe-URL bleiben erhalten; http wird auf https
 * normalisiert.
 */
export function detectBookingLink(
  url: string,
  prefill?: BookingPrefill,
): BookingLinkInfo {
  if (!url || typeof url !== "string") return UNKNOWN;

  let u: URL;
  try {
    u = new URL(url.trim());
  } catch {
    return UNKNOWN;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return UNKNOWN;
  u.protocol = "https:";

  const host = u.hostname.toLowerCase();
  const path = u.pathname;

  // Calendly — *.calendly.com. embed_domain setzt der Client (hostname),
  // hide_gdpr_banner haelt das Embed kompakt. Prefill: ?name=&email=
  if (hostMatches(host, "calendly.com")) {
    setParams(u, {
      hide_gdpr_banner: "1",
      name: prefill?.name,
      email: prefill?.email,
    });
    return { provider: "calendly", embedUrl: u.toString(), canEmbed: true };
  }

  // Cal.com — cal.com oder *.cal.com (auch app.cal.com Links).
  if (hostMatches(host, "cal.com")) {
    setParams(u, {
      embed: "true",
      name: prefill?.name,
      email: prefill?.email,
    });
    return { provider: "cal-com", embedUrl: u.toString(), canEmbed: true };
  }

  // Microsoft Bookings — drei URL-Formen, alle direkt framebar, kein Prefill.
  const isOutlookHost =
    hostMatches(host, "outlook.office365.com") ||
    hostMatches(host, "outlook.office.com");
  const isOutlookBookingPath =
    path.startsWith("/owa/calendar/") || path.startsWith("/bookwithme/");
  if (
    (isOutlookHost && isOutlookBookingPath) ||
    hostMatches(host, "bookings.microsoft.com")
  ) {
    return { provider: "ms-bookings", embedUrl: u.toString(), canEmbed: true };
  }

  // Google Terminplan — volle appointments-URLs sind framebar,
  // calendar.app.google-Kurzlinks verbieten Framing (X-Frame-Options).
  if (host === "calendar.app.google") {
    return { provider: "google", embedUrl: null, canEmbed: false };
  }
  if (host === "calendar.google.com") {
    if (path.includes("/appointments")) {
      return { provider: "google", embedUrl: u.toString(), canEmbed: true };
    }
    return { provider: "google", embedUrl: null, canEmbed: false };
  }

  // HubSpot Meetings — Prefill nutzt firstName statt name.
  if (
    hostMatches(host, "meetings.hubspot.com") ||
    hostMatches(host, "meetings-eu1.hubspot.com")
  ) {
    setParams(u, {
      embed: "true",
      firstName: prefill?.name,
      email: prefill?.email,
    });
    return { provider: "hubspot", embedUrl: u.toString(), canEmbed: true };
  }

  // TidyCal — direkt framebar.
  if (hostMatches(host, "tidycal.com")) {
    return { provider: "tidycal", embedUrl: u.toString(), canEmbed: true };
  }

  return UNKNOWN;
}

/* ------------------------------------------------------------------ */
/* Lead-Prefill                                                        */
/* ------------------------------------------------------------------ */

const FIRST_NAME_KEYS = ["vorname", "firstname", "first_name", "first name"];
const LAST_NAME_KEYS = ["nachname", "lastname", "last_name", "last name"];
const EMAIL_KEYS = ["email", "e-mail", "mail", "e_mail", "emailadresse", "e-mail-adresse"];

function pickLeadValue(
  data: LeadData | undefined,
  wantedKeys: readonly string[],
): string | undefined {
  if (!data || typeof data !== "object") return undefined;
  const entries = Object.entries(data);
  for (const wanted of wantedKeys) {
    const hit = entries.find(
      ([key]) => key.trim().toLowerCase() === wanted,
    );
    if (!hit) continue;
    const value = typeof hit[1] === "string" ? hit[1].trim() : "";
    if (value) return value;
  }
  return undefined;
}

/**
 * Leitet Name + E-Mail defensiv aus den Lead-CSV-Spalten ab
 * (case-insensitive, deutsche + englische Spaltennamen). Vor- und
 * Nachname werden zu einem Anzeigenamen zusammengesetzt.
 */
export function bookingPrefillFromLead(
  leadData: LeadData | undefined,
): BookingPrefill {
  const first = pickLeadValue(leadData, FIRST_NAME_KEYS);
  const last = pickLeadValue(leadData, LAST_NAME_KEYS);
  const email = pickLeadValue(leadData, EMAIL_KEYS);
  const name = [first, last].filter(Boolean).join(" ") || undefined;
  const result: BookingPrefill = {};
  if (name) result.name = name;
  if (email) result.email = email;
  return result;
}
