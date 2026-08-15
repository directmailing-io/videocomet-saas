import * as React from "react";
import { renderPlaceholders } from "@/lib/landing-blocks/placeholders";
import type { BlockRenderProps } from "@/lib/landing-blocks/types";
import { BlockFrame } from "./block-frame";
import { MaybeEmptyField } from "./editable-text";
import { ImagePlaceholder } from "./image-placeholder";

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
  const alt = typeof data.alt === "string" ? data.alt : "";
  const caption = renderPlaceholders(
    typeof data.caption === "string" ? data.caption : undefined,
    leadData,
  );
  const fullWidth = data.fullWidth === true;

  if (!url) {
    // Public: unveraendert null. Im Builder: Platzhalter-Motiv, damit der
    // Block sichtbar und anklickbar bleibt, solange kein Bild gesetzt ist.
    return (
      <MaybeEmptyField present={false}>
        <BlockFrame
          style={style}
          defaults={{
            paddingY: "md",
            maxWidth: fullWidth ? "full" : "normal",
            alignment: "center",
          }}
        >
          <ImagePlaceholder rounded={!fullWidth} />
        </BlockFrame>
      </MaybeEmptyField>
    ) as React.ReactElement;
  }

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
          className="w-full h-auto"
          // Full-bleed-Bilder bleiben eckig (Kante an Kante); sonst kommt
          // die Rundung aus der Theme-Rundungsskala fuer Bilder.
          style={
            fullWidth
              ? undefined
              : { borderRadius: "var(--lp-radius-image)" }
          }
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
