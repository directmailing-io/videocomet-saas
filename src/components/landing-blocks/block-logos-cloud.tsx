import * as React from "react";
import { renderPlaceholders } from "@/lib/landing-blocks/placeholders";
import type { BlockRenderProps } from "@/lib/landing-blocks/types";
import { BlockFrame } from "./block-frame";

interface LogoItem {
  url: string;
  alt?: string;
  href?: string;
}

function asLogos(value: unknown): LogoItem[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((raw): LogoItem[] => {
    if (!raw || typeof raw !== "object") return [];
    const r = raw as Record<string, unknown>;
    const url = typeof r.url === "string" ? r.url : "";
    if (!url) return [];
    return [
      {
        url,
        alt: typeof r.alt === "string" ? r.alt : undefined,
        href: typeof r.href === "string" ? r.href : undefined,
      },
    ];
  });
}

/**
 * Logos-Cloud block — optional title above, wrap-grid of greyscale
 * logos that lift to full colour on hover for a touch of life.
 *
 * data shape:
 *   { title?; logos: Array<{ url; alt?; href? }> }
 */
export function BlockLogosCloud({
  data,
  style,
  leadData,
}: BlockRenderProps): React.ReactElement | null {
  const logos = asLogos(data.logos);
  if (logos.length === 0) return null;
  const title = renderPlaceholders(
    typeof data.title === "string" ? data.title : undefined,
    leadData,
  );

  return (
    <BlockFrame
      style={style}
      defaults={{ paddingY: "md", maxWidth: "wide", alignment: "center" }}
    >
      {title && (
        <p className="text-xs sm:text-sm uppercase tracking-wider opacity-60 mb-6">
          {title}
        </p>
      )}
      <ul className="flex flex-wrap items-center justify-center gap-x-10 gap-y-6">
        {logos.map((logo, idx) => {
          /* eslint-disable-next-line @next/next/no-img-element */
          const img = (
            <img
              src={logo.url}
              alt={logo.alt ?? ""}
              className="h-8 sm:h-10 w-auto object-contain grayscale opacity-70 hover:opacity-100 hover:grayscale-0 transition"
            />
          );
          return (
            <li key={idx}>
              {logo.href ? (
                <a href={logo.href} target="_blank" rel="noopener noreferrer">
                  {img}
                </a>
              ) : (
                img
              )}
            </li>
          );
        })}
      </ul>
    </BlockFrame>
  );
}
