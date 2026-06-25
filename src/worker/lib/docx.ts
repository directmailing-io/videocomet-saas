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
 * Liest den Dokument-Titel aus `docProps/core.xml` (dc:title). Gibt eine
 * leere Zeichenkette zurück, wenn das Feld nicht gesetzt ist — der Caller
 * kann dann auf einen Default fallen lassen.
 */
export function getDocxTitle(zip: PizZip): string {
  const file = zip.file("docProps/core.xml");
  if (!file) return "";
  const xml = file.asText();
  // `<dc:title>...</dc:title>` mit optionalem whitespace + Attributen.
  const m = /<dc:title[^>]*>([\s\S]*?)<\/dc:title>/i.exec(xml);
  if (!m) return "";
  return m[1]
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .trim();
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
 * Minimal HTML-escape (no apostrophe entity — `&apos;` is XML-only).
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Replaces `{{name}}` placeholders inside an HTML string with values from
 * `vars`. Designed for HTML exported from Google Docs, where a placeholder
 * like `{{firstName}}` can be split across inline `<span>` tags due to
 * font / formatting metadata (e.g. `{{<span style="font-weight:700">firstName</span>}}`).
 *
 * Strategy (single pass): match the smallest `{{ ... }}` run with
 *   /\{\{([^{}]*?)\}\}/g
 * and for each candidate strip ALL inline tags with `/<[^>]+>/g`, trim, then
 * look the result up in `vars`. If it's known, replace the entire match
 * (tags included) with the HTML-escaped value. Unknown keys are left as-is
 * so the template author can audit them visually.
 *
 * Whitespace inside the braces (e.g. `{{ firstName }}`) is tolerated.
 */
export function replacePlaceholdersInHtml(
  html: string,
  vars: Record<string, string>,
): string {
  return html.replace(/\{\{([^{}]*?)\}\}/g, (match, inner: string) => {
    const cleaned = inner.replace(/<[^>]+>/g, "").trim();
    // Nur valid-shape Token ersetzen — falls jemand `{{` als Literal nutzt,
    // soll das nicht weggeworfen werden.
    if (!/^[a-zA-Z0-9_]+$/.test(cleaned)) return match;
    const value = vars[cleaned];
    // Unbekannte Keys → Leerstring (siehe Begruendung in
    // `replacePlaceholders` oben — Wizard schreibt fehlende Mappings nicht
    // mit). Niemals raw `{{key}}` im finalen Brief stehen lassen.
    if (value === undefined || value === null) return "";
    return escapeHtml(String(value));
  });
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
 * `vars`. Unknown placeholders (key not in `vars`) werden zu **Leerstring**
 * — niemals raw `{{key}}` im finalen Dokument stehen lassen. Hintergrund:
 * der Run-Wizard schreibt fuer "User hat Mapping leer gelassen" gar keinen
 * Eintrag in `column_mapping` — der Key landet also nicht in `vars`.
 * Frueheres Verhalten („leave in place fuer Template-Author-Audit") hat
 * im PDF Roh-Tokens wie `{{anrede}}` produziert.
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
  xml = xml.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (_match, key: string) => {
    const trimmed = key.trim();
    const value = vars[trimmed];
    if (value === undefined || value === null) return "";
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
  /**
   * Optional Fallback: wenn die SHA-256 nicht matched (z.B. weil Google
   * Docs das PNG beim Einfügen re-encoded hat), wird stattdessen das
   * erste Bild mit diesen Pixel-Dimensionen ersetzt. Sehr robust für
   * Marker-Bilder mit eindeutigen Sizes (400x400 QR, 640x360 Thumb).
   */
  matchDimensions?: { width: number; height: number };
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
  let fallbackDimsMatchedName: string | null = null;

  for (const entry of files) {
    const data = entry.asNodeBuffer();
    const hash = createHash("sha256").update(data).digest("hex");
    if (hash === opts.targetSha256) {
      zip.file(entry.name, opts.newImageBuffer);
      replaced = true;
      break;
    }
    // Fallback: Dimensions-Match. Google Docs reencoded das PNG beim
    // Einfügen, dadurch ändert sich die SHA. Aber die Pixel-Dimensions
    // bleiben (Marker QR 400x400, Thumb 640x360). Wenn der Caller
    // matchDimensions setzt UND das Bild diese Maße hat, ist das in
    // 99,9% der Faelle der Marker.
    if (!fallbackDimsMatchedName && opts.matchDimensions) {
      const dims = readImageDimensions(data);
      if (
        dims &&
        dims.width === opts.matchDimensions.width &&
        dims.height === opts.matchDimensions.height
      ) {
        fallbackDimsMatchedName = entry.name;
      }
    }
  }

  if (!replaced && fallbackDimsMatchedName) {
    zip.file(fallbackDimsMatchedName, opts.newImageBuffer);
    replaced = true;
    // eslint-disable-next-line no-console
    console.log(
      `[docx] matched marker via dimensions fallback (${opts.matchDimensions?.width}x${opts.matchDimensions?.height}) -> ${fallbackDimsMatchedName}`,
    );
  }

  if (!replaced) {
    // eslint-disable-next-line no-console
    console.warn(
      `[docx] no media file matched sha256=${opts.targetSha256.slice(0, 16)}… (and no dimensions fallback hit)`,
    );
  }

  if (isBuffer) return saveDocx(zip);
  return replaced;
}

/**
 * Liest Pixel-Width/Height aus den ersten Bytes eines PNG/JPEG-Buffers.
 * Ohne sharp-Dependency, damit die DOCX-Stage leichtgewichtig bleibt.
 */
function readImageDimensions(
  buf: Buffer,
): { width: number; height: number } | null {
  if (buf.length < 24) return null;
  // PNG signature
  if (
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47
  ) {
    return {
      width: buf.readUInt32BE(16),
      height: buf.readUInt32BE(20),
    };
  }
  // JPEG: SOI 0xFFD8, dann durch Segmente bis SOFn (0xC0-0xCF, ausser DHT/JPG/DAC).
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let offset = 2;
    while (offset < buf.length) {
      if (buf[offset] !== 0xff) return null;
      const marker = buf[offset + 1];
      const segLen = buf.readUInt16BE(offset + 2);
      // SOF0..SOF15 ausser DHT(0xC4), JPG(0xC8), DAC(0xCC)
      if (
        marker >= 0xc0 &&
        marker <= 0xcf &&
        marker !== 0xc4 &&
        marker !== 0xc8 &&
        marker !== 0xcc
      ) {
        return {
          height: buf.readUInt16BE(offset + 5),
          width: buf.readUInt16BE(offset + 7),
        };
      }
      offset += 2 + segLen;
    }
    return null;
  }
  return null;
}
