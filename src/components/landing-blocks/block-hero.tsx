import * as React from "react";
import { cn } from "@/lib/utils";
import { renderPlaceholders } from "@/lib/landing-blocks/placeholders";
import {
  resolveVariant,
  type BlockRenderProps,
} from "@/lib/landing-blocks/types";
import { BlockFrame } from "./block-frame";
import { CtaButton } from "./cta-button";

/**
 * Hero block — page-top section with headline, sub-headline and
 * (optionally) the video player. The player itself arrives as `slot`
 * from the page shell, which owns lead-id and tracking.
 *
 * Varianten (v3, siehe BLOCK_VARIANTS):
 *   - "centered"       — das klassische Layout (Default, pixelgleich zu v2).
 *   - "split"          — Text links, Video rechts.
 *   - "split-reverse"  — gespiegelt.
 *   Auf Smartphone (hoch) brechen die Split-Layouts einspaltig in der
 *   Reihenfolge Headline → Video → CTA um (Konzept 4, Responsive-Garantie).
 *
 * data shape:
 *   { headline?: string; subheadline?: string;
 *     alignment?: "left"|"center"; showVideo?: boolean;
 *     badge?: string;                       // Begrüßungs-Badge, leer = aus
 *     showCta?: boolean; ctaLabel?: string; ctaUrl?: string }
 */
