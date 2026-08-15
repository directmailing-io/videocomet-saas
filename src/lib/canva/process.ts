/**
 * Canva (PPTX-Upload)-Processing-Library.
 *
 * Spiegelt `gslides/import.ts` für vom User hochgeladene PPTX-Dateien:
 *
 *   - PPTX vom Bunny-CDN downloaden (mediaItems.publicUrl)
 *   - Folien-XML parsen → Placeholder pro Folie extrahieren
 *   - LibreOffice → PDF → PNG-Sequenz (Thumbnails)
 *   - PNGs nach Bunny hochladen
 *
 * Wirft bei kompletten Ausfällen (Download / kein PPTX) — Caller
 * (API-Route) übersetzt das in HTTP-Codes. Pro-Folie-Fehler landen mit
 * `thumbnailUrl: null` im Ergebnis.
 */

import { createHash } from "node:crypto";
import { mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { uploadFile } from "@/lib/bunny/storage";
import { extractSlidesFromPptx } from "@/lib/gslides/pptx-zip";
import { collectPlaceholdersFromXml } from "@/lib/gslides/pptx-placeholders";
import { renderPptxToPngs } from "@/lib/gslides/pptx-render";

const MAX_PPTX_BYTES = 100 * 1024 * 1024; // 100 MB
const DEFAULT_TIMEOUT_MS = 60_000;
const HARD_TIMEOUT_MS = 180_000;
const PER_RENDER_TIMEOUT_MS = 90_000;

/** Eine Folie im Processing-Ergebnis. */
export interface ProcessedCanvaSlide {
  /** 0-basierter Index. */
  slideIndex: number;
  /** Bunny-CDN-URL des PNG-Thumbnails. null = Generation gescheitert. */
  thumbnailUrl: string | null;
  /** Sortierte, deduplizierte Liste der {{key}}-Treffer auf dieser Folie. */
  detectedPlaceholders: string[];
}

export interface ProcessPptxResult {
  slideCount: number;
  slides: ProcessedCanvaSlide[];
}

/** Modul-eigener Error mit Klassifizierung für API-Routen. */
export class CanvaProcessError extends Error {
  readonly code:
    | "not-found"
    | "not-pptx"
    | "too-large"
    | "fetch-failed"
    | "render-failed"
    | "upload-failed";
  constructor(code: CanvaProcessError["code"], message: string) {
    super(message);
    this.code = code;
    this.name = "CanvaProcessError";
  }
}

/**
 * Lädt die PPTX vom Bunny-CDN und validiert per ZIP-Magic-Number.
 *
 * Wirft `CanvaProcessError` mit klarem Code; Caller mappt das in HTTP.
 */
export async function fetchPptxBuffer(publicUrl: string): Promise<Buffer> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(publicUrl, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
    });
  } catch (err) {
    throw new CanvaProcessError(
      "fetch-failed",
      `PPTX-Download fehlgeschlagen: ${(err as Error).message}`,
    );
  } finally {
    clearTimeout(timer);
  }

  if (response.status === 404) {
    throw new CanvaProcessError(
      "not-found",
      "PPTX nicht auf Bunny-CDN gefunden (HTTP 404).",
    );
  }
  if (!response.ok) {
    throw new CanvaProcessError(
      "fetch-failed",
      `PPTX-Download HTTP ${response.status}.`,
    );
  }

  const arrayBuf = await response.arrayBuffer();
  if (arrayBuf.byteLength > MAX_PPTX_BYTES) {
    throw new CanvaProcessError(
      "too-large",
      `Die Datei ist zu groß (${Math.round(arrayBuf.byteLength / 1024 / 1024)} MB, erlaubt sind ${Math.round(MAX_PPTX_BYTES / 1024 / 1024)} MB). Exportiere die Präsentation ggf. mit kleineren Bildern.`,
    );
  }
  const buf = Buffer.from(arrayBuf);
  if (buf.length < 4 || buf[0] !== 0x50 || buf[1] !== 0x4b) {
    throw new CanvaProcessError(
      "not-pptx",
      "Die Datei ist keine gültige PowerPoint-Datei (.pptx). Exportiere die Präsentation neu als .pptx und versuche es noch einmal.",
    );
  }
  return buf;
}

/**
 * Verarbeitet ein hochgeladenes PPTX:
 *  - Extrahiert pro Folie die Platzhalter-Keys.
 *  - Rendert pro Folie ein PNG-Thumbnail via LibreOffice + lädt es nach
 *    Bunny hoch.
 *
 * `pptxMediaId` ist nur Cache-Key für den Bunny-Storage-Pfad — die
 * eigentliche Ownership-Prüfung erfolgt im Caller (API-Route).
 */
export async function processPptx(
  pptxBuf: Buffer,
  pptxMediaId: string,
): Promise<ProcessPptxResult> {
  return withTimeout(
    runProcess(pptxBuf, pptxMediaId),
    HARD_TIMEOUT_MS,
    "processPptx",
  );
}

