import * as React from "react";

import { buildFontLinkHref } from "@/lib/landing-theme/fonts";
import { buildThemeRootStyle } from "@/lib/landing-theme/css-vars";
import type { BrandConfig, ThemeConfig } from "@/lib/landing-theme/types";
import { DEFAULT_BRAND, DEFAULT_THEME } from "@/lib/landing-theme/types";

import { BrandFooter } from "./brand-footer";
import { BrandHeader } from "./brand-header";

/**
 * Wraps a block-based landing page with theme + brand chrome.
 *
 * Responsibilities:
 *   1. Inject one Google-Fonts `<link>` for the heading + body family.
 *   2. Render an outer `<div>` whose inline-style carries every `--lp-*`
 *      custom property — block components read these via `var(--lp-…)`.
 *   3. Optionally render `<BrandHeader>` (logo) above `children`.
 *   4. Render `children` (the block renderer from Agent A).
 *   5. Optionally render `<BrandFooter>` below `children`.
 *
 * This is a Server Component on purpose: no hooks, no client state — the
 * whole tree is renderable on the worker (for the PDF/snapshot pipeline)
 * and in the public page.
 */
export interface LandingThemeProviderProps {
  /** Theme — falls back to `DEFAULT_THEME` if `undefined`. */
  theme?: ThemeConfig | null;
  /** Brand — falls back to `DEFAULT_BRAND` if `undefined`. */
  brand?: BrandConfig | null;
  /**
   * Whether the footer should render. The caller (page.tsx) computes this
   * from `brand.showFooter` + the domain type — see footer-visibility logic
   * in `src/app/v/[slug]/page.tsx`. We accept the resolved boolean here so
   * the provider stays domain-agnostic.
   */
  showFooter: boolean;
  /** Forwarded to `<BrandFooter>` — only used when `showFooter` is true. */
  isDefaultDomain?: boolean;
  children: React.ReactNode;
}

export function LandingThemeProvider({
  theme,
  brand,
  showFooter,
  isDefaultDomain = false,
  children,
}: LandingThemeProviderProps) {
  const resolvedTheme: ThemeConfig = theme ?? DEFAULT_THEME;
  const resolvedBrand: BrandConfig = brand ?? DEFAULT_BRAND;

  const rootStyle = buildThemeRootStyle(resolvedTheme);
  const fontHref = buildFontLinkHref(
    resolvedTheme.fonts.heading,
    resolvedTheme.fonts.body,
  );

  return (
    <>
      {fontHref && (
        // Loaded via plain <link> — see `fonts.ts` for the rationale.
        // eslint-disable-next-line @next/next/no-css-tags
        <link rel="stylesheet" href={fontHref} />
      )}
      <div
        data-landing-theme={resolvedTheme.preset ?? "custom"}
        style={rootStyle}
        className="min-h-screen w-full"
      >
        {resolvedBrand.logoUrl && (
          <BrandHeader
            logoUrl={resolvedBrand.logoUrl}
            logoAlign={resolvedBrand.logoAlign ?? "left"}
          />
        )}
        {children}
        {showFooter && (
          <BrandFooter
            footerText={resolvedBrand.footerText ?? ""}
            isDefaultDomain={isDefaultDomain}
          />
        )}
      </div>
    </>
  );
}
