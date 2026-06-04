/**
 * Google-Slides „Published Deck" → Folien-Importer.
 *
 * Pipeline pro Folie:
 *   1. Puppeteer öffnet die kanonische Pubembed-URL
 *   2. Wir warten auf `document.fonts.ready` und auf das eigentliche
 *      Slide-SVG (Google rendert client-side, brauchen Sekunde Zeit)
 *   3. Wir messen die Folien-Anzahl im Deck (Side-Filmstrip ODER Body-Config)
 *   4. Wir navigieren pro Folie:
 *      - PRIMÄR per URL-Hash (`?slide=N`, 1-basiert)
 *      - FALLBACK per Click auf den „Nächste"-Button
 *   5. Wir machen einen 1280×720-Screenshot des Folien-Containers
 *   6. Wir laden den Screenshot zu Bunny Storage hoch
 *   7. Wir extrahieren alle TextNodes der Folie und sammeln {{key}}-Treffer
 *
 * Ein Modul-internes Hard-Timeout pro Folie schützt vor hängendem
 * Puppeteer — sollte eine Folie nicht binnen 25 s rendern, wird sie als
 * leeres Thumbnail markiert und der Import fährt fort.
 *
 * Anti-Bias: Wir sind defensiv mit Selektoren. Google ändert die Pubembed-
 * Renderer-Internals gelegentlich; wir loggen jede Annahme, damit
 * Diagnose im Worker-Log möglich bleibt.
 */

import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Page } from "puppeteer-core";
import { getContext } from "@/worker/lib/browser-pool";
import { uploadFile } from "@/lib/bunny/storage";
import {
  parsePublishedSlidesUrl,
  type ParsedGSlidesUrl,
} from "./validate-url";

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
  /** Die kanonische Pubembed-URL (ohne Query). */
  canonicalPubembedUrl: string;
  /** Total slides discovered. */
  totalSlides: number;
  slides: ImportedSlide[];
}

/**
 * Lädt das veröffentlichte Deck und liefert Thumbnails + Placeholder-Cache
 * pro Folie.
 *
 * Niemals werfend für „Slide n konnte nicht gerendert werden" — solche
 * Folien landen mit `thumbnailUrl: null` im Ergebnis und der Importer
 * fährt mit der nächsten fort. Werfend nur bei nicht-erreichbarer URL
 * oder ungültigem URL-Format (für API-Routen, die diese Fehler in
 * passende HTTP-Codes übersetzen).
 */
export async function importPublishedDeck(
  publishedUrl: string,
): Promise<ImportPublishedDeckResult> {
  const parsed = parsePublishedSlidesUrl(publishedUrl);

  return withTimeout(
    runImport(parsed),
    HARD_TIMEOUT_MS,
    "importPublishedDeck",
  );
}

async function runImport(
  parsed: ParsedGSlidesUrl,
): Promise<ImportPublishedDeckResult> {
  const pooled = await getContext();
  let page: Page | null = null;
  try {
    page = await pooled.context.newPage();
    await page.setViewport({
      width: SLIDE_VIEWPORT_W,
      height: SLIDE_VIEWPORT_H,
      deviceScaleFactor: 1,
    });

    // Start auf Folie 1 (slide=id.p) — die Pubembed-Init-Sequenz mag das.
    const firstUrl = buildSlideUrl(parsed.canonicalPubembedUrl, "id.p");
    await page.goto(firstUrl, {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });

    await waitForSlideReady(page);

    const totalSlides = await detectSlideCount(page);
    if (totalSlides <= 0) {
      throw new GSlidesImportError(
        "not-published",
        "Das Deck enthält keine sichtbaren Folien. Wurde es wirklich veröffentlicht?",
      );
    }

    // Wir capturen alle Folien sequenziell — Folie 0 ist schon angezeigt,
    // danach jeweils ArrowRight + kurze Karenz für den Slide-In.
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
      // Zur nächsten Folie navigieren (außer beim letzten Iterationsschritt)
      if (i < totalSlides - 1) {
        await page.keyboard.press("ArrowRight");
        await sleep(900);
        await waitForSlideReady(page).catch(() => undefined);
      }
    }

    return {
      canonicalPubembedUrl: parsed.canonicalPubembedUrl,
      totalSlides,
      slides,
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

/**
 * Re-fetch für eine einzelne Folie — nutzt der „Aktualisieren"-Button im
 * Editor. Returnt nur die Felder, die das Segment-Schema cached
 * (`thumbnailUrl`, `detectedPlaceholders`) — der Caller mergt das ins
 * Segment.
 */
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
    throw new GSlidesImportError(
      "bad-index",
      "Ungültiger Folien-Index.",
    );
  }
  const parsed = parsePublishedSlidesUrl(publishedUrl);

  return withTimeout(
    runRefresh(parsed, slideIndex),
    PER_SLIDE_TIMEOUT_MS + 15_000,
    `refreshSlide(${slideIndex})`,
  );
}

