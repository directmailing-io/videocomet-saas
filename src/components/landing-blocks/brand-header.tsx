import * as React from "react";

/**
 * Renders the tenant's logo at the top of the public landing page.
 *
 * Kept deliberately minimal — no nav, no marketing chrome — because the
 * landing page is a single-purpose video page, not a website. The logo
 * either anchors the page from the left (default) or sits centred.
 *
 * Uses a plain `<img>` rather than `next/image` because:
 *   - the asset URL is user-supplied (mediathek) and may live on Bunny CDN
 *     or any other origin we haven't whitelisted in `next.config.mjs`,
 *   - we want the worker SSR snapshot to embed the raw URL untouched.
 */
export interface BrandHeaderProps {
  logoUrl: string;
  logoAlign: "left" | "center";
}

export function BrandHeader({ logoUrl, logoAlign }: BrandHeaderProps) {
  const alignClass =
    logoAlign === "center" ? "justify-center" : "justify-start";

  return (
    <header
      className={`w-full flex items-center ${alignClass} px-5 sm:px-8 pt-6 pb-2`}
      data-landing-brand-header
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={logoUrl}
        alt=""
        // 48 px keeps the logo readable on mobile without dominating the
        // viewport. The aspect-ratio is preserved automatically.
        style={{ maxHeight: 48, width: "auto", objectFit: "contain" }}
      />
    </header>
  );
}
