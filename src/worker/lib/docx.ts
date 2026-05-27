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
 */

import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import PizZip from "pizzip";

export interface LoadedDocx {
  buffer: Buffer;
}

/**
 * Reads a DOCX file from disk into a Buffer.
 */
export async function loadDocx(path: string): Promise<LoadedDocx> {
  const buffer = await readFile(path);
  return { buffer };
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
    // Drop everything inside the placeholder that is XML markup.
    const cleaned = inner.replace(/<[^>]+>/g, "");
    return `{{${cleaned}}}`;
  });
}

/**
 * Replaces `{{name}}` placeholders in `word/document.xml` with values from
 * `vars`. Unknown placeholders are LEFT IN PLACE (so the template author
 * can audit visually what was missed). All replacement values are
 * XML-escaped.
 */
export function replacePlaceholders(
  buffer: Buffer,
  vars: Record<string, string>,
): Buffer {
  const zip = new PizZip(buffer);
  const docFile = zip.file("word/document.xml");
  if (!docFile) {
    throw new Error("[docx] word/document.xml not found in archive");
  }

  let xml = docFile.asText();
  xml = joinSplitPlaceholders(xml);
  xml = xml.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (match, key: string) => {
    const trimmed = key.trim();
    const value = vars[trimmed];
    if (value === undefined || value === null) return match;
    return xmlEscape(String(value));
  });

  zip.file("word/document.xml", xml);
  return zip.generate({ type: "nodebuffer" }) as Buffer;
}

export interface ReplaceImageInput {
  targetSha256: string;
  newImageBuffer: Buffer;
}

/**
 * Scans `word/media/*` for an image whose SHA-256 matches `targetSha256`
 * and replaces its content with `newImageBuffer`. Returns the modified
 * archive buffer. If no match is found the archive is returned unchanged
 * (callers usually log a warning).
 */
export function replaceImageByHash(
  buffer: Buffer,
  opts: ReplaceImageInput,
): Buffer {
  const zip = new PizZip(buffer);
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

  return zip.generate({ type: "nodebuffer" }) as Buffer;
}
