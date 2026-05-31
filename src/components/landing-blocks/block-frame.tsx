import * as React from "react";
import { cn } from "@/lib/utils";
import type {
  BlockAlignment,
  BlockMaxWidth,
  BlockPadding,
  BlockStyle,
} from "@/lib/landing-blocks/types";

/**
 * Shared wrapper that every block renders inside. Centralises the
 * mapping from per-block `style` overrides (background, text colour,
 * padding, alignment, max-width) to the actual CSS so individual block
 * components stay tiny and focused on layout-of-their-payload.
 *
 * Layout contract:
 *   - Outer `<section>` carries background colour + vertical padding so
 *     the colour bleeds full-bleed across the viewport, even when the
 *     inner content is constrained.
 *   - Inner `<div>` constrains content width and applies horizontal
 *     gutters that match the rest of the public page (px-5).
 */

const PADDING_Y_CLASS: Record<BlockPadding, string> = {
  sm: "py-6 sm:py-8",
  md: "py-10 sm:py-14",
  lg: "py-16 sm:py-24",
};

const MAX_WIDTH_CLASS: Record<BlockMaxWidth, string> = {
  narrow: "max-w-2xl",
  normal: "max-w-3xl",
  wide: "max-w-5xl",
  full: "max-w-none",
};

const ALIGN_CLASS: Record<BlockAlignment, string> = {
  left: "text-left",
  center: "text-center",
  right: "text-right",
};

export interface BlockFrameProps {
  style?: BlockStyle;
  /** Fallback values when `style` does not specify them. */
  defaults?: {
    paddingY?: BlockPadding;
    maxWidth?: BlockMaxWidth;
    alignment?: BlockAlignment;
  };
  /** Extra classes to merge onto the inner content wrapper. */
  innerClassName?: string;
  children: React.ReactNode;
}

export function BlockFrame({
  style,
  defaults,
  innerClassName,
  children,
}: BlockFrameProps) {
  const paddingY = style?.paddingY ?? defaults?.paddingY ?? "md";
  const maxWidth = style?.maxWidth ?? defaults?.maxWidth ?? "normal";
  const alignment = style?.alignment ?? defaults?.alignment ?? "center";

  const outerStyle: React.CSSProperties = {};
  if (style?.bgColor) outerStyle.backgroundColor = style.bgColor;
  if (style?.textColor) outerStyle.color = style.textColor;

  return (
    <section
      className={cn("w-full", PADDING_Y_CLASS[paddingY])}
      style={outerStyle}
    >
      <div
        className={cn(
          "mx-auto w-full px-5",
          MAX_WIDTH_CLASS[maxWidth],
          ALIGN_CLASS[alignment],
          innerClassName,
        )}
      >
        {children}
      </div>
    </section>
  );
}
