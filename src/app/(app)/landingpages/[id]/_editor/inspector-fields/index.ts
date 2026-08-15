"use client";

import type { Block, BlockType } from "@/lib/landing-blocks/types";
import { BlockAboutMeForm } from "./block-about-me-form";
import { BlockCaseStudyForm } from "./block-case-study-form";
import { BlockContentForm } from "./block-content-form";
import { BlockCtaBannerForm } from "./block-cta-banner-form";
import { BlockFaqForm } from "./block-faq-form";
import { BlockHeroForm } from "./block-hero-form";
import { BlockImageForm } from "./block-image-form";
import { BlockLogosCloudForm } from "./block-logos-cloud-form";
import { BlockRichTextForm } from "./block-rich-text-form";
import { BlockSpacerForm } from "./block-spacer-form";
import { BlockStatsForm } from "./block-stats-form";
import { BlockTestimonialsForm } from "./block-testimonials-form";

export type InspectorFormProps = {
  block: Block;
  onChange: (patch: Record<string, unknown>) => void;
};

export type InspectorForm = (props: InspectorFormProps) => React.JSX.Element;

/**
 * One form per Block-Type. Editor looks up the active block's type and
 * renders the matching form; blocks without a form fall back to a JSON
 * editor (not registered here).
 */
export const FORM_REGISTRY: Record<BlockType, InspectorForm> = {
  hero: BlockHeroForm,
  "about-me": BlockAboutMeForm,
  testimonials: BlockTestimonialsForm,
  "logos-cloud": BlockLogosCloudForm,
  stats: BlockStatsForm,
  faq: BlockFaqForm,
  "rich-text": BlockRichTextForm,
  "cta-banner": BlockCtaBannerForm,
  "case-study": BlockCaseStudyForm,
  content: BlockContentForm,
  image: BlockImageForm,
  spacer: BlockSpacerForm,
};

export const BLOCK_LABELS: Record<BlockType, string> = {
  hero: "Hero (Video)",
  "about-me": "Über mich",
  testimonials: "Testimonials",
  "logos-cloud": "Kunden-Logos",
  stats: "Zahlen / Stats",
  faq: "FAQ",
  "rich-text": "Text",
  "cta-banner": "CTA-Banner",
  "case-study": "Fallstudie",
  content: "Content",
  image: "Bild",
  spacer: "Abstand",
};
