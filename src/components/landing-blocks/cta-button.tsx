"use client";

import * as React from "react";
import { track } from "@/lib/tracker";

/**
 * CTA button with click-tracking. Used by every block that renders a
 * call-to-action (Hero, CTA-Banner, future Pricing-Card, …).
 *
 * Renders as an `<a>` so right-click / middle-click / open-in-new-tab
 * keep working. The click handler fires `track("cta_click", …)` and a
 * legacy beacon synchronously *before* the browser tears down the page
 * for navigation. Both transports use `sendBeacon` under the hood, so
 * the events survive the unload.
 *
 * This used to live next to `<VideoPlayer>` in `/v/[slug]/video-player`;
 * it was lifted here when the page renderer became block-based so any
 * block can use it without taking a dependency on the public-page tree.
 */

export type CtaPosition = "primary" | "secondary";

export interface CtaButtonProps {
  leadId: string;
  label: string;
  href: string;
  position?: CtaPosition;
  className?: string;
  /**
   * Inline styles for token consumption (border-radius, shadow, colours
   * via `var(--lp-…)`). Hover states cannot live here — callers use
   * Tailwind-arbitrary classes (`hover:bg-[color:var(--lp-…)]`) instead.
   */
  style?: React.CSSProperties;
  children: React.ReactNode;
}

function legacyTrackEvent(
  path: string,
  payload: Record<string, unknown>,
): void {
  try {
    const body = JSON.stringify(payload);
    if (
      typeof navigator !== "undefined" &&
      typeof navigator.sendBeacon === "function"
    ) {
      const blob = new Blob([body], { type: "application/json" });
      const ok = navigator.sendBeacon(path, blob);
      if (ok) return;
    }
    fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true,
    }).catch(() => {
      /* swallow — tracking must never break the page */
    });
  } catch {
    /* swallow */
  }
}

export function CtaButton({
  leadId,
  label,
  href,
  position = "primary",
  className,
  style,
  children,
}: CtaButtonProps) {
  const handleClick = React.useCallback(() => {
    track("cta_click", { label, url: href, position });
    legacyTrackEvent("/api/track/cta-click", { leadId, label, href });
  }, [leadId, label, href, position]);
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      onClick={handleClick}
      onAuxClick={handleClick}
      className={className}
      style={style}
    >
      {children}
    </a>
  );
}
