/**
 * Google-Slides „Deck"-Importer.
 *
 * Zwei Pipelines, je nach URL-Mode:
 *
 *   1. `mode: "edit"`  (NEU, bevorzugt)
 *      - PPTX-Export herunterladen (`/d/<docId>/export/pptx`)
 *      - XML parsen → Folien-Liste + Placeholder pro Folie
 *      - LibreOffice (im App-Container) rendert das PPTX als PNG-Sequenz
 *      - PNGs werden als Thumbnails nach Bunny hochgeladen
 *
 *   2. `mode: "pubembed"`  (Legacy)
 *      - Puppeteer öffnet die kanonische Pubembed-URL und screenshottet
 *        pro Folie. Substitution ist NICHT möglich — wir flagen die
 *        Folien als `placeholdersSubstitutable: false`, damit das UI eine
 *        Warnung zeigen kann.
 *
 * Result-Struktur ist EINHEITLICH (`ImportPublishedDeckResult`) für
 * beide Pipelines — der `mode`-Feld zeigt dem UI, welche Variante
 * zurückkommt.
 *
 * Der Importer NIEMALS wirft für einzelne fehlgeschlagene Folien — sie
 * landen mit `thumbnailUrl: null` im Ergebnis. Werfend nur bei
 * nicht-erreichbarer URL / ungültigem URL-Format / komplett fehlge-
 * schlagenem PPTX-Download (für API-Routen, die diese Fehler in HTTP-
 * Codes übersetzen).
 */

import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Page } from "puppeteer-core";
import { getContext } from "@/worker/lib/browser-pool";
import { uploadFile } from "@/lib/bunny/storage";
import {
  isEditMode,
  isPubembedMode,
  parsePublishedSlidesUrl,
  type ParsedGSlidesEdit,
  type ParsedGSlidesPubembed,
  type ParsedGSlidesUrl,
} from "./validate-url";
import {
  downloadPptx,
  PptxDownloadError,
} from "./pptx-fetch";
import { extractSlidesFromPptx } from "./pptx-zip";
import { collectPlaceholdersFromXml } from "./pptx-placeholders";
import { renderPptxToPngs } from "./pptx-render";

const SLIDE_VIEWPORT_W = 1280;
const SLIDE_VIEWPORT_H = 720;

const HARD_TIMEOUT_MS = 180_000; // gesamter Import
const PER_SLIDE_TIMEOUT_MS = 25_000;

const PLACEHOLDER_RE = /\{\{\s*([a-zA-Z0-9_.\-]+)\s*(?:\|[^}]*?)?\}\}/g;

/** Ein Folien-Eintrag im Import-Ergebnis. */
export interface ImportedSlide {
  /** 0-basierter Index im Deck. */
  slideIndex: number;
  /** Bunny-CDN-URL des PNG-Thumbnails (1280×720). null = Generation gescheitert. */
  thumbnailUrl: string | null;
  /** Sortierte, deduplizierte Liste der {{key}}-Treffer auf dieser Folie. */
  detectedPlaceholders: string[];
}

export interface ImportPublishedDeckResult {
  /** Welche Pipeline gelaufen ist — UI rendert ggf. eine Deprecated-Warnung. */
  mode: "edit" | "pubembed";
  /**
   * Kanonische URL des Imports. Bei Edit-Mode: PPTX-Export-URL.
   * Bei Pubembed: die Pubembed-URL ohne Query.
   */
  canonicalUrl: string;
  /**
   * Legacy-Feld: bleibt gefüllt für Bestandskampagnen, die das alte
   * Property-Name lesen.
   */
  canonicalPubembedUrl: string;
  /** Total slides discovered. */
  totalSlides: number;
  slides: ImportedSlide[];
  /**
   * `true`, wenn diese Pipeline pro Lead Substitution beherrscht. Edit-Mode
   * = true, Pubembed = false. Das Frontend zeigt im false-Fall eine deutliche
   * „Platzhalter werden NICHT ersetzt"-Warnung.
   */
  placeholdersSubstitutable: boolean;
}

/**
 * Lädt das Deck und liefert Thumbnails + Placeholder-Cache pro Folie.
 */
export async function importPublishedDeck(
  publishedUrl: string,
): Promise<ImportPublishedDeckResult> {
  const parsed = parsePublishedSlidesUrl(publishedUrl);

  return withTimeout(
    isEditMode(parsed) ? runEditImport(parsed) : runPubembedImport(parsed),
    HARD_TIMEOUT_MS,
    "importPublishedDeck",
  );
}

