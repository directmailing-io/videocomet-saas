import * as React from "react";
import { cn } from "@/lib/utils";
import { renderPlaceholders } from "@/lib/landing-blocks/placeholders";
import type { BlockRenderProps } from "@/lib/landing-blocks/types";
import { BlockFrame } from "./block-frame";
import { CtaButton } from "./cta-button";

interface CtaConfig {
  label?: string;
  url?: string;
}

function asCta(value: unknown): CtaConfig | undefined {
  if (!value || typeof value !== "object") return undefined;
  const r = value as Record<string, unknown>;
  const label = typeof r.label === "string" ? r.label : undefined;
  const url = typeof r.url === "string" ? r.url : undefined;
  if (!label || !url) return undefined;
  return { label, url };
}

/**
 * CTA-Banner block — prominent call-to-action surface with headline,
 * optional subheadline and up to two buttons. Tracking is delegated to
 * the shared `<CtaButton>` so click events match the rest of the page.
 *
 * data shape:
 *   { headline; subheadline?;
 *     primaryButton?:{label,url}; secondaryButton?:{label,url} }
 */
export function BlockCtaBanner({
  data,
  style,
  leadData,
  leadId,
}: BlockRenderProps): React.ReactElement | null {
  const headline = renderPlaceholders(
    typeof data.headline === "string" ? data.headline : undefined,
    leadData,
  );
  const subheadline = renderPlaceholders(
    typeof data.subheadline === "string" ? data.subheadline : undefined,
    leadData,
  );
  const primary = asCta(data.primaryButton);
  const secondary = asCta(data.secondaryButton);
  if (!headline && !primary && !secondary) return null;

  // Buttons konsumieren ausschliesslich Theme-Tokens: Radius/Schatten/
  // Textfarbe als Inline-Style, Hintergrund + Hover als Tailwind-
  // Arbitrary-Klassen (Hover geht nicht per Inline-Style, und ein
  // Inline-Background wuerde die Hover-Klasse ueberdecken).
  const btnClass = cn(
    "inline-flex items-center justify-center px-7 py-3.5",
    "text-sm font-semibold transition-all duration-150",
    "rounded-[var(--lp-radius-button)]",
  );
  const primaryStyle: React.CSSProperties = {
    color: "var(--lp-color-on-primary)",
    boxShadow: "var(--lp-shadow-cta)",
  };
  const secondaryStyle: React.CSSProperties = {
    color: "var(--lp-color-text)",
    borderColor: "var(--lp-color-border)",
  };

  return (
    <BlockFrame
      style={style}
      defaults={{ paddingY: "lg", maxWidth: "normal", alignment: "center" }}
    >
      {headline && (
        <h2
          className="text-2xl sm:text-3xl font-bold tracking-tight text-balance"
          style={{ fontFamily: "var(--lp-font-heading)" }}
        >
          {headline}
        </h2>
      )}
      {subheadline && (
        <p className="mt-3 text-base sm:text-lg opacity-80">{subheadline}</p>
      )}
      {(primary || secondary) && (
        <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-3">
          {primary && primary.label && primary.url && (
            <CtaButton
              leadId={leadId}
              label={renderPlaceholders(primary.label, leadData) || primary.label}
              href={renderPlaceholders(primary.url, leadData) || primary.url}
              position="primary"
              className={cn(
                btnClass,
                "bg-[color:var(--lp-color-primary)] hover:bg-[color:var(--lp-color-primary-hover)]",
              )}
              style={primaryStyle}
            >
              {renderPlaceholders(primary.label, leadData) || primary.label}
            </CtaButton>
          )}
          {secondary && secondary.label && secondary.url && (
            <CtaButton
              leadId={leadId}
              label={renderPlaceholders(secondary.label, leadData) || secondary.label}
              href={renderPlaceholders(secondary.url, leadData) || secondary.url}
              position="secondary"
              className={cn(
                btnClass,
                "border bg-[color:var(--lp-color-surface)] hover:bg-[color:var(--lp-color-primary-soft)]",
              )}
              style={secondaryStyle}
            >
              {renderPlaceholders(secondary.label, leadData) || secondary.label}
            </CtaButton>
          )}
        </div>
      )}
    </BlockFrame>
  );
}
