import * as React from "react";
import { BLOCK_REGISTRY } from "@/components/landing-blocks";
import { StickyCta } from "@/components/landing-blocks/sticky-cta";
import { migrateLegacyContent } from "@/lib/landing-blocks/migrate";
import { renderPlaceholders } from "@/lib/landing-blocks/placeholders";
import type { Block, LeadData } from "@/lib/landing-blocks/types";

/**
 * Public-page renderer for the new block-based Landing-Page system.
 *
 * Flow:
 *   1. Normalise the persisted JSON via `migrateLegacyContent()` — old
 *      flat documents (v1) are upgraded on read, v2 passes through.
 *   2. For each block, look up the renderer in `BLOCK_REGISTRY` and
 *      render it. Unknown block types are skipped silently so the page
 *      survives a template that references a not-yet-deployed block.
 *   3. The hero block receives the video player via the `slot` prop;
 *      every block receives `leadData` so it can resolve placeholders.
 *
 * The legacy `themeId` parameter is no longer used directly by this
 * renderer — Agent B will wire CSS-var-based theme tokens into the
 * `<div data-lp-theme>` wrapper below. Kept in the prop list so the
 * page shell does not need to change when the theme PR lands.
 */

export interface LandingRenderProps {
  themeId: string | null | undefined;
  templateContent: unknown;
  leadData: Record<string, string>;
  leadId: string;
  /** Optional — page shell already keeps slug in cookies via TrackerInit. */
  slug?: string;
  videoSlot: React.ReactNode;
  /**
   * Aspect-Ratio des Lead-Videos. Wird ausschliesslich an den Hero-Block
   * durchgereicht (andere Blöcke embedden das Video nicht). `null` =
   * Bestandsverhalten (16:9-Container).
   */
  videoOrientation?: "landscape" | "portrait" | "square" | null;
  /**
   * Kampagnen-Modus. Wird ausschliesslich an den Hero-Block durchgereicht,
   * der ihn mit `videoOrientation` kombiniert um den Slot-Wrapper auf
   * Portrait-Webcam-Layout zu schalten.
   */
  campaignMode?: "webcam-only" | "with-presentation" | null;
}

export function LandingRender({
  templateContent,
  leadData,
  leadId,
  videoSlot,
  videoOrientation,
  campaignMode,
}: LandingRenderProps) {
  const content = migrateLegacyContent(templateContent);

  // Sticky-Mobile-CTA (Konzept Abschnitt 4): nur wenn ein CTA-Block
  // existiert und das Theme sie nicht abschaltet. Hero + erster CTA-Block
  // bekommen data-Attribut-Marker, ueber die die Client-Leiste Sichtbarkeit
  // (IntersectionObserver) und Scroll-Ziel findet.
  const firstCta = content.blocks.find((b) => b.type === "cta-banner");
  const firstHeroId = content.blocks.find((b) => b.type === "hero")?.id;
  const stickyEnabled =
    (content.theme as { stickyCta?: unknown }).stickyCta !== false;
  const stickyLabel = resolveStickyLabel(firstCta, leadData);

  return (
    <main className="min-h-screen w-full bg-surface-soft text-ink">
      {/* `data-lp-theme` is the hook Agent B will use to inject the
          theme's CSS variables. Until that lands, the wrapper is a
          structural no-op. */}
      <div data-lp-theme>
        {content.blocks.map((block) => {
          const rendered = (
            <RenderBlock
              block={block}
              theme={content.theme}
              leadData={leadData}
              leadId={leadId}
              videoSlot={videoSlot}
              videoOrientation={videoOrientation ?? null}
              campaignMode={campaignMode ?? null}
            />
          );
          // Marker-Wrapper nur fuer Hero + ersten CTA-Block — neutrale
          // <div>s um Block-<section>s, keine Layout-Wirkung.
          if (block.id === firstHeroId) {
            return (
              <div key={block.id} data-lp-hero>
                {rendered}
              </div>
            );
          }
          if (block.id === firstCta?.id) {
            return (
              <div key={block.id} data-lp-cta>
                {rendered}
              </div>
            );
          }
          return <React.Fragment key={block.id}>{rendered}</React.Fragment>;
        })}
        {firstCta && stickyEnabled && <StickyCta label={stickyLabel} />}
      </div>
    </main>
  );
}

/**
 * Label der Sticky-Leiste: primaryButton.label des ersten CTA-Blocks
 * (Platzhalter aufgeloest), sonst "Termin buchen".
 */
function resolveStickyLabel(
  firstCta: Block | undefined,
  leadData: LeadData,
): string {
  const button = firstCta?.data.primaryButton;
  if (button && typeof button === "object") {
    const label = (button as Record<string, unknown>).label;
    if (typeof label === "string" && label.trim()) {
      return renderPlaceholders(label, leadData) || label;
    }
  }
  return "Termin buchen";
}

interface RenderBlockProps {
  block: Block;
  theme: Record<string, unknown>;
  leadData: LeadData;
  leadId: string;
  videoSlot: React.ReactNode;
  videoOrientation: "landscape" | "portrait" | "square" | null;
  campaignMode: "webcam-only" | "with-presentation" | null;
}

function RenderBlock({
  block,
  theme,
  leadData,
  leadId,
  videoSlot,
  videoOrientation,
  campaignMode,
}: RenderBlockProps): React.ReactElement | null {
  const Component = BLOCK_REGISTRY[block.type];
  if (!Component) return null;
  // Only the hero receives the video slot; passing it everywhere would
  // tempt other blocks to embed the player in unexpected places.
  const isHero = block.type === "hero";
  const slot = isHero ? videoSlot : undefined;
  return (
    <Component
      data={block.data}
      style={block.style}
      variant={block.variant}
      theme={theme}
      leadData={leadData}
      leadId={leadId}
      slot={slot}
      // Nur dem Hero geben wir die Video-Meta — andere Blöcke
      // entscheiden ihr Layout nicht auf Basis des Lead-Videos.
      videoOrientation={isHero ? videoOrientation : null}
      campaignMode={isHero ? campaignMode : null}
    />
  );
}
