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
 * Fixed pill at the top of the viewport telling the internal tester that
 * tracking is disabled. Keep it subtle — leads should never see it (it only
 * renders when preview-mode is active), but if they did the language is
 * still neutral enough not to scare them.
 */
function PreviewBadge() {
  return (
    <div className="fixed left-1/2 top-3 z-[100] -translate-x-1/2">
      <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 border border-amber-300 px-3 py-1 text-xs font-semibold text-amber-900 shadow">
        <span
          className="inline-block size-1.5 rounded-full bg-amber-500"
          aria-hidden="true"
        />
        Vorschau-Modus · kein Tracking
      </span>
    </div>
  );
}