export function BlockHero({
  data,
  style,
  variant,
  leadData,
  leadId,
  slot,
  videoOrientation,
  campaignMode,
}: BlockRenderProps): React.ReactElement {
  const layout = resolveVariant("hero", variant);

  const headline = renderPlaceholders(
    typeof data.headline === "string" ? data.headline : undefined,
    leadData,
  );
  const subheadline = renderPlaceholders(
    typeof data.subheadline === "string" ? data.subheadline : undefined,
    leadData,
  );
  const badge = renderPlaceholders(
    typeof data.badge === "string" ? data.badge : undefined,
    leadData,
  );
  const alignment =
    data.alignment === "left" ? "left" : ("center" as const);
  const showVideo = data.showVideo !== false; // default true

  // CTA ist additiv: Bestandsseiten haben weder showCta noch ctaLabel/ctaUrl
  // und rendern deshalb exakt wie bisher (kein Button).
  const ctaLabelRaw = typeof data.ctaLabel === "string" ? data.ctaLabel : "";
  const ctaUrlRaw = typeof data.ctaUrl === "string" ? data.ctaUrl : "";
  const showCta = data.showCta !== false && !!ctaLabelRaw && !!ctaUrlRaw;
  const ctaLabel = renderPlaceholders(ctaLabelRaw, leadData) || ctaLabelRaw;
  const ctaUrl = renderPlaceholders(ctaUrlRaw, leadData) || ctaUrlRaw;

  // Portrait-Webcam-Only ist der einzige Fall, in dem wir den klassischen
  // Hero-Slot-Wrapper aufgeben: 9:16-Videos im 16:9-Container (max-w-3xl)
  // ergaeben riesige schwarze Streifen. Stattdessen rendern wir einen
  // full-bleed schwarzen Hintergrund-Streifen, der zentriert das
  // hochkant-Video hostet. Der `bg-black backdrop-blur` Effekt macht
  // Letterboxing auf breiten Viewports wenigstens optisch ruhig.
  const isPortraitWebcamOnly =
    videoOrientation === "portrait" && campaignMode === "webcam-only";

  // Badge-Pille ueber der Headline. Nur Theme-Tokens, damit sie auf hellen
  // wie dunklen Seiten funktioniert (primary-soft ist modus-abhaengig).
  const badgeNode = badge ? (
    <div className="mb-4">
      <span
        className="inline-flex items-center px-3.5 py-1.5 text-xs sm:text-sm font-semibold"
        style={{
          backgroundColor: "var(--lp-color-primary-soft)",
          color: "var(--lp-color-primary)",
          borderRadius: "var(--lp-radius-button)",
        }}
      >
        {badge}
      </span>
    </div>
  ) : null;

  // CTA-Button im Stil des CTA-Banners (Tokens fuer Radius/Schatten/Farbe,
  // Hover als Arbitrary-Klasse). py-3.5 + Textzeile ergibt >= 44px Tap-Ziel.
  const ctaNode = showCta ? (
    <CtaButton
      leadId={leadId}
      label={ctaLabel}
      href={ctaUrl}
      position="primary"
      className={cn(
        "inline-flex items-center justify-center px-7 py-3.5",
        "text-sm font-semibold transition-all duration-150",
        "rounded-[var(--lp-radius-button)]",
        "bg-[color:var(--lp-color-primary)] hover:bg-[color:var(--lp-color-primary-hover)]",
      )}
      style={{
        color: "var(--lp-color-on-primary)",
        boxShadow: "var(--lp-shadow-cta)",
      }}
    >
      {ctaLabel}
    </CtaButton>
  ) : null;

  /* ------------------------------------------------------------------ */
  /* Variante "centered" — Bestandslayout, unveraendert                  */
  /* ------------------------------------------------------------------ */

  if (layout === "centered") {
    return (
      <BlockFrame
        style={style}
        defaults={{ paddingY: "lg", maxWidth: "normal", alignment }}
      >
        {badgeNode}
        {headline && (
          <h1
            className="text-3xl sm:text-4xl font-bold tracking-tight text-balance"
            style={{ fontFamily: "var(--lp-font-heading)" }}
          >
            {headline}
          </h1>
        )}
        {subheadline && (
          <p
            className={cn(
              "mt-3 text-base sm:text-lg opacity-80",
              headline ? "" : "mt-0",
            )}
          >
            {subheadline}
          </p>
        )}
        {showVideo && slot && (
          isPortraitWebcamOnly ? (
            // Full-bleed-Wrapper: kein rounded/overflow/shadow — der Slot
            // (VideoPlayer) bringt seinen eigenen schwarzen Hintergrund mit.
            // `bg-black/95 backdrop-blur` macht den umgebenden Bereich auf
            // sehr breiten Viewports ruhig.
            <div className="mt-8 -mx-5 sm:-mx-8 bg-black/95 backdrop-blur py-6 text-left">
              {slot}
            </div>
          ) : (
            <div
              className="mt-8 overflow-hidden text-left"
              style={{
                borderRadius: "var(--lp-radius-card)",
                boxShadow: "var(--lp-shadow-card)",
              }}
            >
              {slot}
            </div>
          )
        )}
        {ctaNode && <div className="mt-8">{ctaNode}</div>}
      </BlockFrame>
    );
  }

  /* ------------------------------------------------------------------ */
  /* Varianten "split" / "split-reverse"                                 */
  /* ------------------------------------------------------------------ */

  const reverse = layout === "split-reverse";
  const textCol = reverse ? "md:col-start-2" : "md:col-start-1";
  const mediaCol = reverse ? "md:col-start-1" : "md:col-start-2";

  // Im Split-Layout gibt es kein Full-Bleed: Portrait-Videos werden auf
  // eine sinnvolle max-Breite begrenzt und wie eine Karte gerundet, damit
  // die Spalte nicht von einem 9:16-Riesen dominiert wird.
  const videoNode =
    showVideo && slot ? (
      <div
        className={cn(
          "overflow-hidden text-left",
          isPortraitWebcamOnly
            ? "mx-auto w-full max-w-[280px] sm:max-w-[320px]"
            : "w-full",
        )}
        style={{
          borderRadius: "var(--lp-radius-card)",
          boxShadow: "var(--lp-shadow-card)",
        }}
      >
        {slot}
      </div>
    ) : null;

  // Grid-Choreografie: DOM-Reihenfolge = Headline → Video → CTA (die
  // Smartphone-Reihenfolge aus dem Konzept). Ab md ordnen row/col-Starts
  // die drei Bloecke in zwei Spalten an; das Video spannt beide Zeilen.
  return (
    <BlockFrame
      style={style}
      defaults={{ paddingY: "lg", maxWidth: "wide", alignment: "left" }}
    >
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 md:gap-10 lg:gap-14 md:items-center">
        <div className={cn("md:row-start-1", textCol)}>
          {badgeNode}
          {headline && (
            <h1
              className="text-3xl sm:text-4xl lg:text-5xl font-bold tracking-tight text-balance"
              style={{ fontFamily: "var(--lp-font-heading)" }}
            >
              {headline}
            </h1>
          )}
          {subheadline && (
            <p
              className={cn(
                "text-base sm:text-lg opacity-80",
                headline ? "mt-3" : "mt-0",
              )}
            >
              {subheadline}
            </p>
          )}
        </div>
        {videoNode && (
          <div
            className={cn(
              "md:row-start-1 md:row-span-2 md:self-center",
              mediaCol,
            )}
          >
            {videoNode}
          </div>
        )}
        {ctaNode && (
          <div className={cn("md:row-start-2 md:self-start", textCol)}>
            {ctaNode}
          </div>
        )}
      </div>
    </BlockFrame>
  );
}
