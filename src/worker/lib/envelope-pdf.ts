/**
 * Umschlag-PDF-Generator — pdf-lib direkt, kein Puppeteer.
 * Portiert aus umschlag-generator/server/utils/pdfGeneratorDirect.js
 * und auf TypeScript umgeschrieben.
 *
 * Renderfaehige Fonts:
 *   - LiebeHeideFineliner (embedded, .otf ~357KB)
 *   - BiroScript          (embedded, .ttf ~394KB)
 *   - Helvetica           (StandardFonts, Fallback, WinAnsi-Encoding)
 *
 * Nicht in v1: LiebeHeide-Color (18MB Color-Font, braucht Chromium).
 */

import { PDFDocument, rgb, StandardFonts, type PDFFont } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { EnvelopeField, EnvelopeSender } from "@/lib/db/schema";

const PT_PER_MM = 72 / 25.4;

const SIZES: Record<string, { width: number; height: number }> = {
  DIN_LANG: { width: 220, height: 110 },
  C4: { width: 324, height: 229 },
  C5: { width: 229, height: 162 },
  C6: { width: 162, height: 114 },
};

const FONT_FILES: Record<string, string> = {
  LiebeHeideFineliner: "LiebeHeideVector-FinelinerRegular.otf",
  BiroScript: "biro_script_plus.ttf",
};

// Fonts liegen im standalone-Output unter dem worker-lib-Dir.
// process.cwd() zeigt beim Worker-Prozess auf /app.
const FONTS_DIR = join(process.cwd(), "src/worker/fonts");

const fontBytesCache = new Map<string, Buffer | null>();
async function getFontBytes(filename: string): Promise<Buffer | null> {
  if (fontBytesCache.has(filename)) return fontBytesCache.get(filename) ?? null;
  try {
    const bytes = await readFile(join(FONTS_DIR, filename));
    fontBytesCache.set(filename, bytes);
    return bytes;
  } catch {
    fontBytesCache.set(filename, null);
    return null;
  }
}

function resolveContent(
  content: string,
  data: Record<string, unknown>,
  sender: EnvelopeSender,
): string {
  if (!content) return "";
  return content.replace(/\{\{([^}]+)\}\}/g, (_, keyRaw: string) => {
    const key = keyRaw.trim();
    // Sender-Prefix erkannt (z.B. {{__sender.name}})
    if (key.startsWith("__sender.")) {
      const field = key.slice("__sender.".length) as keyof EnvelopeSender;
      return String(sender[field] ?? "");
    }
    // Sonst: aus lead.data via case-insensitive lookup (Excel-Header-Match).
    const direct = data[key];
    if (direct != null && String(direct).trim() !== "") return String(direct);
    // Fallback: case-insensitive Search
    const lowerKey = key.toLowerCase();
    for (const [k, v] of Object.entries(data)) {
      if (k.toLowerCase() === lowerKey && v != null && String(v).trim() !== "") {
        return String(v);
      }
    }
    return "";
  });
}

/**
 * NFD-decompose + strip diacritics + strip non-Latin1 fuer WinAnsi-Helvetica.
 * Verhindert "invalid character" Errors bei Umlauten wenn Helvetica-Fallback greift.
 */
function sanitizeWinAnsi(text: string): string {
  return text
    // eslint-disable-next-line no-control-regex
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    // eslint-disable-next-line no-control-regex
    .replace(/[^\x00-\xff]/g, "");
}

function hexToRgb(hex: string | undefined) {
  const h = (hex || "#000000").replace("#", "").padEnd(6, "0");
  return rgb(
    parseInt(h.slice(0, 2), 16) / 255,
    parseInt(h.slice(2, 4), 16) / 255,
    parseInt(h.slice(4, 6), 16) / 255,
  );
}

function wrapText(
  font: PDFFont,
  text: string,
  fontSizePt: number,
  maxWidthPt: number,
): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      lines.push("");
      continue;
    }
    let line = "";
    for (const word of words) {
      const test = line ? `${line} ${word}` : word;
      if (line && font.widthOfTextAtSize(test, fontSizePt) > maxWidthPt) {
        lines.push(line);
        line = word;
      } else {
        line = test;
      }
    }
    if (line) lines.push(line);
  }
  return lines;
}

