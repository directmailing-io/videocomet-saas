/**
 * One-shot migration from v1 (flat) to v2 (block-based) landing-page
 * content. Runs at render-time on every request, so it must be:
 *
 *   - Idempotent (v2 in -> v2 out, unchanged).
 *   - Defensive (v1 may have missing/garbage fields — never throws).
 *   - Cheap (no allocations beyond what's needed).
 *
 * The old shape is preserved in `legacy` for the editor to surface a
 * "migrated from old shape" toast and let users review the conversion.
 */

import type {
  Block,
  LandingContentV2,
  LegacyTemplateContent,
} from "./types";

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function isV2(raw: unknown): raw is LandingContentV2 {
  if (!raw || typeof raw !== "object") return false;
  const r = raw as { version?: unknown; blocks?: unknown };
  return r.version === 2 && Array.isArray(r.blocks);
}

/**
 * Lightweight ID generator. We do not need cryptographic strength here —
 * IDs only need to be stable within a single content document so the
 * editor can key React lists. `crypto.randomUUID()` would also work but
 * pulling it adds a server-only dep on the Web Crypto polyfill in some
 * Next.js edge runtimes; this is enough.
 */
function genId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

function readLegacy(raw: unknown): LegacyTemplateContent {
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
    bgColor: asString(r.bgColor),
    textColor: asString(r.textColor),
    accentColor: asString(r.accentColor),
  };
}

/**
 * Build v2 blocks from a v1 document. Each builder is independent so an
 * empty legacy field simply skips its block — we never emit empty blocks
 * just for the sake of structure.
 */
function buildBlocksFromLegacy(legacy: LegacyTemplateContent): Block[] {
  const blocks: Block[] = [];

  // Hero is always present — even a totally empty legacy template gets
  // a hero so the page has *something* above the fold. Headline falls
  // back to a friendly default that uses the {{firstName}} placeholder.
  blocks.push({
    id: genId("hero"),
    type: "hero",
    data: {
      headline:
        legacy.headline ?? "{{firstName|Hallo}}, dieses Video ist für Sie",
      subheadline: legacy.subheadline,
      showVideo: true,
      alignment: "center",
    },
  });

  if (legacy.bodyText) {
    blocks.push({
      id: genId("rich"),
      type: "rich-text",
      data: { markdown: legacy.bodyText },
    });
  }

  const hasPrimary = Boolean(
    legacy.primaryButtonText && legacy.primaryButtonUrl,
  );
  const hasSecondary = Boolean(
    legacy.secondaryButtonText && legacy.secondaryButtonUrl,
  );
  if (hasPrimary || hasSecondary) {
    blocks.push({
      id: genId("cta"),
      type: "cta-banner",
      data: {
        headline: "Termin vereinbaren",
        primaryButton: hasPrimary
          ? {
              label: legacy.primaryButtonText,
              url: legacy.primaryButtonUrl,
            }
          : undefined,
        secondaryButton: hasSecondary
          ? {
              label: legacy.secondaryButtonText,
              url: legacy.secondaryButtonUrl,
            }
          : undefined,
      },
    });
  }

  return blocks;
}

/**
 * Main entry point. Accepts anything (jsonb is untyped at the DB level)
 * and returns a guaranteed v2 document.
 */
export function migrateLegacyContent(raw: unknown): LandingContentV2 {
  if (isV2(raw)) {
    // Defensive copy of `theme` so callers cannot mutate the cached
    // DB row through the returned object.
    const theme =
      raw.theme && typeof raw.theme === "object"
        ? (raw.theme as Record<string, unknown>)
        : {};
    return {
      version: 2,
      theme,
      blocks: raw.blocks,
      legacy: raw.legacy,
    };
  }

  const legacy = readLegacy(raw);
  return {
    version: 2,
    theme: {},
    blocks: buildBlocksFromLegacy(legacy),
    legacy,
  };
}

/**
 * Helper used by the editor: build an empty v2 document ready for a
 * brand-new template. Kept here (not in placeholders/types) so the
 * canonical "shape of a fresh document" lives next to the migration
 * code that defines what counts as v2.
 */
export function emptyV2Content(): LandingContentV2 {
  return {
    version: 2,
    theme: {},
    blocks: [],
  };
}
