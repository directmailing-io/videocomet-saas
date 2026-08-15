/**
 * Inhaltsbasierte Prüfung von Bild-Uploads (Magic Bytes statt
 * client-deklariertem MIME-Typ).
 *
 * Hintergrund (Security-Review 2026-08-15): Der MIME-Typ eines Uploads
 * kommt vom Browser und ist frei fälschbar. Bunny Edge Storage liefert
 * den Content-Type außerdem anhand der Datei-ENDUNG aus — eine als
 * "bild.html" hochgeladene Datei mit Fake-MIME würde vom CDN als
 * text/html ausgeliefert (Stored XSS). Deshalb:
 *   1. Bildinhalte werden hier per Magic Bytes verifiziert.
 *   2. Die Datei-Endung wird aus dem VERIFIZIERTEN Typ abgeleitet,
 *      nie aus dem Dateinamen.
 *   3. SVGs mit aktiven Inhalten (Script, Event-Handler, iframes …)
 *      werden abgelehnt — nicht saniert.
 */

export interface SniffedImage {
  mime: "image/png" | "image/jpeg" | "image/webp" | "image/svg+xml";
  ext: "png" | "jpg" | "webp" | "svg";
}

/**
 * Erkennt PNG/JPEG/WebP per Magic Bytes und SVG per XML-Text-Check.
 * null = kein unterstütztes Bildformat (Upload ablehnen).
 * Gefährliche SVGs liefern ebenfalls null.
 */
export function sniffImage(buffer: Buffer): SniffedImage | null {
  if (buffer.length < 12) return null;

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return { mime: "image/png", ext: "png" };
  }

  // JPEG: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { mime: "image/jpeg", ext: "jpg" };
  }

  // WebP: "RIFF" .... "WEBP"
  if (
    buffer.toString("ascii", 0, 4) === "RIFF" &&
    buffer.toString("ascii", 8, 12) === "WEBP"
  ) {
    return { mime: "image/webp", ext: "webp" };
  }

  // SVG: Text, der (nach BOM/XML-Deklaration/Kommentaren/Doctype) mit
  // einem <svg>-Element beginnt.
  const text = decodeUtf8(buffer);
  if (text !== null && looksLikeSvg(text)) {
    if (svgIsDangerous(text)) return null;
    return { mime: "image/svg+xml", ext: "svg" };
  }

  return null;
}

function decodeUtf8(buffer: Buffer): string | null {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    return null;
  }
}

function looksLikeSvg(text: string): boolean {
  // BOM, XML-Deklaration, Kommentare, Doctype und Whitespace überspringen.
  let rest = text.replace(/^﻿/, "").trimStart();
  for (;;) {
    if (rest.startsWith("<?")) {
      const end = rest.indexOf("?>");
      if (end === -1) return false;
      rest = rest.slice(end + 2).trimStart();
    } else if (rest.startsWith("<!--")) {
      const end = rest.indexOf("-->");
      if (end === -1) return false;
      rest = rest.slice(end + 3).trimStart();
    } else if (/^<!doctype/i.test(rest)) {
      const end = rest.indexOf(">");
      if (end === -1) return false;
      rest = rest.slice(end + 1).trimStart();
    } else {
      break;
    }
  }
  return /^<svg[\s>]/i.test(rest);
}

/**
 * Konservative Ablehnliste für aktive Inhalte in SVGs. Wir lehnen ab
 * statt zu sanitisieren — ein Logo/Bild braucht nichts davon.
 */
export function svgIsDangerous(svg: string): boolean {
  const lower = svg.toLowerCase();
  if (lower.includes("<script")) return true;
  if (lower.includes("<foreignobject")) return true;
  if (lower.includes("<iframe")) return true;
  if (lower.includes("<embed")) return true;
  if (lower.includes("<object")) return true;
  if (lower.includes("javascript:")) return true;
  // Event-Handler-Attribute (onload=, onclick=, …)
  if (/\bon[a-z]+\s*=/.test(lower)) return true;
  // Nachladen fremder/aktiver Inhalte über data:-URLs
  if (/data:\s*text\/html/.test(lower)) return true;
  return false;
}

/**
 * Datei-Endung aus dem (verifizierten bzw. allowlisted) MIME-Typ. Die
 * Endung bestimmt bei Bunny Storage den ausgelieferten Content-Type —
 * sie darf deshalb NIE aus dem Dateinamen des Uploads kommen.
 */
const EXT_BY_MIME: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/svg+xml": "svg",
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/quicktime": "mov",
  "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
    "docx",
};

export function extFromMime(mime: string): string | null {
  const normalized = mime.toLowerCase().split(";")[0].trim();
  return EXT_BY_MIME[normalized] ?? null;
}
