/**
 * PDF-Overlay-Stamping für den QR-Code (Renderer 4.1).
 *
 * Löst das Floating-QR-Clamping-Problem (Incident 2026-07-15, Rollback
 * 2026-08-06): Googles PDF-Renderer clampt positioned objects an ihrer
 * festen Seitenposition — wächst der Brieftext durch lange Personalisierungs-
 * werte, rutscht die Link-Zeile in die QR-Box. Die Docs-API kann positioned
 * objects weder verschieben noch resizen, und die Inline-Konvertierung
 * (64fbc19) fraß ~60pt Textfluss → Seiten-Overflow.
 *
 * Ansatz hier: der QR-Platzhalter im Doc wird durch ein TRANSPARENTES Bild
 * ersetzt (Layout bleibt exakt wie Google rendert, nie Overflow). Nach dem
 * PDF-Export wird der echte QR per pdf-lib gestempelt:
 *   - X/Y-Ausgangsposition = die Box des transparenten Markers im PDF
 *     (via `pdftohtml -xml`, poppler-utils sind im Worker-Image).
 *   - Kollidiert die Link-Zeile (via `pdftotext -bbox`) mit der Box, wird
 *     der QR UNTER die Link-Zeile geschoben — er folgt dem Text, statt dass
 *     der Text in ihn hineinläuft.
 *   - Unterkante wird an den Seitenrand geclampt (notfalls proportional
 *     verkleinert), damit nichts aus der Seite läuft.
 *
 * Im Normalfall (kurze Namen) ist das Ergebnis positionsidentisch mit dem
 * bisherigen replaceImage-Verhalten.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PDFDocument } from "pdf-lib";
import { gsPath } from "./ghostscript";

const execFileAsync = promisify(execFile);

/**
 * Normalisiert das PDF via Ghostscript (pdfwrite, ohne Downsampling) für
 * die GEOMETRIE-Extraktion. Googles PDF-Export packt Bilder in Form-
 * XObjects, in die `pdftohtml -xml` nicht hineinschaut — die Marker-Box
 * des transparenten Platzhalters war dadurch praktisch nie auffindbar
 * (Logs: marker=false) und der QR landete nur näherungsweise über den
 * Anker-Fallback (~9pt daneben, Reklamation 2026-08-16). Ghostscript
 * flacht die Forms ab, die Seitengeometrie bleibt identisch. Fehler →
 * Extraktion läuft wie bisher auf dem Original (Best-Effort).
 * Gestempelt wird IMMER in den Original-Buffer, nie in die Normalisierung.
 */
async function normalizeForGeometry(
  pdfPath: string,
  workDir: string,
): Promise<string> {
  const outPath = join(workDir, "norm.pdf");
  try {
    await execFileAsync(gsPath(), [
      "-sDEVICE=pdfwrite",
      "-dNOPAUSE",
      "-dQUIET",
      "-dBATCH",
      `-sOutputFile=${outPath}`,
      pdfPath,
    ]);
    return outPath;
  } catch (err) {
    console.warn(
      `[qr-overlay] gs-normalize failed, extracting from raw export: ${err instanceof Error ? err.message : "?"}`,
    );
    return pdfPath;
  }
}

/** Abstand zwischen Link-Unterkante und QR-Oberkante beim Verschieben (pt). */
const DEFAULT_GAP_PT = 6;
/** Mindestabstand der QR-Unterkante zum Seitenende (pt). */
const PAGE_BOTTOM_MARGIN_PT = 12;
/** Kleinster zulässiger Skalierungsfaktor beim Platz-Clamping. */
const MIN_SCALE = 0.5;
/** Toleranz beim Matchen der Marker-Box gegen die Platzhalter-Größe. */
const MARKER_SIZE_TOLERANCE = 0.12;

export interface QrOverlayInput {
  pdfBuffer: Buffer;
  qrPng: Buffer;
  /** Platzhalter-Größe aus dem Google Doc (pt). */
  qrWidthPt: number;
  qrHeightPt: number;
  /** Eindeutiger Teil der Link-Zeile, z. B. der Lead-Slug. */
  anchorText: string;
  /**
   * Weitere Suchbegriffe, falls `anchorText` im PDF nicht gefunden wird —
   * z. B. der Hostname, wenn die URL im PDF mitten im Slug umbricht.
   */
  anchorFallbacks?: string[];
  /**
   * Fallback-X (pt vom linken Seitenrand), falls die Marker-Box im PDF
   * nicht auffindbar ist. null → horizontal unter dem Anker zentrieren.
   */
  fallbackXPt: number | null;
  gapPt?: number;
}

