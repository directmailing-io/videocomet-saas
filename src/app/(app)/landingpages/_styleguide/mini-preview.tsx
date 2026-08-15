"use client";

/**
 * Mini-Vorschau einer Hero-Sektion im erkannten bzw. gewählten Look
 * (Konzept 3.3). Bewusst KEIN echter Block-Renderer — ein einfaches
 * div-Mockup, das dieselben `--lp-*`-CSS-Variablen konsumiert wie die
 * echten Blöcke. So sieht der User Farben, Schrift, Rundung und Schatten
 * seiner Marke, ohne dass wir den Block-Katalog anfassen.
 */

import * as React from "react";
import { Play } from "lucide-react";

import { brandKitToTheme, type BrandKit } from "@/lib/landing-theme/brand-kit";
import { buildThemeCssVars } from "@/lib/landing-theme/css-vars";
import { ensureGoogleFont } from "@/lib/slide/google-fonts-loader";
import { cn } from "@/lib/utils";

export function MiniHeroPreview({
  kit,
  className,
}: {
  kit: BrandKit;
  className?: string;
}) {
  const { theme } = brandKitToTheme(kit);
  const vars = buildThemeCssVars(theme);

  React.useEffect(() => {
    ensureGoogleFont(theme.fonts.heading);
    ensureGoogleFont(theme.fonts.body);
  }, [theme.fonts.heading, theme.fonts.body]);

  return (
    <div
      className={cn(
        "overflow-hidden rounded-squircle-md ring-1 ring-inset ring-ink/10",
        className,
      )}
      style={{
        ...(vars as React.CSSProperties),
        background: "var(--lp-color-bg)",
        color: "var(--lp-color-text)",
        fontFamily: "var(--lp-font-body)",
      }}
      aria-hidden
    >
      <div className="px-6 py-6 flex flex-col items-center text-center gap-2.5">
        {kit.logo?.url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={kit.logo.url}
            alt=""
            className="h-5 max-w-[120px] object-contain mb-0.5"
          />
        ) : null}
        <span
          className="inline-flex items-center px-2.5 py-0.5 text-[10px] font-semibold"
          style={{
            background: "var(--lp-color-primary-soft)",
            color: "var(--lp-color-primary)",
            borderRadius: "var(--lp-radius-button)",
          }}
        >
          Persönlich für Marcel
        </span>
        <div
          className="text-lg font-bold leading-tight"
          style={{ fontFamily: "var(--lp-font-heading)" }}
        >
          Marcel, dieses Video ist nur für dich
        </div>
        <p
          className="text-[11px] leading-snug max-w-[260px]"
          style={{ color: "var(--lp-color-muted)" }}
        >
          Ich habe es persönlich für dich aufgenommen. Schau es dir in Ruhe an.
        </p>
        <div
          className="w-full max-w-[280px] aspect-video mt-1 flex items-center justify-center"
          style={{
            background: "#1c1f26",
            borderRadius: "var(--lp-radius-image)",
            boxShadow: "var(--lp-shadow-card)",
          }}
        >
          <span
            className="flex size-8 items-center justify-center rounded-full"
            style={{
              background: "var(--lp-color-primary)",
              color: "var(--lp-color-on-primary)",
            }}
          >
            <Play className="size-3.5 fill-current" />
          </span>
        </div>
        <span
          className="mt-1.5 inline-flex items-center px-4 py-1.5 text-[11px] font-semibold"
          style={{
            background: "var(--lp-color-primary)",
            color: "var(--lp-color-on-primary)",
            borderRadius: "var(--lp-radius-button)",
            boxShadow: "var(--lp-shadow-cta)",
          }}
        >
          Termin buchen
        </span>
      </div>
    </div>
  );
}