// ── Edit-Mode-Pipeline ──────────────────────────────────────────────────────

async function runEditImport(
  parsed: ParsedGSlidesEdit,
): Promise<ImportPublishedDeckResult> {
  // 1) PPTX herunterladen. Hier werfen wir gerne — Caller weiß, wie er
  //    „not-shared" dem User klar zurückspielt.
  let pptxBuf: Buffer;
  try {
    pptxBuf = await downloadPptx(parsed.docId);
  } catch (err) {
    if (err instanceof PptxDownloadError && err.code === "not-shared") {
      throw new GSlidesImportError("not-published", err.message);
    }
    throw err;
  }

  // 2) Folien-Texte + Placeholder-Liste parsen.
  const slides = await extractSlidesFromPptx(pptxBuf);
  if (slides.length === 0) {
    throw new GSlidesImportError(
      "not-published",
      "Das Deck enthält keine Folien.",
    );
  }

  const slidePlaceholders = new Map<number, string[]>();
  for (const s of slides) {
    slidePlaceholders.set(s.slideIndex, collectPlaceholdersFromXml(s.xmlContent));
  }

  // 3) PPTX → PNG-Sequenz. Falls LibreOffice ausfällt → Thumbnails null,
  //    Metadaten kommen trotzdem zurück. Der Editor zeigt einen Refresh-
  //    Button an, mit dem der User das später nachholen kann.
  const tmpRenderDir = join(tmpdir(), `gslides-thumbs-${parsed.docId}`);
  await mkdir(tmpRenderDir, { recursive: true });
  let pngPaths: string[] = [];
  try {
    const rendered = await renderPptxToPngs({
      pptxBuf,
      outputDir: tmpRenderDir,
      dpi: 150,
    });
    pngPaths = rendered.pngPaths;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(
      `[gslides/import] LibreOffice-Render fehlgeschlagen, lade ohne Thumbnails: ${
        (err as Error).message
      }`,
    );
  }

  // 4) Pro Folie Thumbnail nach Bunny. Wir tolerieren weniger PNGs als
  //    Folien (PDF-Rasterung kann in Edge-Cases einzelne Seiten kürzen) —
  //    fehlende PNGs werden zu `null`-Thumbnails.
  const docIdHash = createHash("sha1")
    .update(parsed.docId)
    .digest("hex")
    .slice(0, 16);

  const out: ImportedSlide[] = [];
  for (let i = 0; i < slides.length; i += 1) {
    const detected = slidePlaceholders.get(i) ?? [];
    let thumbnailUrl: string | null = null;
    const pngPath = pngPaths[i];
    if (pngPath) {
      try {
        const buf = await readFile(pngPath);
        const result = await uploadFile({
          buffer: buf,
          remotePath: `gslides/${docIdHash}/slide-${i}.png`,
          contentType: "image/png",
        });
        thumbnailUrl = result.url;
      } catch (uploadErr) {
        // eslint-disable-next-line no-console
        console.warn(
          `[gslides/import] bunny upload failed for slide ${i}: ${
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
    mode: "edit",
    canonicalUrl: parsed.canonicalExportUrl,
    // Backward-Compat: bestehender Schema-Code liest `canonicalPubembedUrl`.
    // Wir füllen es mit der Export-URL — der Wert ist nur als Cache-Key
    // relevant und wird im Edit-Mode nicht als Pubembed-URL interpretiert.
    canonicalPubembedUrl: parsed.canonicalExportUrl,
    totalSlides: slides.length,
    slides: out,
    placeholdersSubstitutable: true,
  };
}

// ── Pubembed-Pipeline (Legacy) ──────────────────────────────────────────────

async function runPubembedImport(
  parsed: ParsedGSlidesPubembed,
): Promise<ImportPublishedDeckResult> {
  const pooled = await getContext();
  let page: Page | null = null;
  try {
    page = await pooled.context.newPage();
    await page.setViewport({
      width: SLIDE_VIEWPORT_W,
      height: SLIDE_VIEWPORT_H,
      deviceScaleFactor: 2,
    });

    const firstUrl = buildSlideUrl(parsed.canonicalPubembedUrl, "id.p");
    await page.goto(firstUrl, {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });

    await waitForSlideReady(page);

    await page
      .addStyleTag({
        content: `
          .punch-viewer-navbar,
          .punch-viewer-content-mask,
          .punch-viewer-controls,
          .punch-viewer-controls-rendered,
          [class*="punch-viewer-navbar"],
          [class*="punch-viewer-controls"],
          [class*="punch-viewer-brand"],
          [class*="punch-viewer-watermark"],
          [class*="branding"],
          [class*="watermark"],
          [class*="punch-page-counter"],
          [class*="present-action-bar"],
          [class*="page-counter"],
          [aria-label*="Folie"]
          {
            display: none !important;
            visibility: hidden !important;
            opacity: 0 !important;
            pointer-events: none !important;
          }
          html, body {
            background: #000 !important;
            margin: 0 !important;
            padding: 0 !important;
            overflow: hidden !important;
          }
        `,
      })
      .catch(() => undefined);

    const totalSlides = await detectSlideCount(page);
    if (totalSlides <= 0) {
      throw new GSlidesImportError(
        "not-published",
        "Das Deck enthält keine sichtbaren Folien. Wurde es wirklich veröffentlicht?",
      );
    }

    const slides: ImportedSlide[] = [];
    for (let i = 0; i < totalSlides; i++) {
      try {
        const result = await withTimeout(
          captureCurrentSlide(page, parsed, i),
          PER_SLIDE_TIMEOUT_MS,
          `captureSlide(${i})`,
        );
        slides.push(result);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn(
          `[gslides/import] slide ${i} failed: ${(err as Error).message}`,
        );
        slides.push({
          slideIndex: i,
          thumbnailUrl: null,
          detectedPlaceholders: [],
        });
      }
      if (i < totalSlides - 1) {
        await page.keyboard.press("ArrowRight");
        await sleep(900);
        await waitForSlideReady(page).catch(() => undefined);
      }
    }

    return {
      mode: "pubembed",
      canonicalUrl: parsed.canonicalPubembedUrl,
      canonicalPubembedUrl: parsed.canonicalPubembedUrl,
      totalSlides,
      slides,
      placeholdersSubstitutable: false,
    };
  } catch (err) {
    if (err instanceof GSlidesImportError) throw err;
    if ((err as Error)?.message?.includes("net::ERR_")) {
      throw new GSlidesImportError(
        "not-published",
        'Google liefert die Präsentation nicht aus. Bitte prüfen, ob „Im Web veröffentlichen" aktiv ist.',
      );
    }
    throw err;
  } finally {
    if (page) {
      await page.close().catch(() => undefined);
    }
    await pooled.close();
  }
}

// ── Refresh: einzelne Folie neu fetchen ─────────────────────────────────────

export interface RefreshSlideResult {
  thumbnailUrl: string | null;
  detectedPlaceholders: string[];
  /** ISO-8601 timestamp dieses Fetches (für `lastFetchedAt`). */
  lastFetchedAt: string;
}

export async function refreshSlide(
  publishedUrl: string,
  slideIndex: number,
): Promise<RefreshSlideResult> {
  if (!Number.isInteger(slideIndex) || slideIndex < 0) {
    throw new GSlidesImportError("bad-index", "Ungültiger Folien-Index.");
  }
  const parsed = parsePublishedSlidesUrl(publishedUrl);

  return withTimeout(
    isEditMode(parsed)
      ? runEditRefresh(parsed, slideIndex)
      : runPubembedRefresh(parsed, slideIndex),
    PER_SLIDE_TIMEOUT_MS + 15_000,
    `refreshSlide(${slideIndex})`,
  );
}

async function runEditRefresh(
  parsed: ParsedGSlidesEdit,
  slideIndex: number,
): Promise<RefreshSlideResult> {
  // Wir laden das ganze PPTX (Single-Slide-Export gibt es nicht) und
  // rendern alle Folien — das ist nicht effizient, reicht für das
  // gelegentliche „Aktualisieren" aber locker.
  let pptxBuf: Buffer;
  try {
    pptxBuf = await downloadPptx(parsed.docId);
  } catch (err) {
    if (err instanceof PptxDownloadError && err.code === "not-shared") {
      throw new GSlidesImportError("not-published", err.message);
    }
    throw err;
  }
  const slides = await extractSlidesFromPptx(pptxBuf);
  if (slideIndex >= slides.length) {
    throw new GSlidesImportError(
      "bad-index",
      `Folie ${slideIndex + 1} existiert nicht (Deck hat ${slides.length} Folien).`,
    );
  }

  const detected = collectPlaceholdersFromXml(
    slides[slideIndex].xmlContent,
  );

  // Render alle PNGs, picke das richtige.
  const tmpRenderDir = join(tmpdir(), `gslides-refresh-${parsed.docId}-${slideIndex}`);
  await mkdir(tmpRenderDir, { recursive: true });
  let thumbnailUrl: string | null = null;
  try {
    const rendered = await renderPptxToPngs({
      pptxBuf,
      outputDir: tmpRenderDir,
      dpi: 150,
    });
    const pngPath = rendered.pngPaths[slideIndex];
    if (pngPath) {
      const buf = await readFile(pngPath);
      const docIdHash = createHash("sha1")
        .update(parsed.docId)
        .digest("hex")
        .slice(0, 16);
      const result = await uploadFile({
        buffer: buf,
        remotePath: `gslides/${docIdHash}/slide-${slideIndex}.png`,
        contentType: "image/png",
      });
      thumbnailUrl = result.url;
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(
      `[gslides/refresh] PPTX-Render fehlgeschlagen für Folie ${slideIndex}: ${
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

async function runPubembedRefresh(
  parsed: ParsedGSlidesPubembed,
  slideIndex: number,
): Promise<RefreshSlideResult> {
  const pooled = await getContext();
  let page: Page | null = null;
  try {
    page = await pooled.context.newPage();
    await page.setViewport({
      width: SLIDE_VIEWPORT_W,
      height: SLIDE_VIEWPORT_H,
      deviceScaleFactor: 1,
    });

    const url = buildSlideUrl(parsed.canonicalPubembedUrl, "id.p");
    await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });
    await waitForSlideReady(page);

    const total = await detectSlideCount(page);
    if (slideIndex >= total) {
      throw new GSlidesImportError(
        "bad-index",
        `Folie ${slideIndex + 1} existiert nicht (Deck hat ${total} Folien).`,
      );
    }

    for (let i = 0; i < slideIndex; i += 1) {
      await page.keyboard.press("ArrowRight");
      await sleep(900);
    }
    await waitForSlideReady(page).catch(() => undefined);

    const captured = await captureCurrentSlide(page, parsed, slideIndex);
    return {
      thumbnailUrl: captured.thumbnailUrl,
      detectedPlaceholders: captured.detectedPlaceholders,
      lastFetchedAt: new Date().toISOString(),
    };
  } finally {
    if (page) {
      await page.close().catch(() => undefined);
    }
    await pooled.close();
  }
}

/** Modul-eigener Error mit Klassifizierung für API-Routen. */
export class GSlidesImportError extends Error {
  readonly code:
    | "not-published"
    | "bad-index"
    | "render-failed"
    | "upload-failed";
  constructor(code: GSlidesImportError["code"], message: string) {
    super(message);
    this.code = code;
    this.name = "GSlidesImportError";
  }
}

// ── Pubembed-Internals (ungeändert aus Legacy-Pipeline) ─────────────────────

function buildSlideUrl(canonical: string, slideToken: string): string {
  const u = new URL(canonical);
  u.searchParams.set("start", "false");
  u.searchParams.set("loop", "false");
  u.searchParams.set("delayms", "60000");
  u.searchParams.set("slide", slideToken);
  return u.toString();
}

async function waitForSlideReady(page: Page): Promise<void> {
  const SELECTORS = [
    "svg.punch-viewer-svgpage-svg",
    ".punch-viewer-svgpage-wrapper svg",
    "iframe.punch-present-iframe",
    "[aria-label='Folie']",
    "[role='img'][aria-label]",
  ];
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    for (const sel of SELECTORS) {
      const found = await page
        .$(sel)
        .then((el) => el !== null)
        .catch(() => false);
      if (found) {
        await page
          .evaluate(() =>
            (
              document as Document & { fonts?: { ready?: Promise<unknown> } }
            ).fonts?.ready,
          )
          .catch(() => undefined);
        await page
          .evaluate(
            () => new Promise<void>((r) => requestAnimationFrame(() => r())),
          )
          .catch(() => undefined);
        return;
      }
    }
    await sleep(200);
  }
}

async function detectSlideCount(page: Page): Promise<number> {
  const fromViewer = await page
    .evaluate(async () => {
      const w = window as unknown as { viewerData?: { slidePageCount?: number } };
      for (let i = 0; i < 50; i++) {
        const n = w.viewerData?.slidePageCount;
        if (typeof n === "number" && n > 0) return n;
        await new Promise((r) => setTimeout(r, 100));
      }
      return 0;
    })
    .catch(() => 0);
  if (fromViewer > 0) return fromViewer;

  const fromDom = await page
    .evaluate(() => {
      const candidates = [
        document.querySelectorAll("[data-thumb-index]").length,
        document.querySelectorAll(".punch-filmstrip-thumbnail").length,
        Array.from(document.querySelectorAll('a[href*="#slide=id."]')).length,
      ];
      return Math.max(0, ...candidates);
    })
    .catch(() => 0);
  if (fromDom > 0) return fromDom;

  const visible = await page
    .$("svg.punch-viewer-svgpage-svg, .punch-viewer-svgpage-wrapper svg, iframe.punch-present-iframe")
    .then((el) => (el ? 1 : 0))
    .catch(() => 0);
  return visible;
}

async function captureCurrentSlide(
  page: Page,
  parsed: ParsedGSlidesPubembed,
  slideIndex: number,
): Promise<ImportedSlide> {
  await sleep(400);

  const detected = await extractPlaceholders(page);

  let pngBuf: Buffer;
  try {
    pngBuf = (await page.screenshot({
      type: "png",
      clip: {
        x: 0,
        y: 0,
        width: SLIDE_VIEWPORT_W,
        height: SLIDE_VIEWPORT_H,
      },
      omitBackground: false,
    })) as Buffer;
  } catch (err) {
    throw new GSlidesImportError(
      "render-failed",
      `Screenshot fehlgeschlagen: ${(err as Error).message}`,
    );
  }

  const thumbPath = bunnyThumbPath(parsed.publisherHash, slideIndex);
  let thumbnailUrl: string | null = null;
  try {
    const result = await uploadFile({
      buffer: pngBuf,
      remotePath: thumbPath,
      contentType: "image/png",
    });
    thumbnailUrl = result.url;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(
      `[gslides/import] bunny upload failed for slide ${slideIndex}: ${
        (err as Error).message
      }`,
    );
  }

  return {
    slideIndex,
    thumbnailUrl,
    detectedPlaceholders: detected,
  };
}

async function extractPlaceholders(page: Page): Promise<string[]> {
  const texts = await page
    .evaluate(() => {
      const roots: Node[] = [];
      const svg = document.querySelector(
        "svg.punch-viewer-svgpage-svg, .punch-viewer-svgpage-wrapper svg",
      );
      if (svg) roots.push(svg);
      const iframe = document.querySelector(
        "iframe.punch-present-iframe",
      ) as HTMLIFrameElement | null;
      if (iframe?.contentDocument?.body) {
        roots.push(iframe.contentDocument.body);
      }
      if (roots.length === 0) roots.push(document.body);

      const collected: string[] = [];
      for (const root of roots) {
        const walker = document.createTreeWalker(
          root,
          NodeFilter.SHOW_TEXT,
          null,
        );
        let node: Node | null = walker.nextNode();
        while (node !== null) {
          const v = (node.nodeValue ?? "").trim();
          if (v.length > 0) collected.push(v);
          node = walker.nextNode();
        }
      }
      return collected;
    })
    .catch(() => [] as string[]);

  const merged = texts.join(" ");
  const out = new Set<string>();
  let m: RegExpExecArray | null;
  PLACEHOLDER_RE.lastIndex = 0;
  while ((m = PLACEHOLDER_RE.exec(merged))) {
    out.add(m[1].trim());
  }
  for (const t of texts) {
    PLACEHOLDER_RE.lastIndex = 0;
    while ((m = PLACEHOLDER_RE.exec(t))) {
      out.add(m[1].trim());
    }
  }
  return Array.from(out).sort();
}

function bunnyThumbPath(publisherHash: string, slideIndex: number): string {
  const h = createHash("sha1")
    .update(publisherHash)
    .digest("hex")
    .slice(0, 16);
  return `gslides/${h}/slide-${slideIndex}.png`;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
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
              new GSlidesImportError(
                "render-failed",
                `[gslides] ${label} timed out after ${ms}ms`,
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

// ── Diagnose-Helper (für Tests/Dev) ────────────────────────────────────────

/**
 * Schreibt eine Debug-HTML der aktuellen Seite raus — nur in Tests.
 */
export async function dumpDebugHtml(
  page: Page,
  filename: string,
): Promise<string> {
  const dir = join(tmpdir(), "gslides-debug");
  await mkdir(dir, { recursive: true });
  const file = join(dir, filename);
  const html = await page.content().catch(() => "<html />");
  await writeFile(file, html, "utf-8");
  return file;
}

// Re-exports für saubere Imports vom UI/API.
export type { ParsedGSlidesUrl };
export { isEditMode, isPubembedMode };
