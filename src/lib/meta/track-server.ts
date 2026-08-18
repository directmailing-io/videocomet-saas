/**
 * Convenience-Wrapper für Server-Side-Events (Signup, Verify, Stripe-Webhook).
 *
 * Alle Helper hier:
 *  - sind fire-and-forget (Fehler werden geschluckt, blockieren nie den Flow)
 *  - erzeugen selbst eine `event_id` (UUID v4), damit das Deduplikations-
 *    Signal an Meta gegeben ist
 *  - lesen `_fbp` / `_fbc` aus dem Cookie-Header (wenn vorhanden)
 *
 * Consent-Handling:
 *  - Lead / CompleteRegistration / InitiateCheckout / ViewContent kommen mit
 *    einem NextRequest → wir prüfen dort den vc_consent-Cookie.
 *  - Purchase / Subscribe kommen aus dem Stripe-Webhook (kein Browser-
 *    Kontext, kein Cookie) → wir feuern immer, weil ein abgeschlossenes
 *    Rechtsgeschäft nach DSGVO Art. 6 (1)(b) auch ohne Marketing-Consent
 *    für Buchführung/Attribution zulässig ist (Meta-Zweck ist Berichts-
 *    genauigkeit unserer eigenen Kampagne, nicht Retargeting).
 */

import type { NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import { extractFbCookies, sendCapiEvent, type CapiEventName, type CapiUserData, type CapiCustomData } from "./capi";
import { hasMarketingConsent } from "./consent-check";

function reqUserAgent(req: NextRequest): string | null {
  return req.headers.get("user-agent");
}

function reqIp(req: NextRequest): string | null {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  return (
    req.headers.get("x-real-ip") ??
    req.headers.get("cf-connecting-ip") ??
    req.headers.get("true-client-ip") ??
    null
  );
}

function buildEventSourceUrl(req: NextRequest): string {
  // Referer bevorzugt (echte User-Ansicht), sonst Request-URL.
  const referer = req.headers.get("referer");
  if (referer) return referer;
  return req.url;
}

/**
 * Sendet ein Browser-Event via CAPI, wenn der User Marketing-Consent hat.
 * `eventId` optional — nutze den gleichen Wert, den auch der Client-Pixel
 * gefeuert hat, sonst zählt Meta doppelt.
 */
export async function trackServerBrowserEvent(input: {
  req: NextRequest;
  eventName: CapiEventName;
  eventId?: string;
  userData: Omit<CapiUserData, "clientIpAddress" | "clientUserAgent" | "fbp" | "fbc">;
  customData?: CapiCustomData;
  logUserId?: string | null;
}): Promise<void> {
  try {
    if (!hasMarketingConsent(input.req)) return;
    const cookieHeader = input.req.headers.get("cookie");
    const { fbp, fbc } = extractFbCookies(cookieHeader);
    await sendCapiEvent({
      eventName: input.eventName,
      eventId: input.eventId ?? randomUUID(),
      eventSourceUrl: buildEventSourceUrl(input.req),
      actionSource: "website",
      userData: {
        ...input.userData,
        clientIpAddress: reqIp(input.req),
        clientUserAgent: reqUserAgent(input.req),
        fbp,
        fbc,
      },
      customData: input.customData,
      logUserId: input.logUserId ?? (input.userData.externalId ?? null),
      logUserEmail: input.userData.email ?? null,
    });
  } catch (err) {
    console.warn(`[meta:track-server] ${input.eventName} failed:`, err);
  }
}

/**
 * Sendet ein System-Event (Stripe-Webhook) via CAPI.
 *
 * Diese Events werden ohne Consent-Check gesendet, weil sie ein
 * abgeschlossenes Rechtsgeschäft dokumentieren (Kauf) und Meta damit die
 * Kampagnen-Attribution bekommt — nicht personenbezogenes Retargeting.
 */
export async function trackSystemPurchaseEvent(input: {
  eventName: "Purchase" | "Subscribe";
  eventId: string;
  eventSourceUrl?: string;
  userData: Omit<CapiUserData, "clientIpAddress" | "clientUserAgent" | "fbp" | "fbc">;
  customData: CapiCustomData;
  logUserId?: string | null;
}): Promise<void> {
  try {
    await sendCapiEvent({
      eventName: input.eventName,
      eventId: input.eventId,
      eventSourceUrl:
        input.eventSourceUrl ?? "https://videocomet.de/signup/success",
      actionSource: "system_generated",
      userData: input.userData,
      customData: input.customData,
      logUserId: input.logUserId ?? (input.userData.externalId ?? null),
      logUserEmail: input.userData.email ?? null,
    });
  } catch (err) {
    console.warn(`[meta:track-system] ${input.eventName} failed:`, err);
  }
}
