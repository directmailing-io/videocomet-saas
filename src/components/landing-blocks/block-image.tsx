import * as React from "react";
import { cn } from "@/lib/utils";
import { renderPlaceholders } from "@/lib/landing-blocks/placeholders";
import type { BlockRenderProps } from "@/lib/landing-blocks/types";
import { BlockFrame } from "./block-frame";

/**
 * Image block — single image with optional caption. `fullWidth` lifts
 * the image out of the normal max-width gutter so it can bleed edge-
 * to-edge (useful for screenshot showcases).
 *
 * data shape: { url; alt?; caption?; fullWidth? }
 */
export function BlockImage({
  data,
  style,
  leadData,
}: BlockRenderProps): React.ReactElement | null {
  const url = typeof data.url === "string" ? data.url : "";
  if (!url) return null;
  const alt = typeof data.alt === "string" ? data.alt : "";
  const caption = renderPlaceholders(
    typeof data.caption === "string" ? data.caption : undefined,
    leadData,
  );
  const fullWidth = data.fullWidth === true;

  return (
    <BlockFrame
      style={style}
      defaults={{
        paddingY: "md",
        maxWidth: fullWidth ? "full" : "normal",
        alignment: "center",
      }}
    >
      <figure>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={url}
          alt={alt}
          className={cn(
            "w-full h-auto",
            fullWidth ? "" : "rounded-2xl",
          )}
        />
        {caption && (
          <figcaption className="mt-2 text-xs sm:text-sm opacity-60">
            {caption}
          </figcaption>
        )}
      </figure>
    </BlockFrame>
  );
}
