/**
 * Public landing-page tracker.
 *
 * Ships fire-and-forget analytics events to `/api/track/event`. Two design
 * constraints shape this module:
 *
 *  1. Events MUST survive page-unload (e.g. CTA click → immediate navigate).
 *     `navigator.sendBeacon` is preferred for exactly that; we fall back to
 *     `fetch({ keepalive: true })` when it is unavailable or rejects the
 *     payload (some Safari versions are picky about blob types).
 *  2. Tracking MUST NEVER throw or block the page. Every code path is
 *     wrapped in a try/catch and failures are silently swallowed.
 *
 * The slug is cached at module scope after the first `setTrackingSlug`
 * call so individual call-sites (video player, CTA buttons) do not need to
 * thread it through props.
 */

const ENDPOINT = "/api/track/event";

export type TrackKind =
  | "page_view"
  | "video_play"
  | "video_progress"
  | "video_ended"
  | "cta_click";

let cachedSlug: string | null = null;

export function setTrackingSlug(slug: string): void {
  cachedSlug = slug;
}

export function getTrackingSlug(): string | null {
  return cachedSlug;
}

/**
 * Sends a tracking event. Uses sendBeacon if available (survives page
 * unload), otherwise fetch with keepalive. Never throws; tracking is
 * fire-and-forget.
 */
export function track(
  kind: TrackKind,
  payload?: Record<string, unknown>,
): void {
  if (!cachedSlug) return;
  try {
    const body = JSON.stringify({ slug: cachedSlug, kind, payload });
    if (
      typeof navigator !== "undefined" &&
      typeof navigator.sendBeacon === "function"
    ) {
      try {
        const blob = new Blob([body], { type: "application/json" });
        const ok = navigator.sendBeacon(ENDPOINT, blob);
        if (ok) return;
      } catch {
        // fall through to fetch
      }
    }
    if (typeof fetch === "function") {
      fetch(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        keepalive: true,
      }).catch(() => undefined);
    }
  } catch {
    /* swallow — tracking must never break the page */
  }
}