export interface QrOverlayResult {
  pdfBuffer: Buffer;
  pageIndex: number;
  xPt: number;
  /** Oberkante des QR, gemessen von der Seiten-OBERKANTE (pt). */
  yTopPt: number;
  widthPt: number;
  heightPt: number;
  markerFound: boolean;
  anchorFound: boolean;
  /** Wie weit der QR gegenüber der Marker-Position nach unten wanderte. */
  shiftedDownPt: number;
}

export interface Box {
  pageIndex: number;
  xMin: number;
  yMin: number;
  xMax: number;
  yMax: number;
}

export interface PageWords {
  widthPt: number;
  heightPt: number;
  words: Array<{ xMin: number; yMin: number; xMax: number; yMax: number; text: string }>;
}

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

/** `pdftotext -bbox` → Wort-Boxen pro Seite, Koordinaten in pt, Origin oben links. */
async function extractWords(pdfPath: string, workDir: string): Promise<PageWords[]> {
  const outPath = join(workDir, "words.html");
  await execFileAsync("pdftotext", ["-bbox", pdfPath, outPath]);
  const xml = await readFile(outPath, "utf8");
  const pages: PageWords[] = [];
  const pageRe = /<page width="([\d.]+)" height="([\d.]+)">([\s\S]*?)<\/page>/g;
  const wordRe =
    /<word xMin="([\d.-]+)" yMin="([\d.-]+)" xMax="([\d.-]+)" yMax="([\d.-]+)">([\s\S]*?)<\/word>/g;
  for (let pm = pageRe.exec(xml); pm; pm = pageRe.exec(xml)) {
    const page: PageWords = {
      widthPt: Number(pm[1]),
      heightPt: Number(pm[2]),
      words: [],
    };
    for (let wm = wordRe.exec(pm[3]); wm; wm = wordRe.exec(pm[3])) {
      page.words.push({
        xMin: Number(wm[1]),
        yMin: Number(wm[2]),
        xMax: Number(wm[3]),
        yMax: Number(wm[4]),
        text: decodeXmlEntities(wm[5]),
      });
    }
    pages.push(page);
  }
  return pages;
}

/**
 * `pdftohtml -xml` → Bild-Boxen pro Seite. pdftohtml rechnet in Pixeln bei
 * eigenem Zoom — wir normalisieren über das Verhältnis der Seitenbreite in
 * pt (aus pdftotext) zur Seitenbreite in px (aus pdftohtml).
 */
async function extractImages(
  pdfPath: string,
  workDir: string,
  pageSizes: Array<{ widthPt: number; heightPt: number }>,
): Promise<Box[]> {
  const outBase = join(workDir, "layout");
  // -q: still, -i wuerde <image>-Tags unterdruecken — also ohne. Die
  // extrahierten Bilddateien landen im Tempdir und werden mit aufgeräumt.
  await execFileAsync("pdftohtml", ["-q", "-xml", pdfPath, outBase]);
  const xml = await readFile(`${outBase}.xml`, "utf8");
  const boxes: Box[] = [];
  const pageRe =
    /<page number="(\d+)"[^>]*width="([\d.]+)"[^>]*height="([\d.]+)"[^>]*>([\s\S]*?)<\/page>/g;
  const imgRe =
    /<image[^>]*top="([\d.-]+)"[^>]*left="([\d.-]+)"[^>]*width="([\d.-]+)"[^>]*height="([\d.-]+)"[^>]*\/?>/g;
  for (let pm = pageRe.exec(xml); pm; pm = pageRe.exec(xml)) {
    const pageIndex = Number(pm[1]) - 1;
    const pagePxW = Number(pm[2]);
    const sizePt = pageSizes[pageIndex];
    if (!sizePt || !pagePxW) continue;
    const scale = sizePt.widthPt / pagePxW;
    for (let im = imgRe.exec(pm[4]); im; im = imgRe.exec(pm[4])) {
      const top = Number(im[1]) * scale;
      const left = Number(im[2]) * scale;
      const w = Number(im[3]) * scale;
      const h = Number(im[4]) * scale;
      boxes.push({ pageIndex, xMin: left, yMin: top, xMax: left + w, yMax: top + h });
    }
  }
  return boxes;
}

/**
 * Findet Anker-Boxen für den ersten Suchbegriff, der Treffer liefert.
 * Reihenfolge: anchorText, dann anchorFallbacks (z. B. Hostname, falls die
 * URL im PDF mitten im Slug umbricht und der Slug so unauffindbar wird).
 */
