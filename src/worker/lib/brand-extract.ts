/**
 * Brand-Extraktion — Puppeteer-Teil (Konzept v3, 3.2).
 *
 * Lädt die Kunden-Website im Browser-Pool (incognito Context), sammelt in
 * EINEM page.evaluate alle Roh-Daten (Buttons, Hintergründe, Fonts,
 * Logo-Kandidaten) und übergibt sie an die reine Auswertung in
 * `src/lib/brand-extract/analyze.ts` (dort vitest-getestet).
 *
 * Fehlerbild (Timeout, Cloudflare-Block, leere Seite): wirft
 * `BrandExtractFailedError` mit einer freundlichen deutschen Meldung —
 * der Processor schreibt sie 1:1 als `error` in den Redis-Hash.
 */

import type { Page } from "puppeteer-core";
import { assertUrlIsSafe } from "@/lib/media-urls/ssrf-guard";
import {
  analyzeExtraction,
  isEmptyExtraction,
  type BrandAnalysis,
  type RawExtraction,
  type RawLogoCandidate,
} from "@/lib/brand-extract/analyze";
import { getContext } from "./browser-pool";

const GOTO_TIMEOUT_MS = 15_000;
const GOTO_FALLBACK_TIMEOUT_MS = 10_000;
const VIEWPORT = { width: 1280, height: 900 };
/** Kurze Settle-Zeit nach dem Load, damit Webfonts/CSS-Transitions stehen. */
const SETTLE_MS = 800;
/**
 * Realistischer Desktop-UA: der Default enthält "HeadlessChrome" und wird
 * von vielen Bot-Blockern (Cloudflare, Wordfence) sofort abgewiesen.
 */
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

export type BrandExtractPhase = "loading" | "analyzing";

/** Freundlicher Abbruch — Message ist für den User gedacht. */
export class BrandExtractFailedError extends Error {
  constructor(url: string, public readonly detail: string) {
    super(friendlyExtractionError(url));
    this.name = "BrandExtractFailedError";
  }
}

/** „Wir konnten deine-url.de nicht analysieren. …" */
export function friendlyExtractionError(url: string): string {
  let host = url;
  try {
    host = new URL(url).hostname;
  } catch {
    // Roh-URL anzeigen — besser als gar kein Bezug.
  }
  return `Wir konnten ${host} nicht analysieren. Du kannst deinen Look auch selbst festlegen.`;
}

/**
 * Läuft komplett im Browser-Kontext (page.evaluate) — muss self-contained
 * bleiben (keine Closures über Node-Variablen).
 */
