"use client";

import * as React from "react";
import { Play } from "lucide-react";

/**
 * LpPreview renders an exact-as-possible mirror of the public
 * `/v/[slug]` landing page using sample lead data. It supports the four
 * stock themes (noir / clean / gradient / warm) plus user color overrides
 * stored in `template.content.{bgColor, textColor, accentColor}`.
 *
 * We deliberately use inline styles for the theme tokens here rather
 * than Tailwind utilities so that the builder can apply
 * arbitrary hex overrides directly without a class-name dance.
 */

export interface LpPreviewTemplate {
  themeId: string;
  content: Record<string, unknown>;
}

export interface SampleLeadData {
  firstName: string;
  lastName: string;
  company: string;
  [key: string]: string;
}

type ThemeId = "noir" | "clean" | "gradient" | "warm";

interface ThemeTokens {
  bg: string;
  surface: string;
  text: string;
  textMuted: string;
  accent: string;
  primaryBg: string;
  primaryText: string;
  secondaryBg: string;
  secondaryText: string;
  secondaryBorder: string;
}

const THEMES: Record<ThemeId, ThemeTokens> = {
  noir: {
    bg: "#07070f",
    surface: "rgba(255,255,255,0.05)",
    text: "#ffffff",
    textMuted: "rgba(255,255,255,0.70)",
    accent: "#818cf8",
    primaryBg: "#ffffff",
    primaryText: "#07070f",
    secondaryBg: "rgba(255,255,255,0.10)",
    secondaryText: "#ffffff",
    secondaryBorder: "rgba(255,255,255,0.30)",
  },
  clean: {
    bg: "#ffffff",
    surface: "#fafafa",
    text: "#0f172a",
    textMuted: "#64748b",
    accent: "#2563eb",
    primaryBg: "#0f172a",
    primaryText: "#ffffff",
    secondaryBg: "#ffffff",
    secondaryText: "#0f172a",
    secondaryBorder: "#e2e8f0",
  },
  gradient: {
    bg: "radial-gradient(120% 120% at 50% 0%, #a855f7 0%, #6366f1 45%, #2563eb 100%)",
    surface: "rgba(255,255,255,0.10)",
    text: "#ffffff",
    textMuted: "rgba(255,255,255,0.80)",
    accent: "#f59e0b",
    primaryBg: "#ffffff",
    primaryText: "#312e81",
    secondaryBg: "rgba(255,255,255,0.10)",
    secondaryText: "#ffffff",
    secondaryBorder: "rgba(255,255,255,0.40)",
  },
  warm: {
    bg: "#fdf8f3",
    surface: "#ffffff",
    text: "#1c1207",
    textMuted: "#7c5e44",
    accent: "#c2622c",
    primaryBg: "#c2622c",
    primaryText: "#ffffff",
    secondaryBg: "#ffffff",
    secondaryText: "#1c1207",
    secondaryBorder: "#e8d4bf",
  },
};

function pickTheme(themeId: string | null | undefined): ThemeTokens {
  const id = (themeId ?? "clean") as ThemeId;
  return THEMES[id] ?? THEMES.clean;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function fill(template: string, data: Record<string, string>): string {
  if (!template) return "";
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_match, key) => {
    const value = data[key as string];
    return typeof value === "string" ? value : "";
  });
}

/**
 * Mixes an alpha value into a hex/rgb color. Used to derive the muted
 * text color from a user-supplied text override (e.g. when they pick a
 * solid foreground we still want a softened version for body copy).
 */
