/**
 * Renderer 3.0 — HTML-from-Drive + Chromium-Print.
 *
 * Warum das funktioniert wo LibreOffice und Drive-Copy scheitern:
 *   - LibreOffice rendert Google-Docs-Floating-Layouts falsch (Bilder
 *     unsichtbar / verschoben).
 *   - Drive-Copy (Service Account) scheitert an SA-Storage-Quota=0.
 *   - Drive-Export ist read-only → kein Quota-Verbrauch.
 *   - Google's HTML-Export bewahrt allen Content + Layout-Klassen,
 *     Chromium rendert das Markup zuverlässig.
 *
 * Pipeline:
 *   1. Service-Account: `drive.files.export(application/zip)` → ZIP mit
 *      HTML + Images-Ordner. KEINE Schreibrechte am Original nötig
 *      (User sharing-Mode "Anyone-with-link can view" reicht).
 *   2. ZIP entpacken in tmp-Dir.
 *   3. Placeholder-Substitution direkt im HTML-Text (`{{key}}` →
 *      `vars[key]`). Unbekannte Tokens → Leerstring.
 *   4. Marker-Bild-Swap im `images/`-Ordner: Pixel-Dimension matchen
 *      (QR=400×400, Thumb=640×360 — identisch zur Legacy-DOCX-Pipeline).
 *      Datei wird in-place ueberschrieben — Chromium laedt die neuen
 *      Bytes beim `page.goto`.
 *   5. Puppeteer: `page.goto(file://...html)` → `page.pdf(A4)`.
 *   6. Tmp-Cleanup.
 *
 * Vorteile vs. LibreOffice-Pfad:
 *   - Selfie-Bild, Tan-Box-Tabellen, QR sind ALLE sichtbar (LibreOffice
 *     hat das iPhone verschluckt).
 *   - Floating-Layout-Stacking statt Overlap (geringerer Layout-Match aber
 *     funktional vollstaendig).
 *
 * Nachteile:
 *   - Floating-Overlap-Designs (Bild ueber Tan-Box) werden zu Stacked-
 *     Layout (Bild unter Tan-Box). Akzeptabel als Trade gegen
 *     LibreOffice-Bild-verschluckt.
 */

import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import AdmZip from "adm-zip";
import sharp from "sharp";
import { getDriveClient, extractDocId } from "@/lib/google-docs/sa-auth";
import { getContext } from "./browser-pool";
import { repairFloatingOverlaps } from "./html-pdf-repair";

export interface HtmlPdfPipelineInput {
  googleDocsUrl: string;
  textVars: Record<string, string>;
  /** Lokaler Pfad zum personalisierten QR-PNG (400×400). */
  qrPngPath?: string | null;
  /** Lokaler Pfad zum personalisierten Thumbnail-JPG/PNG (640×360). */
  thumbnailFilePath?: string | null;
  /** Worker-Tmp-Dir für Extract + Render-Zwischenergebnisse. */
  workDir: string;
}

export interface HtmlPdfPipelineOutput {
  pdfBuffer: Buffer;
  qrReplaced: boolean;
  thumbReplaced: boolean;
  textReplacements: number;
}

const QR_MARKER = { width: 400, height: 400, tolerance: 4 };
const THUMB_MARKER = { width: 640, height: 360, tolerance: 4 };

function matchesDim(
  dim: { width: number; height: number },
  target: { width: number; height: number; tolerance: number },
): boolean {
  return (
    Math.abs(dim.width - target.width) <= target.tolerance &&
    Math.abs(dim.height - target.height) <= target.tolerance
  );
}

