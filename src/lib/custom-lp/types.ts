/**
 * Shared types for the Custom-Landingpage feature.
 *
 * Naming: "Custom-LP" = a customer-uploaded ZIP containing a static
 * HTML/CSS/JS site that we serve through the `/cv/<slug>` sandbox-subdomain
 * (Agent B). Each upload becomes an immutable `customLpVersions` row;
 * existing runs can be pinned to a specific version.
 */

/** Hard limits enforced by the ZIP-Validator. Decided by the user. */
export const CUSTOM_LP_LIMITS = {
  /** Max compressed ZIP size in bytes (50 MB). */
  MAX_ZIP_BYTES: 50 * 1024 * 1024,
  /** Max sum of uncompressed file sizes inside the ZIP (200 MB anti-bomb). */
  MAX_UNCOMPRESSED_BYTES: 200 * 1024 * 1024,
  /** Max per-entry compression ratio (uncompressed / compressed). */
  MAX_COMPRESSION_RATIO: 100,
  /** Max number of entries in the ZIP (sanity check, prevents huge inode counts). */
  MAX_ENTRIES: 2_000,
} as const;

/**
 * Exact, lowercased file-extension allow-list. Anything else is rejected.
 * Source of truth — referenced by the validator and the Bunny mime-resolver.
 */
export const CUSTOM_LP_ALLOWED_EXTENSIONS = [
  // HTML
  "html",
  "htm",
  // CSS / JS
  "css",
  "js",
  "mjs",
  // Data / vector
  "json",
  "svg",
  // Raster images
  "png",
  "jpg",
  "jpeg",
  "webp",
  "avif",
  "gif",
  "ico",
  // Fonts
  "woff",
  "woff2",
  "ttf",
  "otf",
  // Video
  "mp4",
  "webm",
  "vtt",
] as const;

export type CustomLpAllowedExtension =
  (typeof CUSTOM_LP_ALLOWED_EXTENSIONS)[number];

/**
 * A single normalised, validated file extracted from a customer ZIP.
 * `path` is always relative, forward-slash, no leading or trailing slash,
 * and is guaranteed to be free of `..` / absolute / symlink semantics.
 */
export interface ExtractedFile {
  path: string;
  content: Buffer;
  size: number;
  mime: string;
}

export type ZipValidationError =
  | "ZIP_TOO_LARGE"
  | "ZIP_EMPTY"
  | "ZIP_BAD_FORMAT"
  | "ZIP_TOO_MANY_ENTRIES"
  | "PATH_TRAVERSAL"
  | "ABSOLUTE_PATH"
  | "SYMLINK_FORBIDDEN"
  | "EXTENSION_DENIED"
  | "ZIP_BOMB_TOTAL"
  | "ZIP_BOMB_RATIO"
  | "MISSING_INDEX_HTML";

export interface ZipValidationOk {
  ok: true;
  files: ExtractedFile[];
  /** Resolved entry HTML path (relative inside the ZIP), e.g. `index.html`. */
  entryHtml: string;
  /** Parsed `videocomet.json` content if present at the ZIP root or first dir. */
  manifest: Record<string, unknown> | null;
  /** Sum of uncompressed file sizes in bytes. */
  bytesTotal: number;
}

export interface ZipValidationFail {
  ok: false;
  error: ZipValidationError;
  /** German-formal message for the customer. */
  message: string;
  /** Optional path of the offending entry. */
  path?: string;
}

export type ZipValidationResult = ZipValidationOk | ZipValidationFail;

/**
 * Element annotations set in the customer's visual picker (Agent C).
 * Stored verbatim in `custom_lp_versions.annotations` and injected into the
 * page through `window.__videocomet.annotations` so the tracking bridge
 * (Agent B) can wire events without us touching the user's markup.
 *
 * Selectors are stored as raw strings — the bridge is responsible for
 * resolving them. We do NOT validate the selectors here (they may use
 * arbitrarily complex CSS).
 */
export interface CustomLpAnnotations {
  videoSelector?: string | null;
  primaryCta?: string | null;
  secondaryCta?: string | null;
  /** Sections whose visibility should be tracked (e.g. `.pricing`). */
  sectionTracking?: string[];
  /**
   * Steuert, welche CSS-Aspect-Ratio in `--vc-video-aspect` injiziert wird.
   *
   *  - `preserve` (default): nutzt die echte Lead-Orientation (Portrait →
   *    9/16, Landscape → 16/9, Square → 1/1). Greift auf 16/9 zurueck,
   *    wenn die Lead-Orientation noch nicht bekannt ist.
   *  - `force-landscape`: ignoriert die Lead-Orientation, injiziert
   *    immer 16/9. Sinnvoll, wenn das Custom-Template hartkodiert auf
   *    Landscape-Layout setzt und ein Portrait-Video gecropped werden
   *    soll.
   *  - `force-portrait`: analog 9/16.
   *
   * Hinweis: das hier ist nur die CSS-Variable. Ob die Variable tatsaechlich
   * angewendet wird, entscheidet das Custom-Template (`aspect-ratio:
   * var(--vc-video-aspect)`).
   */
  videoAspectStrategy?: "preserve" | "force-landscape" | "force-portrait";
  /** Free-form bag for additional, schema-less annotations from the picker. */
  [key: string]: unknown;
}

/** Public-facing shape of a version row. */
export interface CustomLpVersionSummary {
  id: string;
  templateId: string;
  version: number;
  uploadedAt: Date;
  bytesTotal: number;
  entryHtml: string;
  isActive: boolean;
}

/** Public-facing shape of a template row including its active-version info. */
export interface CustomLpTemplateSummary {
  id: string;
  name: string;
  description: string | null;
  thumbnailUrl: string | null;
  activeVersion: {
    id: string;
    version: number;
    uploadedAt: Date;
  } | null;
  versionCount: number;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Summary of a Run that currently references one of this template's
 * versions. Returned by `/affected-runs` so the UI can ask the customer
 * whether to repin existing runs to the freshly uploaded version.
 */
export interface AffectedRunSummary {
  runId: string;
  runName: string;
  campaignId: string;
  campaignName: string;
  /** The version id currently pinned for this run. */
  pinnedVersionId: string;
  pinnedVersionNumber: number;
}