async function runRefresh(
  parsed: ParsedGSlidesUrl,
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

    // Start auf der ersten Folie, dann per ArrowRight bis zum Ziel-Index
    // navigieren — Google ignoriert numerische `slide=`-Werte, die direkte
    // URL-Navigation funktioniert nur mit echten Slide-IDs die wir nicht
    // sicher von außen kennen.
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

// ── Internals ──────────────────────────────────────────────────────────────

/**
 * Baut die URL für eine bestimmte Folie. Google's pubembed akzeptiert
 * `?slide=<1-basierter Index>` — falls Google das Format wechselt, ist das
 * der eine Punkt zum Anpassen. Funktioniert in der aktuellen Renderer-
 * Version (Stand 2026-06).
 */
function buildSlideUrl(canonical: string, slideToken: string): string {
  const u = new URL(canonical);
  u.searchParams.set("start", "false");
  u.searchParams.set("loop", "false");
  u.searchParams.set("delayms", "60000");
  // ACHTUNG: Google akzeptiert NUR echte Slide-IDs (`id.p`, `id.gXXXX`)
  // — Integer-Indices `?slide=1` werden ignoriert und Google serviert
  // stumm die erste Folie. Wir starten daher auf `id.p` (= erste Folie)
  // und navigieren danach per ArrowRight pro Capture, statt URLs zu
  // bauen.
  u.searchParams.set("slide", slideToken);
  return u.toString();
}

/**
 * Wartet auf die Sichtbarkeit der Slide-SVG-Bühne. Google rendert client-
 * seitig — DOMContentLoaded alleine reicht nicht.
 */
async function waitForSlideReady(page: Page): Promise<void> {
  // Selectors in der bevorzugten Reihenfolge. Mehrere Fallbacks weil
  // Google die DOM-Klassen ohne Vorwarnung umbenennt.
  const SELECTORS = [
    "svg.punch-viewer-svgpage-svg", // klassisches pubembed
    ".punch-viewer-svgpage-wrapper svg",
    "iframe.punch-present-iframe",
    "[aria-label='Folie']",
    "[role='img'][aria-label]", // Generic fallback
  ];
  // Bis zu 20 s warten — Google kann auf cold-start nahe an 10 s liegen.
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    for (const sel of SELECTORS) {
      const found = await page
        .$(sel)
        .then((el) => el !== null)
        .catch(() => false);
      if (found) {
        // Zusätzlich auf Fonts warten — Schrift-Swap dauert ~300 ms.
        await page
          .evaluate(() =>
            (
              document as Document & { fonts?: { ready?: Promise<unknown> } }
            ).fonts?.ready,
          )
          .catch(() => undefined);
        // Ein letzter rAF, damit der Compositor durch ist.
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
  // Nicht abbrechen — die nachfolgende Folien-Zählung wird 0 liefern
  // und der Caller wirft einen klaren Fehler.
}

/**
 * Misst die Anzahl Folien im Deck. Strategie:
 *   A. Google rendert im pubembed eine versteckte Filmstrip-Liste mit
 *      `data-thumb-index` oder `.punch-filmstrip-thumbnail` — wir zählen
 *      die.
 *   B. Wenn das nicht da ist, klicken wir „Nächste" und prüfen ob die
 *      slide-Page-URL einen anderen `id.p<N>` hat. Aufwendiger, daher
 *      Fallback.
 *
 * In der aktuellen Renderer-Version ist (A) verfügbar. Wenn Google das
 * mal abschaltet, wirft die Funktion 0 und der Caller liefert einen
 * klaren Fehler.
 */
async function detectSlideCount(page: Page): Promise<number> {
  // (A) Definitive Quelle: window.viewerData.slidePageCount. Pubembed
  // schreibt das nach Init in die Page. Wir pollen bis 5s.
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

  // (B) Fallback: DOM-Selektoren wenn viewerData nicht da (alte Renderer)
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

  // (C) Letzter Strohhalm: zumindest die aktuelle Folie zählt.
  const visible = await page
    .$("svg.punch-viewer-svgpage-svg, .punch-viewer-svgpage-wrapper svg, iframe.punch-present-iframe")
    .then((el) => (el ? 1 : 0))
    .catch(() => 0);
  return visible;
}

/**
 * Navigiert zur Folie `slideIndex` (0-basiert), screenshottet, lädt das
 * Thumbnail hoch und extrahiert TextNodes.
 *
 * Hinweis: wir nutzen für die Navigation `page.goto(slide=N)` statt eines
 * Click-Tricks, weil das in der aktuellen Renderer-Version stabil ist und
 * uns vor State-Bugs in Google's slide-cache schützt.
 */
async function captureCurrentSlide(
  page: Page,
  parsed: ParsedGSlidesUrl,
  slideIndex: number,
): Promise<ImportedSlide> {
  // Annahme: die Page steht bereits auf der richtigen Folie (Caller
  // navigiert per ArrowRight). Kurze Karenz für Slide-In-Animation.
  await sleep(400);

  // 1) Placeholder-Extraktion aus dem DOM. Wir lesen ALLE TextNodes der
  //    Seite, nicht nur der aktuellen Folie — pubembed zeigt eh nur eine
  //    Folie und der Hidden-Cache enthält manchmal noch Reste der vorigen.
  //    Daher beschränken wir uns auf die sichtbare svg-Bühne, falls
  //    vorhanden.
  const detected = await extractPlaceholders(page);

  // 2) Screenshot.
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

  // 3) Upload nach Bunny.
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
    // Defensive: wir crashen nicht, falls Bunny zickt. Der Caller sieht
    // null und kann „Aktualisieren" anbieten. Der Pre-Render-Check vor
    // Run-Start fängt fehlende Thumbnails ebenfalls ab.
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

/**
 * Extrahiert `{{key}}`-Treffer aus den Text-Nodes der Folie. Wir
 * konzentrieren uns auf den sichtbaren SVG-Bereich; wenn der nicht
 * existiert, fallen wir auf `document.body` zurück.
 */
async function extractPlaceholders(page: Page): Promise<string[]> {
  const texts = await page
    .evaluate(() => {
      const roots: Node[] = [];
      const svg = document.querySelector(
        "svg.punch-viewer-svgpage-svg, .punch-viewer-svgpage-wrapper svg",
      );
      if (svg) roots.push(svg);
      // pubembed kann die Folie auch in einem inneren iframe rendern. Da kommen
      // wir same-origin nicht ran — wir versuchen es trotzdem defensiv.
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

  // Adjazenz-Heuristik: wenn `{{first` und `Name}}` auf zwei aufeinander-
  // folgenden TextNodes aufgeteilt wurden (Google manchmal bei Bold-
  // Übergängen), joinen wir die Liste, scannen das Ergebnis UND scannen
  // jeden einzelnen Node. So fangen wir beide Fälle ab.
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

/**
 * Erzeugt einen kurzen Hash des Publisher-Hash für Bunny-Pfade. Die
 * Publisher-Hashes sind selbst schon kollisionsfrei; wir kürzen sie nur,
 * weil Bunny-Listings mit 200+ Zeichen pro Pfad mühsam sind.
 */
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
 * Schreibt eine Debug-HTML der aktuellen Seite raus — wird nur in Tests
 * verwendet, niemals von der Produktiv-Pipeline.
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

