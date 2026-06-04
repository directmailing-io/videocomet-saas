/**
 * Worker-Renderer für `kind: "gslide"`.
 *
 * Pipeline pro Folie:
 *   1. Puppeteer öffnet die `publishedUrl` mit `?slide=<N>`.
 *   2. Wir warten auf `document.fonts.ready` und das Slide-SVG.
 *   3. `page.evaluate`: ein TreeWalker läuft über alle TextNodes der Folie
 *      und ersetzt `{{key}}`-Tokens durch die für diesen Lead aufgelösten
 *      Werte (per `substitute()` aus `@/lib/placeholders`).
 *   4. Wir warten einen rAF und screenshotten 1280×720.
 *   5. FFmpeg `renderImageToMp4` macht eine MP4 in der gewünschten Dauer.
 *
 * Die Substitutions-Logik läuft im Browser-Kontext, weil wir den
 * substituten Wert pro Key dort brauchen. Wir vorberechnen die
 * key→value-Map im Node-Land per `substitute()` und reichen sie als
 * JSON-Array in `page.evaluate`. So bleibt die Browser-Logik dumm.
 *
 * Defensive Fallbacks:
 *   - Pubembed wirft `net::ERR_*` → caller fängt es und liefert
 *     einen Black-Clip (s. `renderSegmentsBase`).
 *   - DOM hat keinen sichtbaren Text → wir screenshotten trotzdem.
 *   - Single-slide-Substitute-Errors crashen NICHT die Folie — wir
 *     loggen + screenshotten das un-substituierte DOM.
 */

import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { Page } from "puppeteer-core";
import type { GSlideSegment } from "@/lib/segments/types";
import { substitute } from "@/lib/placeholders/substitute";
import type {
  LegacyMapping,
  PlaceholderMapping,
} from "@/lib/placeholders/types";
import { getContext } from "./browser-pool";
import { parsePublishedSlidesUrl } from "@/lib/gslides/validate-url";

const SLIDE_W = 1280;
const SLIDE_H = 720;
const PER_SLIDE_NAVIGATION_TIMEOUT_MS = 30_000;
const HARD_TIMEOUT_MS = 60_000;

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
}

/**
 * Rendert eine Google-Slide-Folie als personalisiertes MP4.
 *
 * Wirft, wenn die Pubembed-URL ungültig ist oder Puppeteer komplett
 * versagt. Der Caller (renderSegmentsBase) fängt das ab und liefert einen
 * Black-Clip-Placeholder, damit der Lead weiterläuft.
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
  // Wirft GSlidesUrlError, wenn die URL nicht published-Format ist.
  parsePublishedSlidesUrl(opts.slide.publishedUrl);

  const pngPath = join(opts.outputDir, "slide.png");
  await withTimeout(
    renderGSlideToPng({
      slide: opts.slide,
      leadData: opts.leadData,
      mapping: opts.mapping,
      outputPath: pngPath,
    }),
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

/**
 * Lädt die Pubembed-URL, ersetzt Platzhalter im DOM und screenshotted.
 * Exportiert für Tests; nicht aus der video-render-Pipeline aufgerufen.
 */
