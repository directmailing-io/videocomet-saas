"use client";

/**
 * Mini-Site-Tracker für videocomet.de (Marketing). Läuft NICHT auf
 * app.videocomet.de oder lp.videocomet.de — nur auf der Marketing-Site.
 *
 * Bewusst schlank:
 *  - Session-ID via sessionStorage (löscht sich beim Tab-Schließen)
 *  - PageView bei jedem Route-Wechsel (Next.js App Router)
 *  - Klick-Tracking auf <a> und <button> (Text + href, kein Coordinate-Log)
 *  - `navigator.sendBeacon` bevorzugt (blockiert Navigation nicht)
 *
 * Kein Consent-Zwang: wir speichern keine Cookies, keine persistente ID,
 * keine Weitergabe an Dritte — Zweckbindung „interne Reichweite".
 */

import * as React from "react";
import { usePathname, useSearchParams } from "next/navigation";

const MARKETING_HOSTS = new Set([
  "videocomet.de",
  "www.videocomet.de",
]);

function makeSessionId(): string {
  try {
    const existing = sessionStorage.getItem("vc-site-sid");
    if (existing && existing.length >= 8) return existing;
    const rnd = Array.from(crypto.getRandomValues(new Uint8Array(12)))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    sessionStorage.setItem("vc-site-sid", rnd);
    return rnd;
  } catch {
    // Storage blockiert → volatile Session-ID im Speicher (pro Page-Load neu).
    return Math.random().toString(16).slice(2);
  }
}

function readUtm(searchParams: URLSearchParams | null) {
  if (!searchParams) return undefined;
  const source = searchParams.get("utm_source");
  const medium = searchParams.get("utm_medium");
  const campaign = searchParams.get("utm_campaign");
  const content = searchParams.get("utm_content");
  const term = searchParams.get("utm_term");
  if (!source && !medium && !campaign && !content && !term) return undefined;
  return { source, medium, campaign, content, term };
}

function send(payload: Record<string, unknown>) {
  try {
    const body = JSON.stringify(payload);
    if (typeof navigator.sendBeacon === "function") {
      const blob = new Blob([body], { type: "application/json" });
      if (navigator.sendBeacon("/api/track/site", blob)) return;
    }
    void fetch("/api/track/site", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true,
    });
  } catch {
    /* schlucken */
  }
}

export function SiteTracker() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const sidRef = React.useRef<string | null>(null);
  const isMarketingRef = React.useRef<boolean | null>(null);

  // Host-Check nur clientseitig — SSR liefert kein window.
  React.useEffect(() => {
    if (typeof window === "undefined") return;
    isMarketingRef.current = MARKETING_HOSTS.has(window.location.hostname);
    if (!isMarketingRef.current) return;
    sidRef.current = makeSessionId();
  }, []);

  // PageView bei jedem Pathname-/SearchParams-Wechsel.
  React.useEffect(() => {
    if (!isMarketingRef.current) return;
    const sid = sidRef.current;
    if (!sid) return;
    send({
      sessionId: sid,
      event: "page_view",
      path: pathname,
      referrer: typeof document !== "undefined" ? document.referrer : null,
      utm: readUtm(searchParams),
    });
  }, [pathname, searchParams]);

  // Heartbeat alle 30s, solange der Tab sichtbar ist — damit „Live jetzt"
  // auch dann korrekt bleibt, wenn ein Besucher die Seite lange offen hat
  // ohne zu klicken. Kein Traffic-Overhead beim Server (kleiner INSERT).
  React.useEffect(() => {
    if (!isMarketingRef.current) return;
    const id = window.setInterval(() => {
      const sid = sidRef.current;
      if (!sid) return;
      if (document.visibilityState !== "visible") return;
      send({ sessionId: sid, event: "heartbeat", path: pathname });
    }, 30_000);
    return () => window.clearInterval(id);
  }, [pathname]);

  // Klick-Tracking auf <a> und <button> (bubbling).
  React.useEffect(() => {
    if (!isMarketingRef.current) return;
    function onClick(e: MouseEvent) {
      const sid = sidRef.current;
      if (!sid) return;
      const target = e.target as HTMLElement | null;
      const el = target?.closest("a, button") as
        | HTMLAnchorElement
        | HTMLButtonElement
        | null;
      if (!el) return;
      const label = (el.innerText || el.getAttribute("aria-label") || "").trim().slice(0, 120);
      const href = el.tagName === "A" ? (el as HTMLAnchorElement).href : null;
      send({
        sessionId: sid,
        event: "click",
        path: pathname,
        meta: {
          tag: el.tagName.toLowerCase(),
          label,
          href,
        },
      });
    }
    document.addEventListener("click", onClick, { capture: true, passive: true });
    return () => document.removeEventListener("click", onClick, { capture: true } as EventListenerOptions);
  }, [pathname]);

  return null;
}
