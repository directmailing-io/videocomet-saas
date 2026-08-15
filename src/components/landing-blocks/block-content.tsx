import * as React from "react";
import { cn } from "@/lib/utils";
import { renderPlaceholders } from "@/lib/landing-blocks/placeholders";
import {
  resolveVariant,
  type BlockRenderProps,
} from "@/lib/landing-blocks/types";
import { BlockFrame } from "./block-frame";
import { EditableText, EditSwitch, MaybeEmptyField } from "./editable-text";
import { parseVideoEmbed } from "@/lib/landing-blocks/video-embed";
import { ImagePlaceholder } from "./image-placeholder";
import { parseMiniMarkdown } from "./mini-markdown";
import { VideoEmbedFrame } from "./video-embed-frame";

/**
 * Content-Sektion (Text + Grafik, v3).
 *
 * Varianten (siehe BLOCK_VARIANTS):
 *   - "media-left"  — Bild links, Text rechts (Default).
 *   - "media-right" — gespiegelt.
 *   - "text-only"   — Headline + Fliesstext, mittig, schmale Lesebreite.
 *   Ohne image.url rendern die Media-Varianten wie "text-only".
 *   Auf Smartphone (hoch) brechen die Media-Varianten einspaltig um
 *   (Text zuerst, Bild darunter).
 *
 * data shape (siehe makeDefaultBlock):
 *   { headline: string; body: string; image: { url: string; alt: string } }
 *
 * `body` laeuft durch MiniMarkdown mit `checklistBullets`: Aufzaehlungen
 * ("- ") bekommen Haekchen-Icons in --lp-color-primary.
 */
export function BlockContent({
  data,
  style,
  variant,
  leadData,
}: BlockRenderProps): React.ReactElement | null {
  const layout = resolveVariant("content", variant);

  const headline = renderPlaceholders(
    typeof data.headline === "string" ? data.headline : undefined,
    leadData,
  );
  const bodyRaw = typeof data.body === "string" ? data.body : "";
  const body = renderPlaceholders(bodyRaw, leadData);

  const imageRaw =
    data.image && typeof data.image === "object"
      ? (data.image as Record<string, unknown>)
      : {};
  const imageUrl = typeof imageRaw.url === "string" ? imageRaw.url : "";
  const imageAlt = typeof imageRaw.alt === "string" ? imageRaw.alt : "";
  // Video per URL (YouTube/Vimeo/Wistia/Loom) gewinnt gegen das Bild.
  const videoEmbed = parseVideoEmbed(
    typeof data.videoUrl === "string" ? data.videoUrl : "",
  );

  const wantsMedia = layout !== "text-only";
  const rawHeadline = typeof data.headline === "string" ? data.headline : "";

  const textNode = (
    <>
      <MaybeEmptyField present={!!headline}>
        <h2
          className="text-2xl sm:text-3xl font-bold tracking-tight text-balance"
          style={{ fontFamily: "var(--lp-font-heading)" }}
        >
          <EditableText
            path="headline"
            raw={rawHeadline}
            emptyHint="Überschrift eingeben"
          >
            {headline}
          </EditableText>
        </h2>
      </MaybeEmptyField>
      <MaybeEmptyField present={!!body.trim()}>
        <div className={cn("text-base opacity-90", headline && "mt-4")}>
          <EditableText
            path="body"
            raw={bodyRaw}
            multiline
            markdown
            emptyHint="Text eingeben"
          >
            {parseMiniMarkdown(body, { checklistBullets: true })}
          </EditableText>
        </div>
      </MaybeEmptyField>
    </>
  );

  // "text-only" (und Media-Varianten ohne Bild): mittig zentrierter
  // Block mit schmaler Lesebreite (~65ch), Fliesstext linksbuendig.
  const textOnlyFrame = (
    <BlockFrame
      style={style}
      defaults={{ paddingY: "md", maxWidth: "normal", alignment: "center" }}
    >
      <div className="mx-auto max-w-[65ch] text-left [&>h2]:text-center">
        {textNode}
      </div>
    </BlockFrame>
  );

  const mediaRight = layout === "media-right";

  const mediaFrame = (
    <BlockFrame
      style={style}
      defaults={{ paddingY: "md", maxWidth: "wide", alignment: "left" }}
    >
      <div className="grid grid-cols-1 gap-8 md:grid-cols-2 md:gap-12 md:items-center">
        {/* DOM-Reihenfolge: Text zuerst (Smartphone-Stapel), ab md ordnet
            `order` das Bild je nach Variante links oder rechts an. */}
        <div className={mediaRight ? "md:order-1" : "md:order-2"}>
          {textNode}
        </div>
        <div className={mediaRight ? "md:order-2" : "md:order-1"}>
          {videoEmbed ? (
            <VideoEmbedFrame embed={videoEmbed} title={imageAlt} />
          ) : imageUrl ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={imageUrl}
              alt={imageAlt}
              loading="lazy"
              className="w-full object-cover"
              style={{
                borderRadius: "var(--lp-radius-image)",
                boxShadow: "var(--lp-shadow-card)",
              }}
            />
          ) : (
            <ImagePlaceholder />
          )}
        </div>
      </div>
    </BlockFrame>
  );

  if (!headline && !body.trim() && !imageUrl && !videoEmbed) {
    // Public: unveraendert null. Im Builder: leere Felder mit Hint
    // rendern, damit ein leer getippter Block anklickbar bleibt.
    return (
      <MaybeEmptyField present={false}>
        {wantsMedia ? mediaFrame : textOnlyFrame}
      </MaybeEmptyField>
    );
  }

  if (!wantsMedia) {
    return textOnlyFrame;
  }

  if (!imageUrl && !videoEmbed) {
    // Public faellt (wie bisher) auf die text-only-Darstellung zurueck,
    // der Builder zeigt das zweispaltige Grid mit Bild-Platzhalter.
    return <EditSwitch editing={mediaFrame} fallback={textOnlyFrame} />;
  }

  return mediaFrame;
}
