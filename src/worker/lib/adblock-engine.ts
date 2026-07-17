import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  PuppeteerBlocker,
  ENGINE_VERSION,
  type BlockingContext,
} from "@ghostery/adblocker-puppeteer";
import type { Page } from "puppeteer-core";

/**
 * Schicht 1 des Clean-Render-Systems: Netzwerk- und Cosmetic-Blocking über
 * kuratierte Filterlisten. Blockt Cookie-Banner, Newsletter-Popups und
 * sonstige Annoyances (inkl. Klaviyo-Popups), bevor sie überhaupt laden.
 *
 * - EasyList Cookie (fanboy-cookiemonster): Cookie-/Consent-Banner
 * - Fanboy Annoyance: Newsletter-Popups, Social-Widgets, Chat-Bubbles
 *
 * Die Engine wird einmal pro Worker-Prozess gebaut und auf Disk gecacht
 * (Kaltstart ohne Netz nutzt den Cache; ganz ohne Cache und Netz läuft das
 * Rendering ungeblockt weiter — Schichten 0/2/3 fangen dann auf).
 */

const FILTER_LISTS = [
  "https://secure.fanboy.co.nz/fanboy-cookiemonster.txt",
  "https://secure.fanboy.co.nz/fanboy-annoyance.txt",
];

const CACHE_FILE = path.join(
  os.tmpdir(),
  `vc-adblocker-engine-v${ENGINE_VERSION}.bin`,
);

/** Cache gilt 7 Tage, danach werden die Listen neu geladen. */
const CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

let enginePromise: Promise<PuppeteerBlocker | null> | null = null;

async function buildEngine(): Promise<PuppeteerBlocker | null> {
  // 1. Frischen Disk-Cache nutzen
  try {
    const stat = await fs.stat(CACHE_FILE);
    if (Date.now() - stat.mtimeMs < CACHE_MAX_AGE_MS) {
      const buf = await fs.readFile(CACHE_FILE);
      const engine = PuppeteerBlocker.deserialize(new Uint8Array(buf));
      console.log(`[adblock] engine loaded from cache (${buf.length} bytes)`);
      return engine;
    }
  } catch {
    // kein Cache — weiter zum Download
  }

  // 2. Listen laden und Engine bauen
  try {
    const engine = await PuppeteerBlocker.fromLists(fetch, FILTER_LISTS, {
      enableCompression: true,
      loadNetworkFilters: true,
      loadCosmeticFilters: true,
    });
    try {
      const serialized = engine.serialize();
      await fs.writeFile(CACHE_FILE, Buffer.from(serialized));
      console.log(`[adblock] engine built + cached (${serialized.length} bytes)`);
    } catch (err) {
      console.warn(
        `[adblock] cache write failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    return engine;
  } catch (err) {
    console.warn(
      `[adblock] list download failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // 3. Notnagel: abgelaufenen Cache trotzdem nutzen
  try {
    const buf = await fs.readFile(CACHE_FILE);
    const engine = PuppeteerBlocker.deserialize(new Uint8Array(buf));
    console.log(`[adblock] engine loaded from STALE cache (${buf.length} bytes)`);
    return engine;
  } catch {
    console.warn("[adblock] no engine available — rendering without blocker");
    return null;
  }
}

/** Engine-Singleton. Nie throwend — bei Fehlern null. */
export function getAdblockEngine(): Promise<PuppeteerBlocker | null> {
  if (!enginePromise) enginePromise = buildEngine();
  return enginePromise;
}

/**
 * Aktiviert Blocking auf einer Page (vor goto aufrufen). Gibt eine
 * disable-Funktion zurück; bei Fehlern (z. B. Konflikt mit bestehender
 * Request-Interception) wird ohne Blocker weitergemacht.
 */
export async function enableAdblock(page: Page): Promise<() => Promise<void>> {
  const engine = await getAdblockEngine();
  if (!engine) return async () => {};
  try {
    // PuppeteerBlocker ist gegen "puppeteer" typisiert, wir nutzen
    // puppeteer-core — strukturell identische Page.
    const ctx: BlockingContext = await engine.enableBlockingInPage(
      page as unknown as Parameters<PuppeteerBlocker["enableBlockingInPage"]>[0],
    );
    return async () => {
      try {
        await ctx.disable();
      } catch {
        // Page evtl. schon geschlossen
      }
    };
  } catch (err) {
    console.warn(
      `[adblock] enableBlockingInPage failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    return async () => {};
  }
}