function collectRawInBrowser(): RawExtraction {
  const MAX_BUTTONS = 200;

  const buttonEls = Array.from(
    document.querySelectorAll(
      'button, [role="button"], input[type="submit"], a[class*="btn" i]',
    ),
  ).slice(0, MAX_BUTTONS);
  const buttons = buttonEls.map((el) => {
    const cs = window.getComputedStyle(el);
    return {
      backgroundColor: cs.backgroundColor,
      color: cs.color,
      borderRadius: cs.borderRadius,
      boxShadow: cs.boxShadow,
    };
  });

  const backgrounds: string[] = [
    window.getComputedStyle(document.body).backgroundColor,
  ];
  const containers = Array.from(
    document.querySelectorAll("section, header, main, div"),
  )
    .filter((el) => {
      const he = el as HTMLElement;
      // Nur Großcontainer: nahezu volle Breite + nennenswerte Höhe.
      return (
        he.offsetWidth >= window.innerWidth * 0.8 && he.offsetHeight >= 160
      );
    })
    .slice(0, 10);
  for (const c of containers) {
    backgrounds.push(window.getComputedStyle(c).backgroundColor);
  }

  const headingEl = document.querySelector("h1") ?? document.querySelector("h2");
  const paragraphEl = document.querySelector("p");
  const headingFontFamily = headingEl
    ? window.getComputedStyle(headingEl).fontFamily
    : "";
  const bodyFontFamily = paragraphEl
    ? window.getComputedStyle(paragraphEl).fontFamily
    : "";

  // ── Logo-Kandidaten ──────────────────────────────────────────────────
  const logoCandidates: RawLogoCandidate[] = [];
  const toAbsolute = (u: string | null): string | null => {
    if (!u) return null;
    try {
      const abs = new URL(u, window.location.href).href;
      return abs.indexOf("http") === 0 ? abs : null;
    } catch {
      return null;
    }
  };
  const isSvgUrl = (u: string): boolean => /\.svg([?#]|$)/i.test(u);
  const pushImage = (img: HTMLImageElement): void => {
    const url = toAbsolute(img.currentSrc || img.getAttribute("src"));
    if (!url) return;
    logoCandidates.push({
      url,
      width: img.naturalWidth > 0 ? img.naturalWidth : undefined,
      height: img.naturalHeight > 0 ? img.naturalHeight : undefined,
      kind: isSvgUrl(url) ? "svg" : "header-img",
    });
  };

  document
    .querySelectorAll<HTMLImageElement>("header img, nav img")
    .forEach((img) => pushImage(img));
  document
    .querySelectorAll<HTMLImageElement>(
      'img[src*="logo" i], img[alt*="logo" i]',
    )
    .forEach((img) => pushImage(img));

  const og = document.querySelector('meta[property="og:image"]');
  const ogUrl = toAbsolute(og ? og.getAttribute("content") : null);
  if (ogUrl) {
    logoCandidates.push({
      url: ogUrl,
      kind: isSvgUrl(ogUrl) ? "svg" : "og",
    });
  }

  document
    .querySelectorAll<HTMLLinkElement>('link[rel*="icon" i]')
    .forEach((link) => {
      const url = toAbsolute(link.getAttribute("href"));
      if (!url) return;
      // sizes="32x32" → Maße mitnehmen, hilft der Sortierung.
      const sizes = (link.getAttribute("sizes") ?? "").split("x");
      const w = parseInt(sizes[0] ?? "", 10);
      const h = parseInt(sizes[1] ?? "", 10);
      logoCandidates.push({
        url,
        width: Number.isFinite(w) && w > 0 ? w : undefined,
        height: Number.isFinite(h) && h > 0 ? h : undefined,
        kind: isSvgUrl(url) ? "svg" : "icon",
      });
    });

  const bodyText = document.body ? document.body.innerText || "" : "";

  return {
    buttons,
    backgrounds,
    headingFontFamily,
    bodyFontFamily,
    logoCandidates,
    textLength: bodyText.trim().length,
  };
}

/**
 * Website-URL → BrandAnalysis. SSRF-Guard vor der Navigation, incognito
 * Context wird IMMER geschlossen. `onPhase` meldet den Fortschritt
 * ("loading" → "analyzing") für den Redis-Status.
 */
export async function runBrandExtraction(
  url: string,
  onPhase?: (phase: BrandExtractPhase) => Promise<void> | void,
): Promise<BrandAnalysis> {
  // Defense-in-Depth: auch der Worker prüft direkt vor der Navigation.
  try {
    await assertUrlIsSafe(url);
  } catch (err) {
    throw new BrandExtractFailedError(
      url,
      err instanceof Error ? err.message : String(err),
    );
  }

  if (onPhase) await onPhase("loading");

  const ctx = await getContext();
  let page: Page | null = null;
  try {
    page = await ctx.context.newPage();
    await page.setViewport({
      width: VIEWPORT.width,
      height: VIEWPORT.height,
      deviceScaleFactor: 1,
    });
    await page.setUserAgent(USER_AGENT);
    await page.setExtraHTTPHeaders({ "Accept-Language": "de-DE,de;q=0.9,en;q=0.7" });

    try {
      await page.goto(url, {
        waitUntil: "networkidle2",
        timeout: GOTO_TIMEOUT_MS,
      });
    } catch (e) {
      // Seiten mit Dauer-Streams (Analytics, Chat-Widgets) erreichen nie
      // networkidle2 — domcontentloaded reicht dann für computed styles.
      try {
        await page.goto(url, {
          waitUntil: "domcontentloaded",
          timeout: GOTO_FALLBACK_TIMEOUT_MS,
        });
      } catch {
        throw e instanceof Error ? e : new Error(String(e));
      }
    }
    await new Promise((r) => setTimeout(r, SETTLE_MS));

    if (onPhase) await onPhase("analyzing");

    // tsx/esbuild (keepNames) fügt in die serialisierte Funktion `__name()`-
    // Helper-Aufrufe ein, die es im Browser-Kontext nicht gibt → vorher
    // shimmen, sonst crasht JEDE Extraktion mit "__name is not defined".
    await page.evaluate("window.__name = window.__name || ((f) => f)");
    const raw = await page.evaluate(collectRawInBrowser);

    if (isEmptyExtraction(raw)) {
      throw new BrandExtractFailedError(
        url,
        "empty extraction (Cloudflare-Block oder leere Seite)",
      );
    }

    return analyzeExtraction(raw, url);
  } catch (err) {
    if (err instanceof BrandExtractFailedError) throw err;
    throw new BrandExtractFailedError(
      url,
      err instanceof Error ? err.message : String(err),
    );
  } finally {
    if (page) await page.close().catch(() => undefined);
    await ctx.close();
  }
}
