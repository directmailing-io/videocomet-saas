/**
 * Worker-Renderer für `kind: "canva"`.
 *
 * Spiegelt den Edit-Mode-Pfad aus `gslide-render.ts`, aber mit einer vom
 * User hochgeladenen PPTX-Datei statt einem Google-Slides-Export:
 *
 *   1. PPTX-Buffer via Bunny-CDN-URL holen (mit LRU-Cache pro Render-Process).
 *   2. `renderPptxSlideToMp4()` aus `gslide-render.ts` macht den Rest —
 *      Substitution, LibreOffice, FFmpeg.
 *
 * Caching:
 *   - PPTX-Downloads werden in einer Modul-globalen Map<url, Buffer>
 *     gehalten (TTL 30 min, max 20 Einträge). Bei 1000 Leads × N Folien
 *     spart das 999 Bunny-Downloads.
 *
 * Defensive Fallbacks:
 *   - Bunny-Download crashed → wirft. Caller (renderSegmentsBase) liefert
 *     Black-Clip.
 *   - LibreOffice / Index-out-of-range → werfen aus `renderPptxSlideToMp4`.
 */

import type { CanvaSegment } from "@/lib/segments/types";
import type {
  LegacyMapping,
  PlaceholderMapping,
} from "@/lib/placeholders/types";
import type { SubstitutionSystemContext } from "@/lib/placeholders/substitute";
import { renderPptxSlideToMp4 } from "./gslide-render";

// ── PPTX-Cache (analog zu gslide-render.PPTX_CACHE) ────────────────────────

interface CachedPptx {
  buffer: Buffer;
  fetchedAt: number;
}
const CANVA_PPTX_CACHE = new Map<string, CachedPptx>();
const CACHE_TTL_MS = 30 * 60_000; // 30 min
const CACHE_MAX_ENTRIES = 20;
const MAX_PPTX_BYTES = 100 * 1024 * 1024; // 100 MB — schützt vor ZIP-Bombs
const DEFAULT_TIMEOUT_MS = 60_000;
const HARD_TIMEOUT_MS = 90_000;

/**
 * Lädt das PPTX aus Bunny-Storage (oder Cache). Niemals werfend bei
 * Cache-Treffer — bei Miss propagiert der Fetch-Error.
 */
async function getCachedPptxFromUrl(url: string): Promise<Buffer> {
  const hit = CANVA_PPTX_CACHE.get(url);
  if (hit && Date.now() - hit.fetchedAt < CACHE_TTL_MS) {
    return hit.buffer;
  }

  const buf = await fetchPptxFromUrl(url);

  // LRU-Eviction: ältesten Eintrag werfen, wenn der Cache voll ist.
  if (CANVA_PPTX_CACHE.size >= CACHE_MAX_ENTRIES) {
    let oldestKey: string | null = null;
    let oldestTs = Number.POSITIVE_INFINITY;
    for (const [k, v] of Array.from(CANVA_PPTX_CACHE.entries())) {
      if (v.fetchedAt < oldestTs) {
        oldestTs = v.fetchedAt;
        oldestKey = k;
      }
    }
    if (oldestKey) CANVA_PPTX_CACHE.delete(oldestKey);
  }

  CANVA_PPTX_CACHE.set(url, { buffer: buf, fetchedAt: Date.now() });
  return buf;
}

/**
 * Lädt das PPTX vom Bunny-CDN. Validiert per ZIP-Magic-Number, damit eine
 * unerwartete HTML-Fehlerseite nicht durch unseren Filter rutscht.
 */
async function fetchPptxFromUrl(url: string): Promise<Buffer> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
    });
  } catch (err) {
    throw new Error(
      `[canva-render] PPTX-Download fehlgeschlagen: ${(err as Error).message}`,
    );
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    throw new Error(
      `[canva-render] PPTX-Download HTTP ${response.status} (${url})`,
    );
  }

  const arrayBuf = await response.arrayBuffer();
  if (arrayBuf.byteLength > MAX_PPTX_BYTES) {
    throw new Error(
      `[canva-render] PPTX zu groß (${arrayBuf.byteLength} Byte). Limit: ${MAX_PPTX_BYTES}.`,
    );
  }
  const buf = Buffer.from(arrayBuf);
  if (buf.length < 4 || buf[0] !== 0x50 || buf[1] !== 0x4b) {
    throw new Error(
      `[canva-render] Antwort ist kein PPTX-Archiv (Magic-Number-Check fehlgeschlagen).`,
    );
  }
  return buf;
}

// ── Public API ─────────────────────────────────────────────────────────────

export interface RenderCanvaSlideToMp4Options {
  segment: CanvaSegment;
  leadData: Record<string, string>;
  mapping?: PlaceholderMapping | LegacyMapping;
  /** Effektive Dauer dieses Segments in ms (vom Caller geclamped). */
  durationMs: number;
  /** Arbeitsverzeichnis für Zwischendateien. */
  outputDir: string;
  /** Pfad der finalen MP4. */
  outputPath: string;
  width?: number;
  height?: number;
  systemContext?: SubstitutionSystemContext;
}

/**
 * Rendert eine Canva-Folie als personalisiertes MP4.
 *
 * Wirft, wenn die PPTX nicht erreichbar ist oder LibreOffice komplett
 * versagt. Caller (renderSegmentsBase) fängt das ab und liefert einen
 * Black-Clip-Placeholder, damit der Lead weiterläuft.
 */
export async function renderCanvaSlideToMp4(
  opts: RenderCanvaSlideToMp4Options,
): Promise<void> {
  const { segment } = opts;
  if (!segment.pptxPublicUrl?.trim()) {
    throw new Error(
      "[canva-render] segment.pptxPublicUrl ist leer — kein Render möglich.",
    );
  }

  const pptxBuffer = await withTimeout(
    getCachedPptxFromUrl(segment.pptxPublicUrl),
    HARD_TIMEOUT_MS,
    "getCachedPptxFromUrl",
  );

  await withTimeout(
    renderPptxSlideToMp4({
      pptxBuffer,
      slideIndex: segment.slideIndex,
      detectedPlaceholders: segment.detectedPlaceholders,
      leadData: opts.leadData,
      mapping: opts.mapping,
      durationMs: opts.durationMs,
      outputDir: opts.outputDir,
      outputPath: opts.outputPath,
      width: opts.width,
      height: opts.height,
      systemContext: opts.systemContext,
    }),
    HARD_TIMEOUT_MS,
    "renderPptxSlideToMp4(canva)",
  );
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
          () => reject(new Error(`[canva-render] ${label} timed out after ${ms}ms`)),
          ms,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// ── Test-Hook ──────────────────────────────────────────────────────────────

/**
 * Test-Hook: leert den PPTX-Cache. Niemals von Produktiv-Code aufrufen.
 */
export function __clearCanvaPptxCacheForTests(): void {
  CANVA_PPTX_CACHE.clear();
}
