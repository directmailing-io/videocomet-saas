import * as React from "react";

import { Logo } from "@/components/ui/logo";

/**
 * Footer for the public landing page.
 *
 * Three rendering modes:
 *   1. `footerText` set            → render that text (user has overridden).
 *   2. `footerText` empty +
 *      default domain              → render the VIDEOCOMET logo footer
 *                                    (matches the legacy hard-coded footer).
 *   3. `footerText` empty +
 *      custom domain               → render nothing — a white-label custom
 *                                    domain should not show our brand by
 *                                    default. (Visibility is decided one
 *                                    layer up; if we reach this branch the
 *                                    caller explicitly opted in.)
 *
 * Visibility (whether this component renders at all) is decided by
 * `<LandingThemeProvider>` based on `brand.showFooter` + the domain type.
 */
export interface BrandFooterProps {
  footerText: string;
  /** True when the page is served from the platform default domain. */
  isDefaultDomain: boolean;
}

export function BrandFooter({ footerText, isDefaultDomain }: BrandFooterProps) {
  const trimmed = footerText.trim();

  if (trimmed.length > 0) {
    return (
      <footer
        className="w-full py-8 flex items-center justify-center text-center px-5"
        data-landing-brand-footer
      >
        <p
          className="text-xs"
          style={{ color: "var(--lp-color-muted)" }}
        >
          {trimmed}
        </p>
      </footer>
    );
  }

  if (isDefaultDomain) {
    return (
      <footer
        className="w-full py-8 flex items-center justify-center"
        data-landing-brand-footer
      >
        <a
          href="https://videocomet.de"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 opacity-60 hover:opacity-100 transition-opacity"
          aria-label="VIDEOCOMET"
        >
          <Logo variant="horizontal" height={20} />
        </a>
      </footer>
    );
  }

  // White-label custom domain opted into the footer but supplied no text —
  // render an empty spacer so the page padding stays consistent.
  return <div className="w-full py-4" data-landing-brand-footer />;
}
