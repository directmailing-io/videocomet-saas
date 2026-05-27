import * as React from "react";
import { cn } from "@/lib/utils";
import { CtaButton } from "./video-player";

/**
 * Theme palette for the public landing page. Mirrors the four design
 * tokens referenced in SPEC.md: noir / clean / gradient / warm.
 *
 * Each theme is a small bag of Tailwind class fragments. Render code below
 * composes the actual markup so we keep visual surface area predictable.
 */
type ThemeId = "noir" | "clean" | "gradient" | "warm";

interface ThemeTokens {
  bg: string;
  surface: string;
  text: string;
  textMuted: string;
  accent: string;
  accentText: string;
  ctaPrimary: string;
  ctaSecondary: string;
}

const THEMES: Record<ThemeId, ThemeTokens> = {
  noir: {
    bg: "bg-ink",
    surface: "bg-ink-soft",
    text: "text-white",
    textMuted: "text-white/70",
    accent: "bg-brand",
    accentText: "text-white",
    ctaPrimary:
      "bg-white text-ink hover:bg-white/90 hover:-translate-y-0.5 shadow-card",
    ctaSecondary:
      "bg-white/10 text-white border border-white/30 hover:bg-white/20",
  },
  clean: {
    bg: "bg-surface-soft",
    surface: "bg-surface",
    text: "text-ink",
    textMuted: "text-ink-muted",
    accent: "bg-brand",
    accentText: "text-white",
    ctaPrimary:
      "bg-ink text-white hover:bg-ink-soft hover:-translate-y-0.5 shadow-card",
    ctaSecondary:
      "bg-surface text-ink border border-line hover:bg-surface-muted",
  },
  gradient: {
    bg: "bg-gradient-to-br from-brand to-brand-deep",
    surface: "bg-white/10 backdrop-blur",
    text: "text-white",
    textMuted: "text-white/80",
    accent: "bg-white",
    accentText: "text-brand-deep",
    ctaPrimary:
      "bg-white text-brand-deep hover:bg-white/90 hover:-translate-y-0.5 shadow-card",
    ctaSecondary:
      "bg-white/10 text-white border border-white/40 hover:bg-white/20",
  },
  warm: {
    bg: "bg-gradient-to-br from-warn to-brand",
    surface: "bg-white/10 backdrop-blur",
    text: "text-white",
    textMuted: "text-white/85",
    accent: "bg-white",
    accentText: "text-ink",
    ctaPrimary:
      "bg-ink text-white hover:bg-ink-soft hover:-translate-y-0.5 shadow-card",
    ctaSecondary:
      "bg-white/15 text-white border border-white/30 hover:bg-white/25",
  },
};

function pickTheme(themeId: string | null | undefined): ThemeTokens {
  const id = (themeId ?? "clean") as ThemeId;
  return THEMES[id] ?? THEMES.clean;
}

/**
 * Expected (but tolerant) shape of `landing_page_templates.content`.
 * Builder writes this JSON; we read it defensively because users can
 * publish partially-filled templates.
 */
interface TemplateContent {
  headline?: string;
  subheadline?: string;
  bodyText?: string;
  primaryButtonText?: string;
  primaryButtonUrl?: string;
  secondaryButtonText?: string;
  secondaryButtonUrl?: string;
  footnote?: string;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function asContent(raw: unknown): TemplateContent {
  if (!raw || typeof raw !== "object") return {};
  const r = raw as Record<string, unknown>;
  return {
    headline: asString(r.headline),
    subheadline: asString(r.subheadline),
    bodyText: asString(r.bodyText),
    primaryButtonText: asString(r.primaryButtonText),
    primaryButtonUrl: asString(r.primaryButtonUrl),
    secondaryButtonText: asString(r.secondaryButtonText),
    secondaryButtonUrl: asString(r.secondaryButtonUrl),
    footnote: asString(r.footnote),
  };
}

/**
 * Replaces `{{key}}` placeholders with values from lead.data. Unknown
 * placeholders are left empty (rather than the literal `{{xyz}}`) so the
 * final page never leaks template syntax to recipients.
 */
function fill(
  template: string | undefined,
  data: Record<string, string>,
): string {
  if (!template) return "";
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_match, key) => {
    const value = data[key as string];
    return typeof value === "string" ? value : "";
  });
}

export interface LandingRenderProps {
  themeId: string | null | undefined;
  templateContent: unknown;
  leadData: Record<string, string>;
  leadId: string;
  videoSlot: React.ReactNode;
}

export function LandingRender({
  themeId,
  templateContent,
  leadData,
  leadId,
  videoSlot,
}: LandingRenderProps) {
  const theme = pickTheme(themeId);
  const content = asContent(templateContent);

  const headline =
    fill(content.headline, leadData) ||
    `${(leadData.firstName ?? "").trim() || "Hallo"}, dieses Video ist für dich`;
  const subheadline = fill(content.subheadline, leadData);
  const body = fill(content.bodyText, leadData);
  const primaryText = fill(content.primaryButtonText, leadData) || "Termin buchen";
  const primaryUrl = fill(content.primaryButtonUrl, leadData);
  const secondaryText = fill(content.secondaryButtonText, leadData);
  const secondaryUrl = fill(content.secondaryButtonUrl, leadData);
  const footnote = fill(content.footnote, leadData);

  return (
    <main className={cn("min-h-screen w-full", theme.bg)}>
      <div className="mx-auto w-full max-w-3xl px-5 py-12 sm:py-16">
        <header className="mb-8 text-center">
          <h1
            className={cn(
              "text-3xl sm:text-4xl font-bold tracking-tight text-balance",
              theme.text,
            )}
          >
            {headline}
          </h1>
          {subheadline && (
            <p
              className={cn(
                "mt-3 text-base sm:text-lg",
                theme.textMuted,
              )}
            >
              {subheadline}
            </p>
          )}
        </header>

        <section
          className={cn(
            "rounded-squircle-lg overflow-hidden shadow-card",
            theme.surface,
          )}
        >
          {videoSlot}
        </section>

        {body && (
          <section className="mt-8">
            <p
              className={cn(
                "text-base sm:text-lg leading-relaxed whitespace-pre-line",
                theme.text,
              )}
            >
              {body}
            </p>
          </section>
        )}

        {(primaryUrl || secondaryUrl) && (
          <section className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-3">
            {primaryUrl && (
              <CtaButton
                leadId={leadId}
                label={primaryText}
                href={primaryUrl}
                className={cn(
                  "inline-flex items-center justify-center px-7 py-3.5 text-sm font-semibold rounded-full transition-all duration-150",
                  theme.ctaPrimary,
                )}
              >
                {primaryText}
              </CtaButton>
            )}
            {secondaryUrl && secondaryText && (
              <CtaButton
                leadId={leadId}
                label={secondaryText}
                href={secondaryUrl}
                className={cn(
                  "inline-flex items-center justify-center px-7 py-3.5 text-sm font-semibold rounded-full transition-all duration-150",
                  theme.ctaSecondary,
                )}
              >
                {secondaryText}
              </CtaButton>
            )}
          </section>
        )}

        {footnote && (
          <p className={cn("mt-10 text-center text-xs", theme.textMuted)}>
            {footnote}
          </p>
        )}
      </div>
    </main>
  );
}
