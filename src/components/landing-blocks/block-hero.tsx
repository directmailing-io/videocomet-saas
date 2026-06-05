import * as React from "react";
import { cn } from "@/lib/utils";
import { renderPlaceholders } from "@/lib/landing-blocks/placeholders";
import type { BlockRenderProps } from "@/lib/landing-blocks/types";
import { BlockFrame } from "./block-frame";

/**
 * Hero block — page-top section with headline, sub-headline and
 * (optionally) the video player. The player itself arrives as `slot`
 * from the page shell, which owns lead-id and tracking.
 *
 * data shape:
 *   { headline?: string; subheadline?: string;
 *     alignment?: "left"|"center"; showVideo?: boolean }
 */
export function BlockHero({
  data,
  style,
  leadData,
  slot,
  videoOrientation,
  campaignMode,
}: BlockRenderProps): React.ReactElement {
  const headline = renderPlaceholders(
    typeof data.headline === "string" ? data.headline : undefined,
    leadData,
  );
  const subheadline = renderPlaceholders(
    typeof data.subheadline === "string" ? data.subheadline : undefined,
    leadData,
  );
  const alignment =
    data.alignment === "left" ? "left" : ("center" as const);
  const showVideo = data.showVideo !== false; // default true

  // Portrait-Webcam-Only ist der einzige Fall, in dem wir den klassischen
  // Hero-Slot-Wrapper aufgeben: 9:16-Videos im 16:9-Container (max-w-3xl)
  // ergaeben riesige schwarze Streifen. Stattdessen rendern wir einen
  // full-bleed schwarzen Hintergrund-Streifen, der zentriert das
  // hochkant-Video hostet. Der `bg-black backdrop-blur` Effekt macht
  // Letterboxing auf breiten Viewports wenigstens optisch ruhig.
  const isPortraitWebcamOnly =
    videoOrientation === "portrait" && campaignMode === "webcam-only";

  return (
    <BlockFrame
      style={style}
      defaults={{ paddingY: "lg", maxWidth: "normal", alignment }}
    >
      {headline && (
        <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-balance">
          {headline}
        </h1>
      )}
      {subheadline && (
        <p
          className={cn(
            "mt-3 text-base sm:text-lg opacity-80",
            headline ? "" : "mt-0",
          )}
        >
          {subheadline}
        </p>
      )}
      {showVideo && slot && (
        isPortraitWebcamOnly ? (
          // Full-bleed-Wrapper: kein rounded/overflow/shadow — der Slot
          // (VideoPlayer) bringt seinen eigenen schwarzen Hintergrund mit.
          // `bg-black/95 backdrop-blur` macht den umgebenden Bereich auf
          // sehr breiten Viewports ruhig.
          <div className="mt-8 -mx-5 sm:-mx-8 bg-black/95 backdrop-blur py-6 text-left">
            {slot}
          </div>
        ) : (
          <div className="mt-8 rounded-squircle-lg overflow-hidden shadow-card text-left">
            {slot}
          </div>
        )
      )}
    </BlockFrame>
  );
}
