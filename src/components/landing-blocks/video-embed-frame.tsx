import * as React from "react";
import type { VideoEmbed } from "@/lib/landing-blocks/video-embed";

/** 16:9-iframe für eingebettete Videos (YouTube/Vimeo/Wistia/Loom). */
export function VideoEmbedFrame({
  embed,
  title,
  rounded = true,
}: {
  embed: VideoEmbed;
  title?: string;
  rounded?: boolean;
}) {
  return (
    <div
      className="relative w-full overflow-hidden"
      style={{
        aspectRatio: "16 / 9",
        borderRadius: rounded ? "var(--lp-radius-image)" : undefined,
        boxShadow: rounded ? "var(--lp-shadow-card)" : undefined,
      }}
    >
      <iframe
        src={embed.embedUrl}
        title={title || "Video"}
        className="absolute inset-0 h-full w-full"
        style={{ border: 0 }}
        loading="lazy"
        allow="autoplay; fullscreen; picture-in-picture; encrypted-media"
        allowFullScreen
        referrerPolicy="strict-origin-when-cross-origin"
      />
    </div>
  );
}
