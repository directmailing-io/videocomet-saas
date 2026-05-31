import type { BlockRenderProps, BlockType } from "@/lib/landing-blocks/types";
import { BlockAboutMe } from "./block-about-me";
import { BlockCtaBanner } from "./block-cta-banner";
import { BlockFaq } from "./block-faq";
import { BlockHero } from "./block-hero";
import { BlockImage } from "./block-image";
import { BlockLogosCloud } from "./block-logos-cloud";
import { BlockRichText } from "./block-rich-text";
import { BlockSpacer } from "./block-spacer";
import { BlockStats } from "./block-stats";
import { BlockTestimonials } from "./block-testimonials";

/**
 * Public block registry. The page renderer looks up `BLOCK_REGISTRY[type]`
 * and renders the matching component; unknown types are skipped silently
 * so a future template referencing a not-yet-deployed block doesn't 500
 * the page.
 *
 * Adding a new block:
 *   1. Add the literal to `BlockType` in `lib/landing-blocks/types.ts`.
 *   2. Create `block-<kind>.tsx` here.
 *   3. Register it in this map.
 */
export type BlockComponent = (
  props: BlockRenderProps,
) => React.ReactElement | null;

export const BLOCK_REGISTRY: Record<BlockType, BlockComponent> = {
  hero: BlockHero,
  "about-me": BlockAboutMe,
  testimonials: BlockTestimonials,
  "logos-cloud": BlockLogosCloud,
  stats: BlockStats,
  faq: BlockFaq,
  "rich-text": BlockRichText,
  "cta-banner": BlockCtaBanner,
  image: BlockImage,
  spacer: BlockSpacer,
};

export {
  BlockAboutMe,
  BlockCtaBanner,
  BlockFaq,
  BlockHero,
  BlockImage,
  BlockLogosCloud,
  BlockRichText,
  BlockSpacer,
  BlockStats,
  BlockTestimonials,
};
export { CtaButton } from "./cta-button";
