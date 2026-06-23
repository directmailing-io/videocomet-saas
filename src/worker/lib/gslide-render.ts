/**
 * Worker-Renderer für `kind: "gslide"`.
 *
 * Zwei Render-Pipelines, je nach URL-Mode:
 *
 *   1. `mode: "edit"`  (NEU, bevorzugt)
 *      - PPTX einmal pro Render-Process downloaden + cachen (Map)
 *      - Pro Lead: PPTX-Buffer im RAM kopieren, im XML `{{key}}`-Tokens
 *        durch Lead-Werte ersetzen
 *      - LibreOffice headless → PDF → PNG-Sequenz via Poppler
 *      - PNG mit korrektem `slideIndex` als Standbild → FFmpeg-Loop
 *
 *   2. `mode: "pubembed"`  (Legacy)
 *      - Puppeteer + DOM-Substitute wie bisher. Bleibt unverändert,
 *        damit Bestandskampagnen weiterlaufen.
 *
 * Caching:
 *   - PPTX-Downloads werden in einer Modul-globalen Map<docId, Buffer>
 *     gehalten (LRU mit Soft-Limit ~50 MB, TTL 30 min). Bei 1000 Leads ×
 *     5 Folien spart das 999 PPTX-Downloads.
 *
 * Defensive Fallbacks:
 *   - PPTX-Download crashed → wirft. Caller (renderSegmentsBase) liefert
 *     Black-Clip.
 *   - LibreOffice crashed → wirft. Caller liefert Black-Clip.
 *   - PNG-Index out-of-range (Folie wurde gelöscht) → wirft mit klarem
 *     Fehler, Caller liefert Black-Clip.
 */

import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Page } from "puppeteer-core";
import type { GSlideSegment } from "@/lib/segments/types";
import {
  substitute,
  type SubstitutionSystemContext,
} from "@/lib/placeholders/substitute";
import type {
  LegacyMapping,
  PlaceholderMapping,
} from "@/lib/placeholders/types";
import { getContext } from "./browser-pool";
import {
  isEditMode,
  parsePublishedSlidesUrl,
  type ParsedGSlidesPubembed,
} from "@/lib/gslides/validate-url";
import { downloadPptx } from "@/lib/gslides/pptx-fetch";
import { extractSlidesFromPptx } from "@/lib/gslides/pptx-zip";
import { substitutePptxPlaceholders } from "@/lib/gslides/pptx-substitute";
import { renderPptxToPngs } from "@/lib/gslides/pptx-render";

const SLIDE_W = 1280;
const SLIDE_H = 720;
const PER_SLIDE_NAVIGATION_TIMEOUT_MS = 30_000;
const HARD_TIMEOUT_MS = 90_000;

/**
 * Modul-globaler PPTX-Cache. Key = `docId`. Wert = Roh-Buffer + Zeit-
 * stempel.
 *
 * Wir cachen den Roh-Buffer (NICHT substituiert), weil pro Lead andere
 * Werte eingesetzt werden müssen. Die Substitution selbst ist günstig
 * (~10 ms pro PPTX), der Download dagegen kostet ~500 ms — den wollen
 * wir nicht 1000× wiederholen.
 */
interface CachedPptx {
  buf: Buffer;
  fetchedAt: number;
}
const PPTX_CACHE = new Map<string, CachedPptx>();
const PPTX_CACHE_TTL_MS = 30 * 60_000; // 30 min
const PPTX_CACHE_MAX_ENTRIES = 20;

/**
 * Liefert das PPTX einer Doc-ID aus dem Cache oder lädt es frisch.
 * Niemals werfend bei Cache-Treffer — bei Miss propagiert der
 * Download-Error.
 */
