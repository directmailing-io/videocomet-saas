"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { track } from "@/lib/tracker";

/**
 * Sticky-Mobile-CTA-Leiste (Konzept Abschnitt 4, Smartphone hoch):
 * fixe Leiste unten mit EINEM Button, die erst erscheint, wenn der Hero
 * aus dem Viewport gescrollt ist. Klick scrollt sanft zum ersten
 * CTA-Banner-Block.
 *
 * Verdrahtung ueber data-Attribute, die `landing-render.tsx` an die
 * Block-Wrapper haengt:
 *   - `[data-lp-hero]` — Sichtbarkeits-Marker (IntersectionObserver)
 *   - `[data-lp-cta]`  — Scroll-Ziel (erster cta-banner-Block)
 *
 * Nur auf Smartphones sichtbar (`md:hidden`); ob sie ueberhaupt
 * gerendert wird, entscheidet der Server (theme.stickyCta !== false und
 * es existiert ein CTA-Block).
 */

export interface StickyCtaProps {
  /** Button-Label; Default kommt aus dem Server ("Termin buchen"). */
  label: string;
}

export function StickyCta({ label }: StickyCtaProps) {
  const [visible, setVisible] = React.useState(false);

  React.useEffect(() => {
    const hero = document.querySelector("[data-lp-hero]");
    if (!hero) {
      // Seiten ohne Hero: nach kurzem Scroll einblenden.
      const onScroll = () => setVisible(window.scrollY > 200);
      onScroll();
      window.addEventListener("scroll", onScroll, { passive: true });
      return () => window.removeEventListener("scroll", onScroll);
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        // Sichtbar erst, wenn der Hero komplett NACH OBEN rausgescrollt
        // ist — nicht schon beim initialen Laden unterhalb des Folds.
        const scrolledPast =
          !entry.isIntersecting && entry.boundingClientRect.bottom < 0;
        setVisible(scrolledPast);
      },
      { threshold: 0 },
    );
    observer.observe(hero);
    return () => observer.disconnect();
  }, []);

  const handleClick = React.useCallback(() => {
    track("cta_click", { label, url: "#cta", position: "primary" });
    const target = document.querySelector("[data-lp-cta]");
    if (target) target.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [label]);

  return (
    <div
      className={cn(
        "fixed inset-x-0 bottom-0 z-50 md:hidden",
        "transition-all duration-300 ease-out",
        visible
          ? "translate-y-0 opacity-100"
          : "pointer-events-none translate-y-full opacity-0",
      )}
      style={{
        background: "var(--lp-color-surface)",
        borderTop: "1px solid var(--lp-color-border)",
        paddingBottom: "env(safe-area-inset-bottom)",
      }}
    >
      <div className="px-4 py-3">
        <button
          type="button"
          onClick={handleClick}
          className={cn(
            "inline-flex min-h-[48px] w-full items-center justify-center px-7 py-3",
            "text-sm font-semibold transition-all duration-150",
            "bg-[color:var(--lp-color-primary)] hover:bg-[color:var(--lp-color-primary-hover)]",
          )}
          style={{
            color: "var(--lp-color-on-primary)",
            borderRadius: "var(--lp-radius-button)",
            boxShadow: "var(--lp-shadow-cta)",
          }}
        >
          {label}
        </button>
      </div>
    </div>
  );
}
