"use client";

import * as React from "react";
import { getSvgPath } from "figma-squircle";
import { cn } from "@/lib/utils";

/**
 * Echter Apple-Squircle: Figma-Corner-Smoothing als clip-path (alle Browser),
 * Schatten als drop-shadow auf dem Wrapper — folgt exakt der Squircle-Form,
 * statt vom clip-path abgeschnitten zu werden.
 */

const SHADOWS = {
  none: undefined,
  // weich, mehrschichtig, violett getönt — für Cards auf hellem Grund
  pretty:
    "drop-shadow(0 1px 2px rgba(30,20,70,0.05)) drop-shadow(0 10px 22px rgba(60,40,130,0.10)) drop-shadow(0 28px 48px rgba(60,40,130,0.08))",
  // kräftiger — für schwebende Fenster/Overlays
  float:
    "drop-shadow(0 2px 6px rgba(30,20,70,0.08)) drop-shadow(0 18px 36px rgba(60,40,130,0.18)) drop-shadow(0 44px 80px rgba(60,40,130,0.14))",
} as const;

type SquircleProps = {
  /** Eckradius in px (wie border-radius) */
  radius?: number;
  /** Corner-Smoothing 0..1 — 0.8 ≈ Apple-Look */
  smoothing?: number;
  shadow?: keyof typeof SHADOWS;
  /** Layout-Klassen (Größe, Positionierung) — landet auf dem Shadow-Wrapper */
  wrapperClassName?: string;
  /** Oberfläche (bg, padding, flex) — landet auf dem geclippten Element */
  className?: string;
  style?: React.CSSProperties;
  children: React.ReactNode;
};

export function Squircle({
  radius = 28,
  smoothing = 0.8,
  shadow = "none",
  wrapperClassName,
  className,
  style,
  children,
}: SquircleProps) {
  const ref = React.useRef<HTMLDivElement>(null);
  const [path, setPath] = React.useState<string | null>(null);

  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => {
      const { width, height } = el.getBoundingClientRect();
      if (!width || !height) return;
      setPath(
        getSvgPath({
          width,
          height,
          cornerRadius: Math.min(radius, width / 2, height / 2),
          cornerSmoothing: smoothing,
          preserveSmoothing: true,
        }),
      );
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [radius, smoothing]);

  return (
    <div className={wrapperClassName} style={{ filter: SHADOWS[shadow] }}>
      <div
        ref={ref}
        className={cn("h-full", className)}
        style={{
          ...style,
          // Fallback bis zur ersten Messung (SSR / no-JS): normaler Radius
          ...(path
            ? { clipPath: `path("${path}")` }
            : { borderRadius: radius }),
        }}
      >
        {children}
      </div>
    </div>
  );
}
