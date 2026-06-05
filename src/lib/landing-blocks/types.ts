/**
 * Type definitions for the block-based Landing-Page system.
 *
 * The persisted `landing_page_templates.content` JSON moves from a single
 * flat object (v1) to a versioned, block-driven shape (v2). Old documents
 * keep working — `migrateLegacyContent()` upgrades them on read.
 *
 * Agent boundaries: Agent B owns `theme`, Agent C owns the editor. This
 * file is the shared contract between renderer, editor and migration.
 */

/* ------------------------------------------------------------------ */
/* Block-type catalogue                                                */
/* ------------------------------------------------------------------ */

/**
 * String literal union of every block type we render. Extending the
 * catalogue is a two-step change: add the literal here, then register a
 * component in `src/components/landing-blocks/index.ts`.
 */
export type BlockType =
  | "hero"
  | "about-me"
  | "testimonials"
  | "logos-cloud"
  | "stats"
  | "faq"
  | "rich-text"
  | "cta-banner"
  | "image"
  | "spacer";

/* ------------------------------------------------------------------ */
/* Per-block style overrides                                           */
/* ------------------------------------------------------------------ */

export type BlockPadding = "sm" | "md" | "lg";
export type BlockAlignment = "left" | "center" | "right";
export type BlockMaxWidth = "narrow" | "normal" | "wide" | "full";

export interface BlockStyle {
  bgColor?: string;
  textColor?: string;
  paddingY?: BlockPadding;
  alignment?: BlockAlignment;
  maxWidth?: BlockMaxWidth;
}

/* ------------------------------------------------------------------ */
/* Block envelope                                                      */
/* ------------------------------------------------------------------ */

/**
 * A single block on the page. `data` is intentionally untyped at this
 * level — each renderer is responsible for narrowing it. This keeps the
 * envelope cheap to validate and lets us extend block shapes without a
 * type-system migration.
 */
export interface Block {
  id: string;
  type: BlockType;
  data: Record<string, unknown>;
  style?: BlockStyle;
}

/* ------------------------------------------------------------------ */
/* Theme — placeholder until Agent B fills it in                        */
/* ------------------------------------------------------------------ */

/**
 * Reserved namespace for Agent B (theme tokens: colors, fonts, spacing,
 * logo slot). Kept as an open record here so we don't block the renderer
 * on the theme PR landing first.
 */
export type LandingTheme = Record<string, unknown>;

/* ------------------------------------------------------------------ */
/* Legacy v1 fields (preserved during migration)                       */
/* ------------------------------------------------------------------ */

/**
 * Mirror of the old TemplateContent shape. We keep this around inside
 * `v2.legacy` so the editor can offer a "migrated from old shape" toast
 * and let users diff the conversion if they want to.
 */
export interface LegacyTemplateContent {
  headline?: string;
  subheadline?: string;
  bodyText?: string;
  primaryButtonText?: string;
  primaryButtonUrl?: string;
  secondaryButtonText?: string;
  secondaryButtonUrl?: string;
  footnote?: string;
  bgColor?: string;
  textColor?: string;
  accentColor?: string;
}

/* ------------------------------------------------------------------ */
/* Top-level content envelope                                          */
/* ------------------------------------------------------------------ */

export interface LandingContentV2 {
  version: 2;
  theme: LandingTheme;
  blocks: Block[];
  legacy?: LegacyTemplateContent;
}

/* ------------------------------------------------------------------ */
/* Lead-data shape used by placeholder substitution                    */
/* ------------------------------------------------------------------ */

/**
 * CSV-imported lead data is a flat string-keyed map. Callers pass it
 * straight through from the DB; placeholder resolution treats missing
 * keys as undefined.
 */
export type LeadData = Record<string, string | undefined>;

/* ------------------------------------------------------------------ */
/* Props passed to every block renderer                                */
/* ------------------------------------------------------------------ */

/**
 * Common renderer contract. Each block component is a pure function of
 * its props — no internal state, no data fetching. The `slot` escape
 * hatch is used by Hero to receive the video player node from the page
 * shell (which owns leadId/tracking).
 */
export interface BlockRenderProps {
  data: Record<string, unknown>;
  style?: BlockStyle;
  theme: LandingTheme;
  leadData: LeadData;
  leadId: string;
  /**
   * Optional React node injected by the page shell. Currently only Hero
   * uses it (for the video player); other blocks ignore it.
   */
  slot?: React.ReactNode;
  /**
   * Aspect-ratio des Lead-Videos (kommt aus `leads.video_orientation`).
   * Wird vom Hero-Block ausgewertet, um den Slot-Wrapper bei Portrait-
   * Webcam-Videos auf Full-Bleed zu schalten — sonst entstehen schwarze
   * Streifen links/rechts. `null`/undefined → konservatives 16:9-Layout.
   */
  videoOrientation?: "landscape" | "portrait" | "square" | null;
  /**
   * Kampagnen-Modus (`campaigns.mode`). Hero-Block nutzt das in Kombination
   * mit `videoOrientation`, um zu entscheiden, ob er den Video-Container
   * full-bleed (ohne max-width-Constraint) rendert.
   */
  campaignMode?: "webcam-only" | "with-presentation" | null;
}