export function findAnchorBoxesWithFallbacks(
  pages: PageWords[],
  needles: string[],
): Box[] {
  for (const needle of needles) {
    if (!needle) continue;
    const hits = findAnchorBoxes(pages, needle);
    if (hits.length > 0) return hits;
  }
  return [];
}

/** Findet Anker-Boxen: Wörter, die `anchorText` enthalten (case-insensitiv). */
function findAnchorBoxes(pages: PageWords[], anchorText: string): Box[] {
  const needle = anchorText.toLowerCase();
  const hits: Box[] = [];
  pages.forEach((page, pageIndex) => {
    for (const w of page.words) {
      if (w.text.toLowerCase().includes(needle)) {
        hits.push({ pageIndex, xMin: w.xMin, yMin: w.yMin, xMax: w.xMax, yMax: w.yMax });
      }
    }
  });
  if (hits.length > 0) return hits;

  // Fallback: Wörter zeilenweise gruppieren (yMin-Toleranz 2pt) und die
  // konkatenierte Zeile matchen — falls der Link im PDF in mehrere
  // Text-Runs zerfallen ist.
  pages.forEach((page, pageIndex) => {
    const lines = new Map<number, typeof page.words>();
    for (const w of page.words) {
      const key = Math.round(w.yMin / 2);
      const arr = lines.get(key);
      if (arr) arr.push(w);
      else lines.set(key, [w]);
    }
    for (const words of Array.from(lines.values())) {
      const sorted = [...words].sort((a, b) => a.xMin - b.xMin);
      const text = sorted.map((w) => w.text).join("").toLowerCase();
      if (!text.includes(needle)) continue;
      hits.push({
        pageIndex,
        xMin: Math.min(...sorted.map((w) => w.xMin)),
        yMin: Math.min(...sorted.map((w) => w.yMin)),
        xMax: Math.max(...sorted.map((w) => w.xMax)),
        yMax: Math.max(...sorted.map((w) => w.yMax)),
      });
    }
  });
  return hits;
}

export interface PlacementInput {
  page: PageWords;
  marker: Box | null;
  /** Anker auf derselben Seite wie der Marker (bzw. die Zielseite). */
  anchor: Box | null;
  qrWidthPt: number;
  qrHeightPt: number;
  fallbackXPt: number | null;
  gapPt: number;
}

export interface Placement {
  x: number;
  yTop: number;
  w: number;
  h: number;
  shiftedDownPt: number;
}

/** Mindest-Überschneidungstiefe (pt), ab der ein Wort als Kollision zählt —
 *  puffert Koordinaten-Differenzen zwischen pdftotext und pdftohtml ab. */
const COLLISION_MIN_OVERLAP_PT = 1.5;
/** Max. Iterationen der Kollisionsauflösung (jede schiebt unter die
 *  tiefste kollidierende Wortbox). */
const COLLISION_MAX_PASSES = 8;

/**
 * Reine Platzierungslogik (testbar ohne poppler/pdf-lib).
 *
 * Ausgangsposition = Marker-Box (exakte Vorlagen-Position), sonst unter der
 * Anker-Zeile. Danach Kollisionsauflösung gegen ALLE Wortboxen der Seite:
 * echte Rechteck-Überschneidung (nicht nur eine Kante) — so bleibt eine
 * Caption, die planmäßig unter dem QR steht, unangetastet, während eine
 * hineingerutschte Link-Zeile (auch eine umgebrochene zweite URL-Zeile)
 * den QR nach unten schiebt. Verschoben wird immer nach unten: Briefe
 * füllen sich von oben, freier Raum liegt unten.
 */