export interface GenerateEnvelopeInput {
  format: keyof typeof SIZES;
  fields: EnvelopeField[];
  sender: EnvelopeSender;
  /** Ein Empfaenger — wir generieren ein PDF pro Lead im Worker. */
  recipientData: Record<string, unknown>;
}

/**
 * Generiert ein einzelnes Umschlag-PDF fuer einen Lead. Returnt PDF-Bytes.
 */
export async function generateEnvelopePdf(
  input: GenerateEnvelopeInput,
): Promise<Buffer> {
  const { width: W, height: H } = SIZES[input.format] ?? SIZES.DIN_LANG;
  const W_pt = W * PT_PER_MM;
  const H_pt = H * PT_PER_MM;

  const pdfDoc = await PDFDocument.create();
  pdfDoc.registerFontkit(fontkit);

  // Pre-embed alle Fonts die im Template vorkommen (einmal pro Doc).
  const embeddedFonts = new Map<string, PDFFont>();
  const standardFontKeys = new Set<string>();
  for (const field of input.fields) {
    const name = field.font || "Helvetica";
    if (embeddedFonts.has(name)) continue;
    const filename = FONT_FILES[name];
    if (filename) {
      const bytes = await getFontBytes(filename);
      if (bytes) {
        embeddedFonts.set(name, await pdfDoc.embedFont(bytes));
        continue;
      }
    }
    embeddedFonts.set(name, await pdfDoc.embedFont(StandardFonts.Helvetica));
    standardFontKeys.add(name);
  }

  const page = pdfDoc.addPage([W_pt, H_pt]);

  for (const field of input.fields) {
    const text = resolveContent(
      field.content ?? "",
      input.recipientData,
      input.sender,
    ).trim();
    if (!text) continue;

    const font = embeddedFonts.get(field.font || "Helvetica");
    if (!font) continue;
    const fontSizePt = field.fontSize || 22;
    const lineHtPt = fontSizePt * (field.lineHeight || 1.3);
    const color = hexToRgb(field.color);
    const xPt = (field.x / 100) * W_pt;
    const maxWidthPt = (field.width / 100) * W_pt;
    const yTopPt = (field.y / 100) * H_pt;

    const safeText = standardFontKeys.has(field.font || "Helvetica")
      ? sanitizeWinAnsi(text)
      : text;
    const lines = wrapText(font, safeText, fontSizePt, maxWidthPt);
    for (let li = 0; li < lines.length; li += 1) {
      const yPt = H_pt - yTopPt - fontSizePt - li * lineHtPt;
      if (yPt < 0) break;
      page.drawText(lines[li], { x: xPt, y: yPt, size: fontSizePt, font, color });
    }
  }

  return Buffer.from(await pdfDoc.save());
}

/**
 * Default-Field-Set fuer ein neues DIN-LANG-Template. UI kann das als Ausgangspunkt
 * anbieten damit User nicht mit leerer Canvas startet.
 */
export function getDefaultFieldsForFormat(
  format: keyof typeof SIZES,
): EnvelopeField[] {
  // DIN LANG (220x110mm) — Standard-Layout:
  // - Absender oben links, klein
  // - Empfaenger mittig-rechts, groesser
  const nowId = () =>
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `f-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return [
    {
      id: nowId(),
      label: "Absender-Zeile",
      content:
        "{{__sender.name}} · {{__sender.street}} · {{__sender.zip}} {{__sender.city}}",
      x: 5,
      y: 5,
      width: 60,
      fontSize: 8,
      lineHeight: 1.2,
      font: "Helvetica",
      color: "#374151",
    },
    {
      id: nowId(),
      label: "Empfänger",
      content: "{{firstName}} {{lastName}}\n{{street}}\n{{zip}} {{city}}",
      x: 38,
      y: 45,
      width: 55,
      fontSize: 13,
      lineHeight: 1.35,
      font: format === "DIN_LANG" ? "BiroScript" : "Helvetica",
      color: "#000000",
    },
  ];
}
