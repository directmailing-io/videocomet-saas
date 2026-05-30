"use client";

import * as React from "react";
import { setTrackingSlug, track } from "@/lib/tracker";

/**
 * Mount-time tracker bootstrap.
 *
 * Caches the slug on the tracker module (so call-sites don't need to thread
 * it through props) and fires a `page_view` event from the client — the
 * server cannot observe referrer or browser language, so this is the only
 * place where those fields can be populated.
 *
 * Runs exactly once per page load thanks to the empty dependency array; the
 * `firedRef` guard protects against React strict-mode double-invocations
 * during development.
 */
export function TrackerInit({ slug }: { slug: string }) {
  const firedRef = React.useRef(false);

  React.useEffect(() => {
    if (firedRef.current) return;
    firedRef.current = true;
    setTrackingSlug(slug);
    track("page_view", {
      referrer: typeof document !== "undefined" ? document.referrer : "",
      language:
        typeof navigator !== "undefined" ? navigator.language : undefined,
    });
  }, [slug]);

  return null;
}