async function getCachedPptx(docId: string): Promise<Buffer> {
  const hit = PPTX_CACHE.get(docId);
  if (hit && Date.now() - hit.fetchedAt < PPTX_CACHE_TTL_MS) {
    return hit.buf;
  }
  const buf = await downloadPptx(docId);
  // Wenn der Cache voll ist, schmeißen wir den ältesten Eintrag raus.
  if (PPTX_CACHE.size >= PPTX_CACHE_MAX_ENTRIES) {
    let oldestKey: string | null = null;
    let oldestTs = Number.POSITIVE_INFINITY;
    for (const [k, v] of Array.from(PPTX_CACHE.entries())) {
      if (v.fetchedAt < oldestTs) {
        oldestTs = v.fetchedAt;
        oldestKey = k;
      }
    }
    if (oldestKey) PPTX_CACHE.delete(oldestKey);
  }
  PPTX_CACHE.set(docId, { buf, fetchedAt: Date.now() });
  return buf;
}

export interface RenderGSlideToMp4Options {
  slide: GSlideSegment;
  leadData: Record<string, string>;
  mapping?: PlaceholderMapping | LegacyMapping;
  /** Effektive Dauer dieses Segments in ms (vom Caller geclamped). */
  durationMs: number;
  /** Arbeitsverzeichnis für Zwischendateien. */
  outputDir: string;
  /** Pfad der finalen MP4. */
  outputPath: string;
  /** Optionaler System-Context (z. B. {{pageUrl}}). */
  systemContext?: SubstitutionSystemContext;
}

/**
 * Rendert eine Google-Slide-Folie als personalisiertes MP4.
 *
 * Wirft, wenn die URL ungültig ist oder das Rendering komplett versagt.
 * Caller (renderSegmentsBase) fängt das ab und liefert einen Black-Clip-
 * Placeholder, damit der Lead weiterläuft.
 */
export async function renderGSlideToMp4(
  opts: RenderGSlideToMp4Options,
): Promise<void> {
  await mkdir(opts.outputDir, { recursive: true });

  if (!opts.slide.publishedUrl?.trim()) {
    throw new Error(
      "[gslide-render] segment.publishedUrl ist leer — kein Render möglich.",
    );
  }
  const parsed = parsePublishedSlidesUrl(opts.slide.publishedUrl);

  if (isEditMode(parsed)) {
    // Edit-Mode: PPTX downloaden (mit Cache) und über die generische
    // `renderPptxSlideToMp4`-Pipeline laufen lassen.
    const pptxBuffer = await getCachedPptx(parsed.docId);
    await withTimeout(
      renderPptxSlideToMp4({
        pptxBuffer,
        slideIndex: opts.slide.slideIndex,
        detectedPlaceholders: opts.slide.detectedPlaceholders,
        leadData: opts.leadData,
        mapping: opts.mapping,
        durationMs: opts.durationMs,
        outputDir: opts.outputDir,
        outputPath: opts.outputPath,
        systemContext: opts.systemContext,
      }),
      HARD_TIMEOUT_MS,
      "renderPptxSlideToMp4",
    );
    return;
  }

  // Pubembed-Mode (Legacy): Puppeteer-Screenshot → MP4.
  const pngPath = join(opts.outputDir, "slide.png");
  await withTimeout(
    renderPubembedToPng(parsed, opts, pngPath),
    HARD_TIMEOUT_MS,
    "renderGSlideToPng",
  );

  const { renderImageToMp4 } = await import("./ffmpeg");
  await renderImageToMp4({
    imagePath: pngPath,
    durationMs: opts.durationMs,
    outputPath: opts.outputPath,
    width: SLIDE_W,
    height: SLIDE_H,
  });
}

// ── Generischer PPTX-Renderer (gslide-Edit + Canva teilen ihn) ─────────────