function withAlpha(color: string, alpha: number): string {
  if (color.startsWith("#")) {
    const hex = color.slice(1);
    const r = parseInt(
      hex.length === 3 ? hex[0]! + hex[0]! : hex.slice(0, 2),
      16,
    );
    const g = parseInt(
      hex.length === 3 ? hex[1]! + hex[1]! : hex.slice(2, 4),
      16,
    );
    const b = parseInt(
      hex.length === 3 ? hex[2]! + hex[2]! : hex.slice(4, 6),
      16,
    );
    if (!Number.isFinite(r + g + b)) return color;
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  return color;
}

export interface LpPreviewProps {
  template: LpPreviewTemplate;
  sampleLeadData?: SampleLeadData;
}

export function LpPreview({
  template,
  sampleLeadData = {
    firstName: "Max",
    lastName: "Mustermann",
    company: "Acme GmbH",
  },
}: LpPreviewProps) {
  const baseTheme = pickTheme(template.themeId);

  // Color overrides from template.content. When the user picks a custom
  // background or accent, we override the theme tokens. Text color is
  // softened by ~30% to derive the muted variant so body/headline read
  // with a hierarchy similar to the stock themes.
  const c = template.content ?? {};
  const bgOverride = asString(c.bgColor);
  const textOverride = asString(c.textColor);
  const accentOverride = asString(c.accentColor);

  const bg = bgOverride || baseTheme.bg;
  const text = textOverride || baseTheme.text;
  const textMuted = textOverride
    ? withAlpha(textOverride, 0.7)
    : baseTheme.textMuted;
  const accent = accentOverride || baseTheme.accent;

  const headline = fill(asString(c.headline), sampleLeadData) ||
    "Hey, das hier ist fuer dich";
  const body = fill(asString(c.bodyText), sampleLeadData);
  const primaryText =
    fill(asString(c.primaryButtonText), sampleLeadData) || "Termin buchen";
  const primaryUrl = asString(c.primaryButtonUrl);
  const secondaryText =
    fill(asString(c.secondaryButtonText), sampleLeadData) || "";
  const secondaryUrl = asString(c.secondaryButtonUrl);
  const footnote = fill(asString(c.footnote), sampleLeadData);

  // Primary CTA: filled in accent. Secondary: outlined with text color.
  const primaryBg = accentOverride || baseTheme.primaryBg;
  const primaryText_ = accentOverride
    ? "#ffffff"
    : baseTheme.primaryText;

  return (
    <div
      className="rounded-squircle-md overflow-hidden border border-line shadow-card"
      style={{ background: bg }}
    >
      <div className="mx-auto w-full max-w-2xl px-6 py-10">
        <header className="mb-6 text-center">
          <h1
            className="text-2xl sm:text-3xl font-bold tracking-tight leading-tight"
            style={{ color: text }}
          >
            {headline}
          </h1>
        </header>

        <section
          className="rounded-squircle-lg overflow-hidden shadow-card aspect-video flex items-center justify-center"
          style={{ background: baseTheme.surface }}
        >
          <div
            className="size-14 rounded-full flex items-center justify-center"
            style={{ background: accent }}
          >
            <Play
              className="size-6"
              style={{ color: "#ffffff" }}
              fill="currentColor"
            />
          </div>
        </section>

        {body && (
          <section className="mt-6">
            <p
              className="text-sm sm:text-base leading-relaxed whitespace-pre-line text-center"
              style={{ color: text }}
            >
              {body}
            </p>
          </section>
        )}

        <section className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-3">
          {primaryUrl && (
            <span
              className="inline-flex items-center justify-center px-6 py-3 text-sm font-semibold rounded-full"
              style={{ background: primaryBg, color: primaryText_ }}
            >
              {primaryText}
            </span>
          )}
          {secondaryUrl && secondaryText && (
            <span
              className="inline-flex items-center justify-center px-6 py-3 text-sm font-semibold rounded-full border"
              style={{
                background: "transparent",
                color: text,
                borderColor: withAlpha(text, 0.3),
              }}
            >
              {secondaryText}
            </span>
          )}
        </section>

        {footnote && (
          <p
            className="mt-8 text-center text-xs"
            style={{ color: textMuted }}
          >
            {footnote}
          </p>
        )}
      </div>
    </div>
  );
}
