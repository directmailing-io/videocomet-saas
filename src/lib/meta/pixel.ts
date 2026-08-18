"use client";

/**
 * Client-Side-Helper für den Meta Pixel.
 *
 * Der Base-Snippet (fbq init + PageView) wird vom `<MetaPixelLoader />` in
 * die Seite injiziert. Diese Datei bietet Wrapper-Funktionen für Events, die
 * die App an bestimmten Punkten feuern will (z.B. InitiateCheckout).
 *
 * Wichtige Semantik:
 *   - Jedes Event bekommt eine `eventID` (Deduplikation mit dem CAPI-Event).
 *   - Wenn `fbq` nicht geladen ist (Consent fehlt / AdBlocker), noop —
 *     kein Log, kein Werfen, damit keine User-Flows blockieren.
 */

type FbqFn = (
  command: "init" | "track" | "trackCustom" | "consent",
  eventName?: string,
  params?: Record<string, unknown>,
  options?: { eventID?: string },
) => void;

declare global {
  interface Window {
    fbq?: FbqFn & { queue?: unknown[]; loaded?: boolean };
    _fbq?: unknown;
  }
}

/** Feuert ein Standard-Event mit optionaler eventID (für Deduplikation). */
export function trackStandard(
  eventName:
    | "PageView"
    | "ViewContent"
    | "Lead"
    | "CompleteRegistration"
    | "InitiateCheckout"
    | "Purchase"
    | "Subscribe",
  params?: Record<string, unknown>,
  eventId?: string,
): void {
  if (typeof window === "undefined" || !window.fbq) return;
  try {
    if (eventId) {
      window.fbq("track", eventName, params, { eventID: eventId });
    } else {
      window.fbq("track", eventName, params);
    }
  } catch {
    /* noop */
  }
}

/** Feuert ein Custom-Event (nur für Custom Audiences, nicht für Optimierung). */
export function trackCustom(
  eventName: string,
  params?: Record<string, unknown>,
  eventId?: string,
): void {
  if (typeof window === "undefined" || !window.fbq) return;
  try {
    if (eventId) {
      window.fbq("trackCustom", eventName, params, { eventID: eventId });
    } else {
      window.fbq("trackCustom", eventName, params);
    }
  } catch {
    /* noop */
  }
}

/** Erzeugt eine kryptografisch zufällige Event-ID (UUID v4 wenn verfügbar). */
export function newEventId(): string {
  try {
    const c = (globalThis as unknown as { crypto?: { randomUUID?: () => string } }).crypto;
    if (c?.randomUUID) return c.randomUUID();
  } catch {
    /* ignore */
  }
  return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 10)}`;
}