export function computeQrPlacement(input: PlacementInput): Placement {
  const { page, marker, anchor, gapPt: gap } = input;
  let x =
    marker?.xMin ??
    input.fallbackXPt ??
    (anchor ? (anchor.xMin + anchor.xMax) / 2 - input.qrWidthPt / 2 : 0);
  let yTop = marker ? marker.yMin : anchor!.yMax + gap;

  let shiftedDownPt = 0;
  for (let pass = 0; pass < COLLISION_MAX_PASSES; pass++) {
    const colliding = page.words.filter((wd) => {
      const overlapX =
        Math.min(wd.xMax, x + input.qrWidthPt) - Math.max(wd.xMin, x);
      const overlapY =
        Math.min(wd.yMax, yTop + input.qrHeightPt) - Math.max(wd.yMin, yTop);
      return (
        overlapX > COLLISION_MIN_OVERLAP_PT && overlapY > COLLISION_MIN_OVERLAP_PT
      );
    });
    if (colliding.length === 0) break;
    const target = Math.max(...colliding.map((wd) => wd.yMax)) + gap;
    if (target <= yTop) break;
    shiftedDownPt += target - yTop;
    yTop = target;
  }

  // Clamping: unten aus der Seite darf nichts rauslaufen. Erst
  // verkleinern (bis MIN_SCALE), dann notfalls Position anheben.
  let w = input.qrWidthPt;
  let h = input.qrHeightPt;
  const available = page.heightPt - PAGE_BOTTOM_MARGIN_PT - yTop;
  if (available < h) {
    const scale = Math.max(available / h, MIN_SCALE);
    w *= scale;
    h *= scale;
    if (yTop + h > page.heightPt - PAGE_BOTTOM_MARGIN_PT) {
      yTop = page.heightPt - PAGE_BOTTOM_MARGIN_PT - h;
    }
  }
  x = Math.min(Math.max(x, PAGE_BOTTOM_MARGIN_PT), page.widthPt - PAGE_BOTTOM_MARGIN_PT - w);

  return { x, yTop, w, h, shiftedDownPt };
}

export async function stampQrOverlay(input: QrOverlayInput): Promise<QrOverlayResult> {
  const workDir = await mkdtemp(join(tmpdir(), "qr-overlay-"));
  try {
    const pdfPath = join(workDir, "in.pdf");
    await writeFile(pdfPath, input.pdfBuffer);
    const geomPath = await normalizeForGeometry(pdfPath, workDir);

    const pages = await extractWords(geomPath, workDir);
    if (pages.length === 0) {
      throw new Error("qr-overlay: pdftotext lieferte keine Seiten");
    }
    const images = await extractImages(
      geomPath,
      workDir,
      pages.map((p) => ({ widthPt: p.widthPt, heightPt: p.heightPt })),
    );

    // Marker: Bild, dessen Box der Platzhalter-Größe entspricht.
    const marker =
      images.find(
        (b) =>
          Math.abs(b.xMax - b.xMin - input.qrWidthPt) <=
            input.qrWidthPt * MARKER_SIZE_TOLERANCE &&
          Math.abs(b.yMax - b.yMin - input.qrHeightPt) <=
            input.qrHeightPt * MARKER_SIZE_TOLERANCE,
      ) ?? null;

    const anchors = findAnchorBoxesWithFallbacks(pages, [
      input.anchorText,
      ...(input.anchorFallbacks ?? []),
    ]);
    // Bei mehreren Anker-Treffern: der dem Marker nächstgelegene (gleiche
    // Seite), sonst der letzte im Dokument.
    let anchor: Box | null = null;
    if (anchors.length > 0) {
      if (marker) {
        const samePage = anchors.filter((a) => a.pageIndex === marker.pageIndex);
        anchor =
          samePage.sort(
            (a, b) => Math.abs(a.yMin - marker.yMin) - Math.abs(b.yMin - marker.yMin),
          )[0] ?? anchors[anchors.length - 1];
      } else {
        anchor = anchors[anchors.length - 1];
      }
    }

    if (!marker && !anchor) {
      throw new Error(
        `qr-overlay: weder Marker-Box noch Anker-Text "${input.anchorText}" im PDF gefunden`,
      );
    }

    const gap = input.gapPt ?? DEFAULT_GAP_PT;
    const pageIndex = (marker ?? anchor!).pageIndex;
    const page = pages[pageIndex];

    const { x, yTop, w, h, shiftedDownPt } = computeQrPlacement({
      page,
      marker,
      anchor: anchor && anchor.pageIndex === pageIndex ? anchor : null,
      qrWidthPt: input.qrWidthPt,
      qrHeightPt: input.qrHeightPt,
      fallbackXPt: input.fallbackXPt,
      gapPt: gap,
    });

    // Stempeln (pdf-lib rechnet von der Seiten-UNTERKANTE).
    const pdf = await PDFDocument.load(input.pdfBuffer, { ignoreEncryption: true });
    const pdfPage = pdf.getPage(pageIndex);
    const embedded = await pdf.embedPng(input.qrPng);
    pdfPage.drawImage(embedded, {
      x,
      y: pdfPage.getHeight() - yTop - h,
      width: w,
      height: h,
    });
    const outBytes = await pdf.save();

    return {
      pdfBuffer: Buffer.from(outBytes),
      pageIndex,
      xPt: x,
      yTopPt: yTop,
      widthPt: w,
      heightPt: h,
      markerFound: Boolean(marker),
      anchorFound: Boolean(anchor),
      shiftedDownPt,
    };
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}