export interface RenderPptxSlideToMp4Options {
  /** PPTX-Buffer (bereits im RAM — Caller managed Download/Cache). */
  pptxBuffer: Buffer;
  /** 0-basierter Index der gewünschten Folie. */
  slideIndex: number;
  /**
   * Optionaler Hint, welche Keys auf dieser Folie verwendet werden. Wird
   * für die Resolution-Map gebraucht; wenn leer/undefined, leiten wir die
   * Keys aus `leadData` + `mapping` ab.
   */
  detectedPlaceholders?: string[];
  leadData: Record<string, string>;
  mapping: PlaceholderMapping | LegacyMapping | undefined;
  /** Pfad der finalen MP4. */
  outputPath: string;
  /** Arbeitsverzeichnis für LibreOffice + Zwischen-PNGs. */
  outputDir: string;
  durationMs: number;
  width?: number;
  height?: number;
  systemContext?: SubstitutionSystemContext;
}

/**
 * Rendert eine einzelne Folie aus einem PPTX-Buffer als personalisiertes
 * MP4. Geteilte Pipeline für `kind: "gslide"` (Edit-Mode) und
 * `kind: "canva"` — der Caller stellt den Buffer (Download/Cache).
 *
 * Pipeline:
 *   1. `{{key}}`-Tokens im XML mit aus Lead/Mapping aufgelösten Werten ersetzen.
 *   2. LibreOffice headless → PDF → PNG-Sequenz (via `renderPptxToPngs`).
 *   3. PNG mit `slideIndex` → FFmpeg-Loop → MP4 mit Ziel-Dauer.
 *
 * Wirft, wenn der `slideIndex` out-of-range ist oder LibreOffice keine
 * PNG für die Folie liefert. Caller (renderSegmentsBase) fängt das ab.
 */
export async function renderPptxSlideToMp4(
  opts: RenderPptxSlideToMp4Options,
): Promise<void> {
  await mkdir(opts.outputDir, { recursive: true });

  // 1) Lead-Mapping bauen — die zentrale `substitute()`-Funktion pre-
  //    rechnet jeden Key, damit das PPTX-XML rein-mechanisch ersetzen kann.
  const resolved = buildResolvedKeyValueMap(
    opts.detectedPlaceholders,
    opts.leadData,
    opts.mapping,
    opts.systemContext,
  );

  // 2) PPTX in-memory substituieren.
  const substitutedPptx = await substitutePptxPlaceholders(
    opts.pptxBuffer,
    resolved,
  );

  // 3) Wieviele Folien hat das Deck? Wenn der gespeicherte Index out-
  //    of-range ist (User hat eine Folie gelöscht), werfen wir.
  const totalSlides = (await extractSlidesFromPptx(opts.pptxBuffer)).length;
  if (opts.slideIndex >= totalSlides) {
    throw new Error(
      `[pptx-render] Folie ${opts.slideIndex} existiert nicht (Deck hat ${totalSlides}).`,
    );
  }

  // 4) Render als PNG-Sequenz; LibreOffice bekommt sein eigenes
  //    Profile-Verzeichnis, daher parallel-tauglich.
  const tmpRenderDir = join(opts.outputDir, "lo-out");
  await mkdir(tmpRenderDir, { recursive: true });
  const rendered = await renderPptxToPngs({
    pptxBuf: substitutedPptx,
    outputDir: tmpRenderDir,
    dpi: 150,
  });

  // 5) PNG mit dem gewünschten Index nach `outputDir/slide.png` ziehen.
  const sourcePng = rendered.pngPaths[opts.slideIndex];
  if (!sourcePng) {
    throw new Error(
      `[pptx-render] LibreOffice lieferte keine PNG für Folie ${opts.slideIndex} (${rendered.pngPaths.length} insgesamt).`,
    );
  }
  const pngPath = join(opts.outputDir, "slide.png");
  const buf = await readFile(sourcePng);
  const { writeFile } = await import("node:fs/promises");
  await writeFile(pngPath, buf);

  // 6) PNG → MP4.
  const { renderImageToMp4 } = await import("./ffmpeg");
  await renderImageToMp4({
    imagePath: pngPath,
    durationMs: opts.durationMs,
    outputPath: opts.outputPath,
    width: opts.width ?? SLIDE_W,
    height: opts.height ?? SLIDE_H,
  });
}