async function runProcess(
  pptxBuf: Buffer,
  pptxMediaId: string,
): Promise<ProcessPptxResult> {
  // 1) Folien + XML-Inhalte einlesen.
  const slides = await extractSlidesFromPptx(pptxBuf);
  if (slides.length === 0) {
    throw new CanvaProcessError(
      "not-pptx",
      "Die Präsentation enthält keine Folien.",
    );
  }

  // 2) Pro Folie Placeholder-Keys extrahieren.
  const slidePlaceholders = new Map<number, string[]>();
  for (const s of slides) {
    slidePlaceholders.set(s.slideIndex, collectPlaceholdersFromXml(s.xmlContent));
  }

  // 3) PPTX → PNG-Sequenz. Schlägt LibreOffice fehl → Thumbnails null,
  //    Metadaten kommen trotzdem zurück.
  const tmpRenderDir = join(tmpdir(), `canva-thumbs-${pptxMediaId}`);
  await mkdir(tmpRenderDir, { recursive: true });
  let pngPaths: string[] = [];
  try {
    const rendered = await renderPptxToPngs({
      pptxBuf,
      outputDir: tmpRenderDir,
      dpi: 150,
      timeoutMs: PER_RENDER_TIMEOUT_MS,
    });
    pngPaths = rendered.pngPaths;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(
      `[canva/process] LibreOffice-Render fehlgeschlagen, lade ohne Thumbnails: ${
        (err as Error).message
      }`,
    );
  }

  // 4) Pro Folie Thumbnail nach Bunny.
  const mediaIdHash = createHash("sha1")
    .update(pptxMediaId)
    .digest("hex")
    .slice(0, 16);

  const out: ProcessedCanvaSlide[] = [];
  for (let i = 0; i < slides.length; i += 1) {
    const detected = slidePlaceholders.get(i) ?? [];
    let thumbnailUrl: string | null = null;
    const pngPath = pngPaths[i];
    if (pngPath) {
      try {
        const buf = await readFile(pngPath);
        const result = await uploadFile({
          buffer: buf,
          remotePath: `canva/${mediaIdHash}/slide-${i}.png`,
          contentType: "image/png",
        });
        thumbnailUrl = result.url;
      } catch (uploadErr) {
        // eslint-disable-next-line no-console
        console.warn(
          `[canva/process] bunny upload failed for slide ${i}: ${
            (uploadErr as Error).message
          }`,
        );
      }
    }
    out.push({
      slideIndex: i,
      thumbnailUrl,
      detectedPlaceholders: detected,
    });
  }

  // 5) Tmp-Dir aufräumen.
  await rm(tmpRenderDir, { recursive: true, force: true }).catch(
    () => undefined,
  );

  return {
    slideCount: slides.length,
    slides: out,
  };
}

export interface RefreshCanvaSlideResult {
  thumbnailUrl: string | null;
  detectedPlaceholders: string[];
  /** ISO-8601 timestamp dieses Fetches (für `lastFetchedAt`). */
  lastFetchedAt: string;
}

/**
 * Refresht eine einzelne Folie eines hochgeladenen PPTXs. Lädt das PPTX
 * neu, rendert ALLE Folien (Single-Slide-Render gibt es bei LibreOffice
 * nicht) und picks den passenden Index.
 */
export async function refreshCanvaSlide(
  pptxBuf: Buffer,
  pptxMediaId: string,
  slideIndex: number,
): Promise<RefreshCanvaSlideResult> {
  if (!Number.isInteger(slideIndex) || slideIndex < 0) {
    throw new CanvaProcessError("not-pptx", "Ungültiger Folien-Index.");
  }
  const slides = await extractSlidesFromPptx(pptxBuf);
  if (slideIndex >= slides.length) {
    throw new CanvaProcessError(
      "not-pptx",
      `Folie ${slideIndex + 1} existiert nicht (Deck hat ${slides.length} Folien).`,
    );
  }

  const detected = collectPlaceholdersFromXml(slides[slideIndex].xmlContent);

  const tmpRenderDir = join(tmpdir(), `canva-refresh-${pptxMediaId}-${slideIndex}`);
  await mkdir(tmpRenderDir, { recursive: true });
  let thumbnailUrl: string | null = null;
  try {
    const rendered = await renderPptxToPngs({
      pptxBuf,
      outputDir: tmpRenderDir,
      dpi: 150,
      timeoutMs: PER_RENDER_TIMEOUT_MS,
    });
    const pngPath = rendered.pngPaths[slideIndex];
    if (pngPath) {
      const buf = await readFile(pngPath);
      const mediaIdHash = createHash("sha1")
        .update(pptxMediaId)
        .digest("hex")
        .slice(0, 16);
      const result = await uploadFile({
        buffer: buf,
        remotePath: `canva/${mediaIdHash}/slide-${slideIndex}.png`,
        contentType: "image/png",
      });
      thumbnailUrl = result.url;
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(
      `[canva/refresh] PPTX-Render fehlgeschlagen für Folie ${slideIndex}: ${
        (err as Error).message
      }`,
    );
  } finally {
    await rm(tmpRenderDir, { recursive: true, force: true }).catch(
      () => undefined,
    );
  }

  return {
    thumbnailUrl,
    detectedPlaceholders: detected,
    lastFetchedAt: new Date().toISOString(),
  };
}

async function withTimeout<T>(
  task: Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      task,
      new Promise<T>((_, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new CanvaProcessError(
                "render-failed",
                `[canva] ${label} timed out after ${ms}ms`,
              ),
            ),
          ms,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
