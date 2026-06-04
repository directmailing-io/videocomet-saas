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

// Stealth-Path: viele Browser-AdBlocker (uBlock-Default-Filter, EasyList,
// Brave-Shields) blockieren reflexartig Pfade die "track" oder "analytics"
// enthalten. `/c` ist same-origin und unverdächtig.
const ENDPOINT = "/c";

export type TrackKind =
  | "page_view"
  | "video_play"
  | "video_progress"
  | "video_ended"
  | "cta_click";

let cachedSlug: string | null = null;
let previewMode = false;

export function setTrackingSlug(slug: string): void {
  cachedSlug = slug;
}

export function getTrackingSlug(): string | null {
  return cachedSlug;
}

/**
 * Toggles preview mode. When `true`, all subsequent `track()` calls become
 * no-ops. Used when an internal user opens the landing page via an
 * authenticated link (`?preview=1` URL param or `vc_preview` cookie) so
 * test-clicks don't pollute production analytics.
 */
export function setPreviewMode(enabled: boolean): void {
  previewMode = enabled;
}

export function isPreviewMode(): boolean {
  return previewMode;
}

/**
 * Sends a tracking event. Uses sendBeacon if available (survives page
 * unload), otherwise fetch with keepalive. Never throws; tracking is
 * fire-and-forget. Becomes a no-op while preview-mode is active.
 */
export function track(
  kind: TrackKind,
  payload?: Record<string, unknown>,
): void {
  if (previewMode) return;
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
