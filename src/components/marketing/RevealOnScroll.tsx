"use client";

import * as React from "react";

/**
 * Reveal-on-Scroll: kurzes Fade-up mit dezentem Scale + Blur.
 * Stagger via `delay`-Prop — wird intern gestaucht und gekappt, damit
 * auch bei schnellem Scrollen nichts nachhinkt.
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
      // Positive Bottom-Margin: Elemente starten kurz bevor sie im
      // Viewport sind — bei schnellem Scrollen wirkt nichts verspätet.
      { threshold: 0, rootMargin: "0px 0px 10% 0px" },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const effectiveDelay = Math.min(delay * 0.35, 320);

  return (
    <Tag
      ref={ref}
      className={className}
      style={{
        opacity: visible ? 1 : 0,
        transform: visible
          ? "translateY(0) scale(1)"
          : "translateY(24px) scale(0.98)",
        filter: visible ? "blur(0px)" : "blur(5px)",
        transition: `opacity 600ms cubic-bezier(0.2,0.8,0.2,1) ${effectiveDelay}ms, transform 600ms cubic-bezier(0.2,0.8,0.2,1) ${effectiveDelay}ms, filter 450ms cubic-bezier(0.2,0.8,0.2,1) ${effectiveDelay}ms`,
        willChange: "opacity, transform, filter",
      }}
    >
      {children}
    </Tag>
  );
}
