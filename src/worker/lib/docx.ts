/**
 * DOCX manipulation helpers (pizzip-based).
 *
 * A `.docx` is just a ZIP archive whose `word/document.xml` describes the
 * document text and whose `word/media/*` folder holds embedded images.
 *
 * Our pipeline needs two operations:
 *
 *  1. Replace `{{placeholder}}` tokens in the document text with values
 *     from the lead's data row. Word frequently splits a single placeholder
 *     across multiple `<w:r>` runs (e.g. spell-check, formatting), so we
 *     pre-merge consecutive runs by stripping the inter-run XML between
 *     `{{` and `}}` BEFORE doing the substitution.
 *
 *  2. Replace embedded images that match a known SHA-256 hash with new
 *     image bytes. This is how we swap the QR-Code and thumbnail markers
 *     in the source template for the per-lead rendered images.
 *
 * The primary API is PizZip-based (load once, mutate, save once) which is
 * MUCH more efficient than the previous buffer-in / buffer-out style. The
 * old signatures are kept as thin shims for any callers that still hold a
 * Buffer.
 */

import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import PizZip from "pizzip";

const DOCUMENT_XML_PATH = "word/document.xml";

export interface LoadedDocx {
  zip: PizZip;
}

/**
 * Loads a DOCX archive from a Buffer.
 */
export function loadDocx(buffer: Buffer): LoadedDocx {
  return { zip: new PizZip(buffer) };
}

/**
 * Convenience: read a DOCX from disk and return a parsed PizZip handle.
 */
export async function loadDocxFromPath(path: string): Promise<LoadedDocx> {
  const buf = await readFile(path);
  return loadDocx(buf);
}

/**
 * Serialises the (mutated) archive back into a Buffer.
 */
export function saveDocx(zip: PizZip): Buffer {
  return zip.generate({ type: "nodebuffer" }) as Buffer;
}

/**
 * Reads the `word/document.xml` text content of a DOCX archive.
 */
export function getDocumentXml(zip: PizZip): string {
  const file = zip.file(DOCUMENT_XML_PATH);
  if (!file) {
    throw new Error(`[docx] ${DOCUMENT_XML_PATH} not found in archive`);
  }
  return file.asText();
}

/**
 * Writes new XML into the archive's `word/document.xml`.
 */
export function setDocumentXml(zip: PizZip, xml: string): void {
  zip.file(DOCUMENT_XML_PATH, xml);
}

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Detects placeholders split across multiple runs and merges them.
 *
 * Strategy: scan for `{{` and `}}` markers and, between each matching pair,
 * strip ALL inline XML tags so the placeholder text becomes a contiguous
 * substring. Multi-run formatting around the placeholder is removed (we
 * intentionally don't try to preserve it — the placeholder's surrounding
 * paragraph still keeps the run-properties from the FIRST run).
 */
function joinSplitPlaceholders(xml: string): string {
  return xml.replace(/\{\{([\s\S]*?)\}\}/g, (_, inner: string) => {
    const cleaned = inner.replace(/<[^>]+>/g, "");
    return `{{${cleaned}}}`;
  });
}

/**
 * Replaces `{{name}}` placeholders in `word/document.xml` with values from
 * `vars`. Unknown placeholders are LEFT IN PLACE (so the template author
 * can audit visually what was missed). All replacement values are
 * XML-escaped.
 *
 * Accepts either a `PizZip` (preferred) or a `Buffer`. With Buffer-input,
 * a new Buffer is returned; with Zip-input, the zip is mutated in place
 * and `undefined` is returned (the same zip can be passed to subsequent
 * mutators / `saveDocx`).
 */
export function replacePlaceholders(
  zip: PizZip,
  vars: Record<string, string>,
): void;
export function replacePlaceholders(
  buffer: Buffer,
  vars: Record<string, string>,
): Buffer;
export function replacePlaceholders(
  input: PizZip | Buffer,
  vars: Record<string, string>,
): Buffer | void {
  const isBuffer = Buffer.isBuffer(input);
  const zip = isBuffer ? new PizZip(input as Buffer) : (input as PizZip);

  let xml = getDocumentXml(zip);
  xml = joinSplitPlaceholders(xml);
  xml = xml.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (match, key: string) => {
    const trimmed = key.trim();
    const value = vars[trimmed];
    if (value === undefined || value === null) return match;
    return xmlEscape(String(value));
  });
  setDocumentXml(zip, xml);

  if (isBuffer) return saveDocx(zip);
}

export interface ReplaceImageInput {
  targetSha256: string;
  newImageBuffer: Buffer;
  /**
   * Optional override for the stored content-type. Not currently persisted
   * anywhere (Word reads the image from the file extension stored in
   * `word/_rels/document.xml.rels`) but accepted for forward-compat.
   */
  contentType?: string;
}

/**
 * Scans `word/media/*` for an image whose SHA-256 matches `targetSha256`
 * and replaces its content with `newImageBuffer`.
 *
 * - With `PizZip` input: mutates the zip and returns `true` iff a media
 *   file was matched and replaced.
 * - With `Buffer` input: returns the new archive buffer (kept for
 *   backward compatibility).
 */
export function replaceImageByHash(zip: PizZip, opts: ReplaceImageInput): boolean;
export function replaceImageByHash(buffer: Buffer, opts: ReplaceImageInput): Buffer;
export function replaceImageByHash(
  input: PizZip | Buffer,
  opts: ReplaceImageInput,
): boolean | Buffer {
  const isBuffer = Buffer.isBuffer(input);
  const zip = isBuffer ? new PizZip(input as Buffer) : (input as PizZip);

  const files = zip.file(/^word\/media\//);
  let replaced = false;

  for (const entry of files) {
    const data = entry.asNodeBuffer();
    const hash = createHash("sha256").update(data).digest("hex");
    if (hash === opts.targetSha256) {
      zip.file(entry.name, opts.newImageBuffer);
      replaced = true;
      break;
    }
  }

  if (!replaced) {
    // eslint-disable-next-line no-console
    console.warn(
      `[docx] no media file matched sha256=${opts.targetSha256.slice(0, 16)}…`,
    );
  }

  if (isBuffer) return saveDocx(zip);
  return replaced;
}
