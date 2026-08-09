"use client";

import * as React from "react";

/**
 * Reveal-on-Scroll: kurzes Fade-up, nur opacity + transform.
 * Bewusst KEIN blur()-Filter: animierte Filter zwingen den Browser bei
 * grossen Cards in teure Repaints und fuehlen sich beim Scrollen traege
 * an (Daniel-Feedback 2026-08-09). Stagger via `delay`-Prop — wird
 * intern gestaucht und gekappt, damit bei schnellem Scrollen nichts
 * nachhinkt.
 */
export function RevealOnScroll({
  children,
  delay = 0,
  className = "",
  as: Tag = "div",
}: {
  children: React.ReactNode;
  delay?: number;
  className?: string;
  as?: React.ElementType;
}) {
  const ref = React.useRef<HTMLElement>(null);
  const [visible, setVisible] = React.useState(false);

  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          obs.unobserve(el);
        }
      },
      // Positive Bottom-Margin: Elemente starten deutlich bevor sie im
      // Viewport sind — bei schnellem Scrollen wirkt nichts verspätet
      // (Daniel-Feedback 2026-08-09: Cards erschienen noch zu spät).
      { threshold: 0, rootMargin: "0px 0px 30% 0px" },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const effectiveDelay = Math.min(delay * 0.2, 120);

  return (
    <Tag
      ref={ref}
      className={className}
      style={{
        opacity: visible ? 1 : 0,
        transform: visible ? "translateY(0)" : "translateY(12px)",
        transition: `opacity 360ms cubic-bezier(0.2,0.8,0.2,1) ${effectiveDelay}ms, transform 360ms cubic-bezier(0.2,0.8,0.2,1) ${effectiveDelay}ms`,
        // Layer nur waehrend der Animation vorhalten, danach freigeben —
        // sonst haelt jede Card dauerhaft einen Compositor-Layer.
        willChange: visible ? "auto" : "opacity, transform",
      }}
    >
      {children}
    </Tag>
  );
}
