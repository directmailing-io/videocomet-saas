/**
 * Alternativer Umschlag-Renderer via Puppeteer/Chromium.
 *
 * Wird verwendet wenn irgendein Feld eine Font nutzt die pdf-lib nicht
 * korrekt rendern kann (z. B. LiebeHeide-Fineliner-OTF, LiebeHeide-Color).
 * Rendert HTML+CSS mit embedded Base64-Fonts und exportiert als PDF —
 * teurer (1-3s pro Aufruf) als pdf-lib, dafuer glyph-treu.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import puppeteer, { type Browser } from "puppeteer-core";
import type { EnvelopeField, EnvelopeSender } from "@/lib/db/schema";

const PT_PER_MM = 72 / 25.4;

const SIZES: Record<string, { width: number; height: number }> = {
  DIN_LANG: { width: 220, height: 110 },
  C4: { width: 324, height: 229 },
  C5: { width: 229, height: 162 },
  C6: { width: 162, height: 114 },
};

// Fonts, die wir per Puppeteer/HTML rendern (weil pdf-lib fehlerhaft).
const HTML_FONTS: Record<
  string,
  { filename: string; family: string; format: string }
> = {
  LiebeHeideFineliner: {
    filename: "LiebeHeideVector-FinelinerRegular.otf",
    family: "LiebeHeideFineliner",
    format: "opentype",
  },
  LiebeHeide: {
    filename: "LiebeHeide-Color.otf",
    family: "LiebeHeide",
    format: "opentype",
  },
};

// Font-Bytes-Cache: laden 1x je Modul-Lifetime.
const fontDataUrlCache = new Map<string, string>();

async function loadFontBase64(filename: string): Promise<string | null> {
  if (fontDataUrlCache.has(filename)) return fontDataUrlCache.get(filename)!;
  const candidates = [
    join(process.cwd(), "src/worker/fonts", filename),
    join(process.cwd(), "public/fonts", filename),
  ];
  for (const p of candidates) {
    try {
      const bytes = await readFile(p);
      const b64 = bytes.toString("base64");
      const dataUrl = `data:font/otf;base64,${b64}`;
      fontDataUrlCache.set(filename, dataUrl);
      return dataUrl;
    } catch {
      // try next
    }
  }
  return null;
}

/**
 * True, wenn mindestens ein Feld einen Font braucht der nur via
 * Puppeteer sauber rendert. Der Caller nutzt das um zwischen pdf-lib
 * und diesem Renderer zu dispatchen.
 */
export function requiresHtmlRenderer(fields: EnvelopeField[]): boolean {
  for (const f of fields) {
    if (f.font in HTML_FONTS) return true;
  }
  return false;
}

function resolveContent(
  content: string,
  data: Record<string, unknown>,
  sender: EnvelopeSender,
): string {
  if (!content) return "";
  return content.replace(/\{\{([^}]+)\}\}/g, (_, keyRaw: string) => {
    const key = keyRaw.trim();
    if (key.startsWith("__sender.")) {
      const field = key.slice("__sender.".length) as keyof EnvelopeSender;
      return String(sender[field] ?? "");
    }
    const direct = data[key];
    if (direct != null && String(direct).trim() !== "") return String(direct);
    const lowerKey = key.toLowerCase();
    for (const [k, v] of Object.entries(data)) {
      if (k.toLowerCase() === lowerKey && v != null && String(v).trim() !== "") {
        return String(v);
      }
    }
    return "";
  });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Font-CSS-Familie zu einem field.font-Wert.
function cssFontFamilyFor(fontName: string): string {
  if (fontName in HTML_FONTS) {
    return `'${HTML_FONTS[fontName].family}', 'Arial', sans-serif`;
  }
  if (fontName === "BiroScript")
    return `'BiroScript', 'Arial', sans-serif`;
  return "'Arial', 'Helvetica Neue', Helvetica, sans-serif";
}

