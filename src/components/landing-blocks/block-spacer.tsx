import * as React from "react";
import type { BlockRenderProps } from "@/lib/landing-blocks/types";

/**
 * Spacer block — pure vertical whitespace. Intentionally ignores all
 * style overrides except for the height mapping, because that is the
 * one and only thing this block does.
 *
 * data shape: { height: "sm"|"md"|"lg"|"xl" }
 *   sm -> 24px, md -> 48px, lg -> 96px, xl -> 144px
 */

const HEIGHT_PX: Record<"sm" | "md" | "lg" | "xl", number> = {
  sm: 24,
  md: 48,
  lg: 96,
  xl: 144,
};

export function BlockSpacer({ data }: BlockRenderProps): React.ReactElement {
  const key = data.height === "sm" || data.height === "lg" || data.height === "xl"
    ? data.height
    : "md";
  const height = HEIGHT_PX[key];
  return <div aria-hidden="true" style={{ height }} />;
}
