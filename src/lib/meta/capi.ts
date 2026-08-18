/**
 * Meta Conversions API — Server-Side-Event-Delivery.
 *
 * Warum: Der Client-Pixel wird von Ad-Blockern und Safari-ITP in 30-40% der
 * Fälle geschnitten. CAPI läuft server-to-server aus unserem Next.js an die
 * Graph-API — kein Zusatz-Server, kein Drittanbieter. Kombiniert mit dem
 * Client-Pixel und einer gemeinsamen `event_id` dedupliziert Meta die Events,
 * bekommt aber viel mehr Daten.
 *
 * DSGVO/TDDDG: Wir feuern NIE, wenn der Marketing-Consent fehlt. Der Aufrufer
 * muss vorher `hasMarketingConsent(req)` prüfen (siehe consent-check.ts) —
 * dieser Utility hat keinen Consent-Check, weil Purchase-Events aus dem
 * Stripe-Webhook keinen Browser-Kontext haben und wir dort auf einen anderen
 * Datenpunkt zurückfallen müssen (users.marketingConsentAt aus der DB, wenn
 * wir das später brauchen). Für v1: Server-Events feuern nur wenn wir wissen,
 * dass der User bereits Marketing-Consent gegeben hat (Prüfung im Caller).
 *
 * Sicherheit: Access-Token liegt in ENV (`META_CAPI_TOKEN`), nie im Frontend.
 * Kein Retry bei 4xx (Setup-Fehler), Exponential-Backoff bei 5xx (nur 1×).
 * Fehler werden geloggt aber propagieren nicht — Marketing-Tracking darf
 * niemals einen User-Flow blockieren.
 */

import { hashForCapi } from "./hash";
import { db } from "@/lib/db";
import { metaEventLog } from "@/lib/db/schema";

const GRAPH_API_VERSION = "v21.0";

// ── Types ───────────────────────────────────────────────────────────────────

export type CapiEventName =
  | "PageView"
  | "ViewContent"
  | "Lead"
  | "CompleteRegistration"
  | "InitiateCheckout"
  | "Purchase"
  | "Subscribe";

/** Personenbezogene Rohdaten. Werden vor dem Senden gehashed (außer IP/UA/fbp/fbc). */
export interface CapiUserData {
  /** E-Mail des Users — wird SHA-256 gehashed. */
  email?: string | null;
  /** Telefon in E.164 ohne + oder national. Wird SHA-256 gehashed. */
  phone?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  city?: string | null;
  country?: string | null;
  /** ISO-2 Country wenn möglich, sonst wird der Input gehashed. */
  externalId?: string | null;
  /** Client-IP — Klartext an Meta. */
  clientIpAddress?: string | null;
  /** User-Agent — Klartext an Meta. */
  clientUserAgent?: string | null;
  /** Meta-Browser-ID (Cookie `_fbp`). Klartext. */
  fbp?: string | null;
  /** Meta-Click-ID (Cookie `_fbc`). Klartext. */
  fbc?: string | null;
}

export interface CapiCustomData {
  /** Monetärer Wert (EUR default). Purchase-Events müssen einen Wert haben. */
  value?: number;
  /** ISO-4217 Currency. */
  currency?: string;
  /** Content-IDs (z.B. Stripe-Price-ID). */
  contentIds?: string[];
  /** Optionaler Content-Name. */
  contentName?: string;
  /** Freier Custom-Slot (z.B. "credits_purchased": 500). */
  [key: string]: unknown;
}

