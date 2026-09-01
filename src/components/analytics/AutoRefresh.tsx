"use client";

/**
 * Refresht die Server-Component-Route alle N Sekunden (Next.js
 * router.refresh() re-fetcht nur die Server-Daten, kein Full-Reload).
 * Verwendet für Live-Analytics-Ansichten.
 *
 * Pausiert automatisch, wenn der Tab im Hintergrund ist — spart Server-Load
 * und bringt keinen Nutzen, weil der User ihn nicht sieht.
 */

import * as React from "react";
import { useRouter } from "next/navigation";

export function AutoRefresh({ intervalMs = 5000 }: { intervalMs?: number }) {
  const router = useRouter();
  const [ts, setTs] = React.useState<number>(() => Date.now());

  React.useEffect(() => {
    let cancelled = false;
    const tick = () => {
      if (cancelled) return;
      if (document.visibilityState !== "visible") return;
      router.refresh();
      setTs(Date.now());
    };
    const id = window.setInterval(tick, intervalMs);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [intervalMs, router]);

  const secondsAgo = Math.max(0, Math.round((Date.now() - ts) / 1000));
  return (
    <span className="text-xs text-ink-muted">
      Live · aktualisiert alle {Math.round(intervalMs / 1000)} Sek
      {secondsAgo > 0 ? ` (vor ${secondsAgo}s)` : ""}
    </span>
  );
}
