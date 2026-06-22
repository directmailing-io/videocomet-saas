"use client";

import * as React from "react";

/**
 * Cinematic Reveal-on-Scroll: laenger als ein normales Fade-up, mit
 * dezentem Scale + Blur → wirkt wie ein Apple-Keynote-Crossfade.
 * Stagger via `delay`-Prop.
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
      { threshold: 0.12, rootMargin: "0px 0px -6% 0px" },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  return (
    <Tag
      ref={ref}
      className={className}
      style={{
        opacity: visible ? 1 : 0,
        transform: visible
          ? "translateY(0) scale(1)"
          : "translateY(40px) scale(0.96)",
        filter: visible ? "blur(0px)" : "blur(8px)",
        transition: `opacity 1400ms cubic-bezier(0.2,0.8,0.2,1) ${delay}ms, transform 1400ms cubic-bezier(0.2,0.8,0.2,1) ${delay}ms, filter 1100ms cubic-bezier(0.2,0.8,0.2,1) ${delay}ms`,
        willChange: "opacity, transform, filter",
      }}
    >
      {children}
    </Tag>
  );
}
