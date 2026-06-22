"use client";

import Link from "next/link";
import * as React from "react";
import { Logo } from "@/components/ui/logo";
import { cn } from "@/lib/utils";

/**
 * Fixed Top-Nav für die Marketing-Landingpage.
 * Bleibt komplett im Dark-Modus solange die HowItWorksSection (#how-it-works)
 * mit weissem Background noch nicht ins Viewport gerollt ist — also waehrend
 * Hero + DemoSection (beide dark). Erst dann wechselt sie in Light-Theme.
 */
export function MarketingNav() {
  const [overDark, setOverDark] = React.useState(true);

  React.useEffect(() => {
    const target = document.getElementById("how-it-works");
    if (!target) {
      // Fallback: alter scroll-basierter Trigger
      const onScroll = () =>
        setOverDark(window.scrollY < window.innerHeight * 3.5);
      onScroll();
      window.addEventListener("scroll", onScroll, { passive: true });
      return () => window.removeEventListener("scroll", onScroll);
    }
    // IntersectionObserver mit rootMargin so dass die Nav umschaltet,
    // sobald HowItWorks-Section ca. 60 px ueber den unteren Bildschirmrand
    // hinausragt — also wenn ihr Top den Nav-Bereich kreuzt.
    const obs = new IntersectionObserver(
      ([entry]) => {
        setOverDark(!entry.isIntersecting);
      },
      { rootMargin: "-60px 0px -85% 0px", threshold: 0 },
    );
    obs.observe(target);
    return () => obs.disconnect();
  }, []);

  return (
    <header
      className={cn(
        "fixed top-0 left-0 right-0 z-50 transition-colors duration-300",
        overDark
          ? "bg-transparent"
          : "bg-surface/85 backdrop-blur-md border-b border-line",
      )}
    >
      <div className="max-w-6xl mx-auto px-6 md:px-10 py-4 flex items-center justify-between">
        <Link
          href="/"
          aria-label="Zur Startseite"
          className="inline-flex items-center"
        >
          <Logo
            className={cn(
              "transition-[filter] duration-300",
              overDark && "brightness-0 invert",
            )}
          />
        </Link>
        <Link
          href="/login"
          className={cn(
            "text-sm font-medium transition-colors px-4 py-2 rounded-full",
            overDark
              ? "text-white/90 hover:text-white hover:bg-white/10"
              : "text-ink hover:text-brand-deep",
          )}
        >
          Login
        </Link>
      </div>
    </header>
  );
}