async function buildFontFaceCss(): Promise<string> {
  const declarations: string[] = [];
  for (const [, { filename, family, format }] of Object.entries(HTML_FONTS)) {
    const dataUrl = await loadFontBase64(filename);
    if (!dataUrl) continue;
    declarations.push(
      `@font-face { font-family: '${family}'; src: url(${dataUrl}) format('${format}'); font-display: block; }`,
    );
  }
  // Auch BiroScript einbetten damit gemischte Templates konsistent aussehen.
  const biro = await loadFontBase64("biro_script_plus.ttf");
  if (biro) {
    declarations.push(
      `@font-face { font-family: 'BiroScript'; src: url(${biro.replace("data:font/otf", "data:font/ttf")}) format('truetype'); font-display: block; }`,
    );
  }
  return declarations.join("\n");
}

export interface HtmlEnvelopeInput {
  format: keyof typeof SIZES;
  fields: EnvelopeField[];
  sender: EnvelopeSender;
  recipientData: Record<string, unknown>;
}

async function buildHtml(input: HtmlEnvelopeInput): Promise<string> {
  const { width: W_mm, height: H_mm } = SIZES[input.format] ?? SIZES.DIN_LANG;
  const fontCss = await buildFontFaceCss();
  const fieldBlocks = input.fields
    .map((f) => {
      const text = resolveContent(
        f.content ?? "",
        input.recipientData,
        input.sender,
      );
      if (!text) return "";
      const align = f.align ?? "left";
      const leftPct = f.x;
      const topPct = f.y;
      const widthPct = f.width;
      const family = cssFontFamilyFor(f.font);
      const color = f.color || "#000000";
      const size = f.fontSize || 13;
      const lh = f.lineHeight || 1.3;
      const html = escapeHtml(text).replace(/\n/g, "<br/>");
      return `<div class="field" style="left:${leftPct}%;top:${topPct}%;width:${widthPct}%;font-family:${family};color:${color};font-size:${size}pt;line-height:${lh};text-align:${align};">${html}</div>`;
    })
    .join("");
  return `<!doctype html><html><head><meta charset="utf-8"><style>
      ${fontCss}
      html, body { margin: 0; padding: 0; }
      body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      .envelope {
        position: relative;
        width: ${W_mm}mm;
        height: ${H_mm}mm;
        background: #ffffff;
        overflow: hidden;
        box-sizing: border-box;
      }
      .field {
        position: absolute;
        white-space: pre-wrap;
        overflow-wrap: break-word;
        word-break: normal;
        box-sizing: border-box;
      }
    </style></head><body><div class="envelope">${fieldBlocks}</div></body></html>`;
}

// Lightweight browser-lazy fuer diese Datei — kein pool sharing mit anderen
// Puppeteer-Callern (screenshot/browser-pool). Bei erst-Nutzung wird
// Chromium gestartet und bis Prozess-Ende offengehalten.
let browserPromise: Promise<Browser> | null = null;
function chromiumPath(): string {
  return process.env.CHROMIUM_PATH ?? "/usr/bin/chromium";
}
async function getBrowser(): Promise<Browser> {
  if (browserPromise) {
    try {
      const b = await browserPromise;
      if (b.connected) return b;
    } catch {
      // relaunch below
    }
  }
  browserPromise = puppeteer.launch({
    executablePath: chromiumPath(),
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--disable-extensions",
      "--hide-scrollbars",
    ],
  });
  const browser = await browserPromise;
  browser.on("disconnected", () => {
    browserPromise = null;
  });
  return browser;
}

export async function generateEnvelopePdfViaHtml(
  input: HtmlEnvelopeInput,
): Promise<Buffer> {
  const { width: W_mm, height: H_mm } = SIZES[input.format] ?? SIZES.DIN_LANG;
  const html = await buildHtml(input);
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setContent(html, { waitUntil: "networkidle0" });
    // Sicherstellen dass die Fonts geladen sind bevor gedruckt wird.
    await page.evaluateHandle("document.fonts.ready");
    const pdf = await page.pdf({
      width: `${W_mm}mm`,
      height: `${H_mm}mm`,
      printBackground: true,
      margin: { top: 0, right: 0, bottom: 0, left: 0 },
      preferCSSPageSize: false,
    });
    return Buffer.from(pdf);
  } finally {
    await page.close().catch(() => {});
  }
}

// Hilfs-Export fuer Callers die den PT_PER_MM-Wert brauchen.
export { PT_PER_MM };
