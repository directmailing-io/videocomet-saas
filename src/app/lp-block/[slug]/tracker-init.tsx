"use client";

import * as React from "react";
import { setPreviewMode, setTrackingSlug, track } from "@/lib/tracker";

/**
 * Mount-time tracker bootstrap.
 *
 * Caches the slug on the tracker module (so call-sites don't need to thread
 * it through props) and fires a `page_view` event from the client — the
 * server cannot observe referrer or browser language, so this is the only
 * place where those fields can be populated.
 *
 * Preview mode:
 *  - If `initialPreview` (server-detected via cookie) is true, OR the URL
 *    carries `?preview=1`, ALL tracking becomes a no-op.
 *  - The `vc_preview` cookie is (re-)written for 1h so subsequent navigations
 *    to other personalised pages in the same browser session also bypass
 *    tracking without needing the param.
 *  - A small fixed pill is rendered at the top of the page so the internal
 *    tester can SEE that tracking is disabled.
 *
 * Runs exactly once per page load thanks to the empty dependency array; the
 * `firedRef` guard protects against React strict-mode double-invocations
 * during development.
 */
export function TrackerInit({
  slug,
  initialPreview,
}: {
  slug: string;
  initialPreview: boolean;
}) {
  const firedRef = React.useRef(false);
  const [previewActive, setPreviewActive] = React.useState(initialPreview);

  React.useEffect(() => {
    if (firedRef.current) return;
    firedRef.current = true;

    // Resolve preview mode: server hint OR URL param.
    let preview = initialPreview;
    try {
      if (
        typeof window !== "undefined" &&
        window.location.search.includes("preview=1")
      ) {
        preview = true;
      }
    } catch {
      /* swallow */
    }

    if (preview) {
      setPreviewMode(true);
      setPreviewActive(true);
      // Persist the bypass for 1h so the user can navigate around in the
      // app without re-adding the URL param. Session-cookie alternative
      // would lose state on tab close — 1h is a sensible session length
      // for previewing campaigns.
      try {
        if (typeof document !== "undefined") {
          document.cookie =
            "vc_preview=1; Path=/; Max-Age=3600; SameSite=Lax";
        }
      } catch {
        /* swallow */
      }
      // Skip page_view emission entirely — track() would no-op anyway, but
      // we save the fetch/sendBeacon roundtrip.
      setTrackingSlug(slug);
      return;
    }

    setTrackingSlug(slug);
    track("page_view", {
      referrer: typeof document !== "undefined" ? document.referrer : "",
      language:
        typeof navigator !== "undefined" ? navigator.language : undefined,
    });
  }, [slug, initialPreview]);

  if (!previewActive) return null;
  return <PreviewBadge />;
}

/**
 * Sichtbarer Hinweis am oberen Rand: aktiver Vorschau-Modus DEAKTIVIERT
 * jegliches Tracking — sonst wundert sich der Tester, warum sein
 * Aktivitäts-Feed leer bleibt. Inklusive "Vorschau beenden"-Button der
 * den Cookie löscht und neu lädt → live Tracking aktiv.
 */
function PreviewBadge() {
  function exitPreview() {
    try {
      // Cookie expiren + Page-State reset
      document.cookie = "vc_preview=; Path=/; Max-Age=0; SameSite=Lax";
      // URL-Param entfernen, sonst greift er sofort wieder
      const url = new URL(window.location.href);
      url.searchParams.delete("preview");
      window.location.replace(url.toString());
    } catch {
      window.location.reload();
    }
  }
  return (
    <div className="fixed left-1/2 top-3 z-[100] -translate-x-1/2 max-w-[92vw]">
      <div className="flex items-center gap-2 rounded-full bg-amber-100 border border-amber-300 px-3 py-1.5 text-xs sm:text-sm font-semibold text-amber-900 shadow-lg">
        <span className="inline-block size-2 rounded-full bg-amber-500 animate-pulse" aria-hidden="true" />
        <span>Vorschau-Modus aktiv — Tracking ist deaktiviert</span>
        <button
          type="button"
          onClick={exitPreview}
          className="ml-1 rounded-full bg-amber-900 text-amber-50 px-2.5 py-0.5 text-[11px] font-bold hover:bg-amber-800 transition-colors"
        >
          Vorschau beenden
        </button>
      </div>
    </div>
  );
}