function substituteHtml(
  html: string,
  vars: Record<string, string>,
): { html: string; replaced: number } {
  let replaced = 0;
  // Bekannte Keys ersetzen.
  for (const [k, v] of Object.entries(vars)) {
    const re = new RegExp(`\\{\\{\\s*${escapeRegex(k)}\\s*\\}\\}`, "g");
    html = html.replace(re, () => {
      replaced += 1;
      return escapeHtml(v ?? "");
    });
  }
  // Unbekannte Placeholder weg-leeren — niemals raw `{{key}}` im PDF.
  html = html.replace(/\{\{\s*[\w.-]+\s*\}\}/g, () => {
    replaced += 1;
    return "";
  });
  return { html, replaced };
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export async function renderViaHtml(
  input: HtmlPdfPipelineInput,
): Promise<HtmlPdfPipelineOutput> {
  const templateId = extractDocId(input.googleDocsUrl);
  if (!templateId) throw new Error(`Invalid Google Doc URL: ${input.googleDocsUrl}`);

  const drive = getDriveClient();

  // 1. ZIP-Export laden
  const zipRes = await drive.files.export(
    { fileId: templateId, mimeType: "application/zip" },
    { responseType: "arraybuffer" },
  );
  const zipBuf = Buffer.from(zipRes.data as ArrayBuffer);

  // 2. Extract in eindeutiges tmp-Dir
  const tmpRoot = join(input.workDir, `html-${randomUUID()}`);
  await mkdir(tmpRoot, { recursive: true });
  const zip = new AdmZip(zipBuf);
  zip.extractAllTo(tmpRoot, true);

  try {
    // 3. HTML-Datei finden
    const files = await readdir(tmpRoot);
    const htmlFile = files.find((f) => f.toLowerCase().endsWith(".html"));
    if (!htmlFile) throw new Error("No .html in Drive zip export");
    const htmlPath = join(tmpRoot, htmlFile);

    let html = await readFile(htmlPath, "utf-8");
    const { html: subHtml, replaced } = substituteHtml(html, input.textVars);
    html = subHtml;

    // Renderer-3.5-Repair: Google's HTML-Export flacht Floating-Overlaps
    // aus (Bild landet in eigenem <p> vor der Container-Box, Box-Zelle
    // bleibt leer). Wir setzen das strukturell wieder zusammen bevor
    // Chromium rendert.
    const { html: repairedHtml, report: repairReport } = repairFloatingOverlaps(html);
    html = repairedHtml;

    await writeFile(htmlPath, html);

    // 4. Marker-Image-Swap im images/ Ordner
    let qrReplaced = false;
    let thumbReplaced = false;
    const imagesDir = join(tmpRoot, "images");
    try {
      const imgFiles = await readdir(imagesDir);
      for (const f of imgFiles) {
        const p = join(imagesDir, f);
        let meta: sharp.Metadata;
        try {
          meta = await sharp(p).metadata();
        } catch {
          continue;
        }
        const dim = { width: meta.width ?? 0, height: meta.height ?? 0 };
        if (
          !qrReplaced &&
          input.qrPngPath &&
          matchesDim(dim, QR_MARKER)
        ) {
          const bytes = await readFile(input.qrPngPath);
          await writeFile(p, bytes);
          qrReplaced = true;
        } else if (
          !thumbReplaced &&
          input.thumbnailFilePath &&
          matchesDim(dim, THUMB_MARKER)
        ) {
          const bytes = await readFile(input.thumbnailFilePath);
          await writeFile(p, bytes);
          thumbReplaced = true;
        }
      }
    } catch {
      // Kein images/ Ordner → ok, manche Templates haben keine Bilder.
    }

    // 5. Chromium → PDF
    const ctx = await getContext();
    const page = await ctx.context.newPage();
    try {
      // Google Docs HTML-Export ist auf US-Letter ausgelegt (8.5"x11").
      // Wir setzen genau das + keine zusaetzlichen Margins (das HTML hat
      // bereits eigene padding-Werte). Viewport breit genug damit Floats
      // nicht falsch umbrechen.
      await page.setViewport({ width: 1600, height: 1200, deviceScaleFactor: 1 });
      await page.goto(pathToFileURL(htmlPath).toString(), {
        waitUntil: "networkidle0",
        timeout: 30_000,
      });
      const pdf = (await page.pdf({
        format: "Letter",
        printBackground: true,
        margin: { top: "0", bottom: "0", left: "0", right: "0" },
        preferCSSPageSize: true,
      })) as Buffer;

      return {
        pdfBuffer: pdf,
        qrReplaced,
        thumbReplaced,
        textReplacements: replaced,
      };
    } finally {
      await page.close().catch(() => undefined);
    }
  } finally {
    await rm(tmpRoot, { recursive: true, force: true }).catch(() => undefined);
  }
}
