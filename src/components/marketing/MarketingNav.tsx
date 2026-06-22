"use client";

import Link from "next/link";
import * as React from "react";
import { Logo } from "@/components/ui/logo";
import { cn } from "@/lib/utils";

/**
 * Fixed Top-Nav für die Marketing-Landingpage.
 * Transparent über dem Dark-Hero (weißes Logo via CSS-Filter, weiße Links).
 * Wechselt zu hellem Theme (weißer Hintergrund, dunkles Logo) sobald der
 * 320vh-Hero verlassen wird.
 */
export function MarketingNav() {
  const [overDark, setOverDark] = React.useState(true);

  React.useEffect(() => {
    const onScroll = () => {
      // Hero ist 320vh hoch. Sticky-Inhalt 100vh. Visuell wird die Section
      // bei ca. scrollY > 280vh "ausgeblendet" (Fade-to-Black-Phase 78–100%
      // entspricht 250–320 vh). Nav-Wechsel ein bisschen vorher.
      setOverDark(window.scrollY < window.innerHeight * 2.5);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
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
