/**
 * Build a file-manifest from the extracted ZIP contents and (optionally)
 * parse a `videocomet.json` config that the customer may have included.
 *
 * The file-manifest is persisted in `custom_lp_versions.file_manifest` and
 * lets the sandbox subdomain (Agent B) know exactly which assets exist,
 * their sizes, MIME types, and content hashes — without having to LIST the
 * Bunny prefix on every request.
 *
 * Shape on disk:
 *   `[{ path, size, hash, mime }, …]`
 *
 *   - `path` is the *relative path inside the version's storage prefix*
 *     (NOT a full Bunny URL). For example, given storagePath
 *     `custom-lp/abc/v1/`, a file at `custom-lp/abc/v1/assets/hero.jpg`
 *     is stored here as `assets/hero.jpg`.
 *   - `hash` is the sha256 hex of the file contents. The sandbox uses this
 *     for an HTTP `ETag` so browsers can revalidate cheaply.
 */

import crypto from "node:crypto";
import type { ExtractedFile } from "./types";

export interface FileManifestEntry {
  path: string;
  size: number;
  hash: string;
  mime: string;
}

export interface BuildManifestResult {
  files: FileManifestEntry[];
  /** Sum of all `size` values — convenient for the version row's `bytesTotal`. */
  bytesTotal: number;
}

/** SHA-256 hex digest of a buffer. */
function sha256Hex(buf: Buffer): string {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

/**
 * Builds the file-manifest from already-validated, in-memory files. Order
 * is preserved (callers usually pass the validator's output, which is in
 * ZIP-iteration order — close enough to alphabetical for human review).
 */
export function buildFileManifest(files: ExtractedFile[]): BuildManifestResult {
  let bytesTotal = 0;
  const out: FileManifestEntry[] = files.map((f) => {
    bytesTotal += f.size;
    return {
      path: f.path,
      size: f.size,
      hash: sha256Hex(f.content),
      mime: f.mime,
    };
  });
  return { files: out, bytesTotal };
}

/**
 * Tries to parse a customer-supplied `videocomet.json`. We perform light
 * normalisation: keep recognised fields, drop unknown ones into a `_extra`
 * bag so we don't lose them but also don't have to schema-validate them.
 *
 * Recognised fields (additive; everything is optional):
 *
 *   - `entry`              string — override the entry HTML filename
 *   - `defaultLeadData`    record<string,string> — fallbacks for placeholders
 *   - `annotations`        record<string,unknown> — picker hints (precedence
 *                          beats the picker only on FIRST upload; afterwards
 *                          the DB row wins)
 *   - `cspExtras`          { scriptSrc?: string[]; styleSrc?: string[]; … }
 *                          — additional CSP hosts requested by the customer
 *                          (Agent B may or may not honour these)
 *
 * Any non-string `entry` or non-object `defaultLeadData` is silently ignored.
 */
export interface NormalisedManifest {
  entry?: string;
  defaultLeadData?: Record<string, string>;
  annotations?: Record<string, unknown>;
  cspExtras?: {
    scriptSrc?: string[];
    styleSrc?: string[];
    imgSrc?: string[];
    fontSrc?: string[];
    connectSrc?: string[];
  };
  _extra?: Record<string, unknown>;
}

export function normaliseManifest(
  raw: Record<string, unknown> | null,
): NormalisedManifest | null {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;

  const out: NormalisedManifest = {};
  const recognised = new Set([
    "entry",
    "defaultLeadData",
    "annotations",
    "cspExtras",
  ]);

  if (typeof raw.entry === "string" && raw.entry.length > 0) {
    out.entry = raw.entry;
  }

  if (
    raw.defaultLeadData !== undefined &&
    raw.defaultLeadData !== null &&
    typeof raw.defaultLeadData === "object" &&
    !Array.isArray(raw.defaultLeadData)
  ) {
    const map: Record<string, string> = {};
    for (const [k, v] of Object.entries(raw.defaultLeadData as Record<string, unknown>)) {
      if (typeof v === "string") map[k] = v;
      else if (typeof v === "number" || typeof v === "boolean") map[k] = String(v);
    }
    out.defaultLeadData = map;
  }

  if (
    raw.annotations !== undefined &&
    raw.annotations !== null &&
    typeof raw.annotations === "object" &&
    !Array.isArray(raw.annotations)
  ) {
    out.annotations = raw.annotations as Record<string, unknown>;
  }

  if (
    raw.cspExtras !== undefined &&
    raw.cspExtras !== null &&
    typeof raw.cspExtras === "object" &&
    !Array.isArray(raw.cspExtras)
  ) {
    const csp = raw.cspExtras as Record<string, unknown>;
    const csps: NormalisedManifest["cspExtras"] = {};
    const strArr = (v: unknown): string[] | undefined =>
      Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : undefined;
    csps.scriptSrc = strArr(csp.scriptSrc);
    csps.styleSrc = strArr(csp.styleSrc);
    csps.imgSrc = strArr(csp.imgSrc);
    csps.fontSrc = strArr(csp.fontSrc);
    csps.connectSrc = strArr(csp.connectSrc);
    out.cspExtras = csps;
  }

  const extras: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (!recognised.has(k)) extras[k] = v;
  }
  if (Object.keys(extras).length > 0) out._extra = extras;

  return out;
}