export async function renderGSlideToPng(opts: {
  slide: GSlideSegment;
  leadData: Record<string, string>;
  mapping?: PlaceholderMapping | LegacyMapping;
  outputPath: string;
}): Promise<void> {
  const parsed = parsePublishedSlidesUrl(opts.slide.publishedUrl);
  const slideUrl = buildSlideUrl(
    parsed.canonicalPubembedUrl,
    opts.slide.slideIndex + 1,
  );

  const pooled = await getContext();
  let page: Page | null = null;
  try {
    page = await pooled.context.newPage();
    await page.setViewport({
      width: SLIDE_W,
      height: SLIDE_H,
      deviceScaleFactor: 1,
    });

    await page.goto(slideUrl, {
      waitUntil: "domcontentloaded",
      timeout: PER_SLIDE_NAVIGATION_TIMEOUT_MS,
    });

    await waitForSlideReady(page);

    // 1. Pre-Substitute: alle Keys vom Lead vorbereiten.
    const resolved = buildResolvedKeyValueMap(
      opts.slide.detectedPlaceholders,
      opts.leadData,
      opts.mapping,
    );

    // 2. Im Browser: TreeWalker über alle TextNodes, jeden Match
    //    durch den vor-substituierten Wert ersetzen.
    try {
      await page.evaluate((kv: Record<string, string>) => {
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

        // Adjazenz-Merge: wenn `{{first` und `Name}}` auf zwei Nodes
        // verteilt sind, mergen wir zuerst (Google teilt bei Bold-
        // Übergängen). Wir laufen pro Root, sammeln consecutive Nodes
        // in einem „Cluster" und replacen den nodeValue von cluster[0],
        // die anderen leeren wir.
        for (const root of roots) {
          const walker = document.createTreeWalker(
            root,
            NodeFilter.SHOW_TEXT,
            null,
          );
          const all: Text[] = [];
          let n: Node | null = walker.nextNode();
          while (n !== null) {
            all.push(n as Text);
            n = walker.nextNode();
          }
          // Replace per single node — der TreeWalker liefert keine
          // Information über Adjazenz im Sinne von „selbe Zeile". Falls
          // ein Token auf zwei Nodes verteilt ist, fangen wir das in
          // einem zweiten Pass (siehe unten) per parent-merge ab.
          for (const tn of all) {
            const original = tn.nodeValue ?? "";
            if (!original.includes("{{")) continue;
            tn.nodeValue = original.replace(
              /\{\{\s*([a-zA-Z0-9_.\-]+)\s*(?:\|[^}]*?)?\}\}/g,
              (_m, key: string) => {
                const k = key.trim();
                return Object.prototype.hasOwnProperty.call(kv, k)
                  ? kv[k]
                  : "";
              },
            );
          }
          // Second-pass: Verteilte Tokens. Wir prüfen Eltern, deren
          // textContent ein vollständiges `{{key}}` enthält, das aber
          // auf keinem einzelnen Child-Node komplett liegt.
          const parents: Element[] = [];
          const seenParents = new WeakSet<Element>();
          for (const tn of all) {
            const p = tn.parentElement;
            if (p && !seenParents.has(p)) {
              seenParents.add(p);
              parents.push(p);
            }
          }
          for (const p of parents) {
            const tc = p.textContent ?? "";
            if (!/\{\{/.test(tc)) continue;
            // Wenn KEIN child-text-node "{{" enthält, ist das Token
            // über mehrere Children verteilt — wir kollabieren den
            // textContent.
            let splitToken = false;
            const children = Array.from(p.childNodes) as ChildNode[];
            for (const child of children) {
              if (
                child.nodeType === 3 /* Node.TEXT_NODE */ &&
                (child.nodeValue ?? "").indexOf("{{") !== -1
              ) {
                splitToken = false;
                break;
              }
              splitToken = true;
            }
            if (!splitToken) continue;
            p.textContent = tc.replace(
              /\{\{\s*([a-zA-Z0-9_.\-]+)\s*(?:\|[^}]*?)?\}\}/g,
              (_m: string, key: string) => {
                const k = key.trim();
                return Object.prototype.hasOwnProperty.call(kv, k)
                  ? kv[k]
                  : "";
              },
            );
          }
        }
      }, resolved);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(
        `[gslide-render] DOM-Substitution fehlgeschlagen, screenshotte unverändertes DOM: ${
          (err as Error).message
        }`,
      );
    }

    // 3. rAF + kurze Pause, damit das Re-Layout durch ist.
    await page
      .evaluate(
        () =>
          new Promise<void>((r) =>
            requestAnimationFrame(() => requestAnimationFrame(() => r())),
          ),
      )
      .catch(() => undefined);
    await sleep(120);

    // 4. Screenshot.
    const { writeFile } = await import("node:fs/promises");
    const buf = (await page.screenshot({
      type: "png",
      clip: { x: 0, y: 0, width: SLIDE_W, height: SLIDE_H },
      omitBackground: false,
    })) as Buffer;
    await writeFile(opts.outputPath, buf);
  } finally {
    if (page) {
      await page.close().catch(() => undefined);
    }
    await pooled.close();
  }
}

// ── Internals ──────────────────────────────────────────────────────────────

function buildSlideUrl(canonical: string, oneBasedIdx: number): string {
  const u = new URL(canonical);
  u.searchParams.set("start", "false");
  u.searchParams.set("loop", "false");
  u.searchParams.set("delayms", "60000");
  u.searchParams.set("slide", String(oneBasedIdx));
  return u.toString();
}

/**
 * Wartet bis das eigentliche Slide-SVG sichtbar ist und Fonts geladen
 * sind. Identische Logik wie in `lib/gslides/import.ts`, hier nochmal
 * inline weil der Worker-Renderer nicht von der Import-Lib abhängen soll
 * (vermeidet Bunny-Storage-Code-Pfade im Worker, die wir nicht brauchen).
 */
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
): Record<string, string> {
  const out: Record<string, string> = {};
  // Wir haben zwei Quellen:
  //   a) `detectedPlaceholders` aus dem Segment (Cache vom Import)
  //   b) Keys, die ggf. erst NACH dem letzten Import in die Slide kamen
  //      → die fängt der Walker im Browser ab, weil er per Regex sucht.
  //      Wir wollen aber auch hier vorbereitete Werte haben. Daher
  //      reichen wir zusätzlich alle Mapping-Keys aus dem Run mit ein.
  const keys = new Set<string>(detectedKeys ?? []);
  if (mapping) {
    for (const k of Object.keys(mapping)) keys.add(k);
  }
  for (const k of leadData ? Object.keys(leadData) : []) keys.add(k);
  for (const key of Array.from(keys)) {
    if (!key) continue;
    try {
      const v = substitute(`{{${key}}}`, leadData, mapping, "double-brace");
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