// ── Pubembed-Renderer (Legacy, unverändert) ────────────────────────────────

async function renderPubembedToPng(
  parsed: ParsedGSlidesPubembed,
  opts: RenderGSlideToMp4Options,
  pngPath: string,
): Promise<void> {
  const firstUrl = buildSlideUrl(parsed.canonicalPubembedUrl);

  const pooled = await getContext();
  let page: Page | null = null;
  try {
    page = await pooled.context.newPage();
    await page.setViewport({
      width: SLIDE_W,
      height: SLIDE_H,
      deviceScaleFactor: 2,
    });

    await page.goto(firstUrl, {
      waitUntil: "domcontentloaded",
      timeout: PER_SLIDE_NAVIGATION_TIMEOUT_MS,
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
          .docs-icon-img-container,
          .punch-speaker-notes,
          [aria-label*="Folie"],
          [class*="present-action-bar"],
          [class*="page-counter"]
          {
            display: none !important;
            visibility: hidden !important;
            opacity: 0 !important;
            height: 0 !important;
            width: 0 !important;
            overflow: hidden !important;
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

    for (let i = 0; i < opts.slide.slideIndex; i += 1) {
      await page.keyboard.press("ArrowRight");
      await new Promise((r) => setTimeout(r, 900));
    }
    await waitForSlideReady(page).catch(() => undefined);

    // Pubembed → keine Substitution möglich. Wir screenshotten direkt.
    await page
      .evaluate(
        () =>
          new Promise<void>((r) =>
            requestAnimationFrame(() => requestAnimationFrame(() => r())),
          ),
      )
      .catch(() => undefined);
    await sleep(120);

    const { writeFile } = await import("node:fs/promises");
    const buf = (await page.screenshot({
      type: "png",
      clip: { x: 0, y: 0, width: SLIDE_W, height: SLIDE_H },
      omitBackground: false,
    })) as Buffer;
    await writeFile(pngPath, buf);
  } finally {
    if (page) {
      await page.close().catch(() => undefined);
    }
    await pooled.close();
  }
}

// ── Internals ──────────────────────────────────────────────────────────────

function buildSlideUrl(canonical: string): string {
  const u = new URL(canonical);
  u.searchParams.set("start", "false");
  u.searchParams.set("loop", "false");
  u.searchParams.set("delayms", "60000");
  u.searchParams.set("slide", "id.p");
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

/**
 * Pre-resolved key → value Map. Wir verwenden die zentrale
 * `substitute()`-Funktion mit Format „double-brace", damit die gleiche
 * Mapping-Auflösung greift wie in PDF/LP/etc. Niemals werfend.
 */
function buildResolvedKeyValueMap(
  detectedKeys: string[] | undefined,
  leadData: Record<string, string>,
  mapping: PlaceholderMapping | LegacyMapping | undefined,
  systemContext?: SubstitutionSystemContext,
): Record<string, string> {
  const out: Record<string, string> = {};
  const keys = new Set<string>(detectedKeys ?? []);
  if (mapping) {
    for (const k of Object.keys(mapping)) keys.add(k);
  }
  for (const k of leadData ? Object.keys(leadData) : []) keys.add(k);
  for (const key of Array.from(keys)) {
    if (!key) continue;
    try {
      const v = substitute(
        `{{${key}}}`,
        leadData,
        mapping,
        "double-brace",
        systemContext,
      );
      out[key] = v;
    } catch {
      out[key] = "";
    }
  }
  return out;
}

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
          () => reject(new Error(`[gslide-render] ${label} timed out after ${ms}ms`)),
          ms,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// ── Export für Tests ───────────────────────────────────────────────────────

/**
 * Test-Hook: leert den PPTX-Cache. Niemals von Produktiv-Code aufrufen.
 */
export function __clearPptxCacheForTests(): void {
  PPTX_CACHE.clear();
}