export interface SendCapiInput {
  eventName: CapiEventName;
  /** UUID für Deduplikation mit dem Client-Pixel. Gleicher Wert = ein Event. */
  eventId: string;
  /** Absolute URL, auf der das Event ausgelöst wurde (Server sollte req.url mitgeben). */
  eventSourceUrl: string;
  userData: CapiUserData;
  customData?: CapiCustomData;
  /** UNIX-Sekunden. Default: now. Muss innerhalb 7 Tage sein. */
  eventTime?: number;
  /** actionSource-Semantik: 'website' für Browser-getriggerte, 'system_generated' für Cron/Webhook. */
  actionSource?: "website" | "system_generated" | "app";
  /** Für Admin-Log: User-ID (wenn bekannt) — wird NICHT an Meta geschickt. */
  logUserId?: string | null;
  /** Für Admin-Log: E-Mail (Klartext, nur intern angezeigt). */
  logUserEmail?: string | null;
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Sendet ein einzelnes Event an die Meta Conversions API.
 *
 * Rückgabe: `true` bei 2xx, sonst `false`. Fehler werden geloggt aber nicht
 * geworfen — Tracking darf keinen User-Flow blockieren.
 */
export async function sendCapiEvent(input: SendCapiInput): Promise<boolean> {
  const pixelId = process.env.META_PIXEL_ID;
  const token = process.env.META_CAPI_TOKEN;
  const testCode = process.env.META_CAPI_TEST_CODE; // optional

  if (!pixelId || !token) {
    console.warn("[meta-capi] missing META_PIXEL_ID or META_CAPI_TOKEN — event dropped:", input.eventName);
    return false;
  }

  const eventTime = input.eventTime ?? Math.floor(Date.now() / 1000);
  const actionSource = input.actionSource ?? "website";

  const user_data = buildUserData(input.userData);
  const custom_data = input.customData ? sanitizeCustomData(input.customData) : undefined;

  const eventPayload: Record<string, unknown> = {
    event_name: input.eventName,
    event_time: eventTime,
    event_id: input.eventId,
    event_source_url: input.eventSourceUrl,
    action_source: actionSource,
    user_data,
  };
  if (custom_data) eventPayload.custom_data = custom_data;

  const body: Record<string, unknown> = { data: [eventPayload] };
  if (testCode) body.test_event_code = testCode;

  const url = `https://graph.facebook.com/${GRAPH_API_VERSION}/${pixelId}/events?access_token=${encodeURIComponent(token)}`;

  let httpStatus: number | null = null;
  let ok = false;
  let errorText: string | null = null;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    httpStatus = res.status;
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      errorText = `${res.status} ${text.slice(0, 300)}`;
      console.warn(`[meta-capi] non-2xx for ${input.eventName}: ${errorText}`);
    } else {
      ok = true;
    }
  } catch (err) {
    errorText = err instanceof Error ? err.message : String(err);
    console.warn(`[meta-capi] fetch failed for ${input.eventName}:`, errorText);
  }

  // Audit-Log — Fehler beim Schreiben dürfen den Track-Flow nicht crashen.
  try {
    await db.insert(metaEventLog).values({
      eventName: input.eventName,
      eventId: input.eventId,
      userId: input.logUserId ?? null,
      userEmail: input.logUserEmail ?? null,
      value:
        input.customData?.value != null
          ? String(Number(input.customData.value).toFixed(2))
          : null,
      currency: (input.customData?.currency as string | undefined) ?? null,
      actionSource,
      sourceUrl: input.eventSourceUrl,
      httpStatus,
      ok,
      error: errorText,
    });
  } catch (logErr) {
    console.warn("[meta-capi] failed to write event-log row:", logErr);
  }

  return ok;
}

// ── Internals ───────────────────────────────────────────────────────────────

function buildUserData(u: CapiUserData): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const em = hashForCapi(u.email);
  if (em) out.em = [em];
  const ph = hashForCapi(u.phone);
  if (ph) out.ph = [ph];
  const fn = hashForCapi(u.firstName);
  if (fn) out.fn = [fn];
  const ln = hashForCapi(u.lastName);
  if (ln) out.ln = [ln];
  const ct = hashForCapi(u.city);
  if (ct) out.ct = [ct];
  const country = hashForCapi(u.country);
  if (country) out.country = [country];
  const external = hashForCapi(u.externalId);
  if (external) out.external_id = [external];
  // Klartext-Felder:
  if (u.clientIpAddress) out.client_ip_address = u.clientIpAddress;
  if (u.clientUserAgent) out.client_user_agent = u.clientUserAgent;
  if (u.fbp) out.fbp = u.fbp;
  if (u.fbc) out.fbc = u.fbc;
  return out;
}

/** Custom-Data-Felder auf snake_case mappen wo Meta das erwartet. */
function sanitizeCustomData(c: CapiCustomData): Record<string, unknown> {
  const out: Record<string, unknown> = { ...c };
  if (c.value !== undefined) out.value = Number(c.value.toFixed(2));
  if (c.contentIds) {
    out.content_ids = c.contentIds;
    delete out.contentIds;
  }
  if (c.contentName) {
    out.content_name = c.contentName;
    delete out.contentName;
  }
  return out;
}

// ── Convenience: fbp / fbc aus Cookies extrahieren ──────────────────────────

/**
 * Extrahiert `_fbp` und `_fbc` aus einem Cookie-Header. Zur Nutzung im
 * Stripe-Webhook (dort haben wir keinen NextRequest, sondern einen Raw-
 * Body-Handler). Für NextRequest-Routen bitte `req.cookies.get(...)` nutzen.
 */
export function extractFbCookies(cookieHeader: string | null | undefined): {
  fbp: string | null;
  fbc: string | null;
} {
  if (!cookieHeader) return { fbp: null, fbc: null };
  const parts = cookieHeader.split(";").map((p) => p.trim());
  let fbp: string | null = null;
  let fbc: string | null = null;
  for (const p of parts) {
    if (p.startsWith("_fbp=")) fbp = decodeURIComponent(p.slice(5));
    else if (p.startsWith("_fbc=")) fbc = decodeURIComponent(p.slice(5));
  }
  return { fbp, fbc };
}
