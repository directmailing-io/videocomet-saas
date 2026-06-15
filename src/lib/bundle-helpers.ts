/**
 * Hilfsfunktionen für den Multi-Run Bulk-Export
 * (`POST /api/runs/bulk-export`).
 *
 * Drei Aufgaben:
 *   1. `slugifyRunName(name)`        — Datei-/Ordner-tauglicher Slug, der den
 *                                       Run-Namen menschlich erkennbar haelt.
 *   2. `buildBundleSheetName(...)`   — Excel-Sheet-Name (max. 31 Zeichen,
 *                                       behaelt das `-Bundle-NNN`-Tail).
 *   3. `mergePdfsInBundle(leads,…)`  — paralleler Download (Semaphore) +
 *                                       pdf-lib Merge, gibt einen `Uint8Array`
 *                                       zurueck plus die Lead-Liste der
 *                                       tatsaechlich enthaltenen Eintraege.
 *
 * Die Funktionen sind bewusst Endpoint-frei (keine NextRequest-Abhaengigkeit),
 * damit sie sich auch ausserhalb der Route nutzen + testen lassen.
 */

import type { Lead } from "@/lib/db/queries/leads";

/**
 * Slugifiziert den Run-Namen fuer Dateinamen + ZIP-Pfade. Umlaute werden
 * transliteriert, alles andere auf `[a-z0-9-]` zusammengeklappt. Keine
 * Trailing-/Leading-Hyphens, max. 60 Zeichen. Leerer Input ergibt `"run"`,
 * damit das Datei-Naming-Schema stets greift.
 */
export function slugifyRunName(name: string): string {
  const translit: Record<string, string> = {
    ä: "ae",
    ö: "oe",
    ü: "ue",
    ß: "ss",
    Ä: "Ae",
    Ö: "Oe",
    Ü: "Ue",
    à: "a",
    á: "a",
    â: "a",
    ã: "a",
    å: "a",
    è: "e",
    é: "e",
    ê: "e",
    ë: "e",
    ì: "i",
    í: "i",
    î: "i",
    ï: "i",
    ò: "o",
    ó: "o",
    ô: "o",
    õ: "o",
    ù: "u",
    ú: "u",
    û: "u",
    ñ: "n",
    ç: "c",
  };
  let s = (name ?? "").trim();
  if (!s) return "run";
  s = s.replace(/[äöüßÄÖÜàáâãåèéêëìíîïòóôõùúûñç]/g, (c) => translit[c] ?? c);
  s = s.toLowerCase();
  s = s.replace(/[^a-z0-9]+/g, "-");
  s = s.replace(/^-+|-+$/g, "");
  s = s.slice(0, 60).replace(/-+$/g, "");
  return s || "run";
}

/**
 * Excel limitiert Sheet-Namen auf 31 Zeichen. Unser Bundle-Tail
 * (`-Bundle-NNN`) ist 11 Zeichen lang und MUSS erhalten bleiben, damit der
 * Anwender Sheet ↔ PDF-Datei eindeutig zuordnen kann.
 *
 * Wenn `<slug>-Bundle-NNN` ≤ 31, geben wir es unveraendert zurueck. Sonst
 * kuerzen wir den Slug-Praefix so, dass das Tail komplett bleibt.
 *
 * Excel verbietet ausserdem die Zeichen `: \ / ? * [ ]` — die werden im
 * Slug bereits weggefiltert; defensiv ersetzen wir sie hier nochmal durch
 * `_`, falls jemand einen anderen Slug uebergibt.
 */
export function buildBundleSheetName(
  runSlug: string,
  bundleIndex: number,
): string {
  const tail = `-Bundle-${String(bundleIndex).padStart(3, "0")}`;
  const cleanedSlug = runSlug.replace(/[:\\/?*[\]]/g, "_");
  const maxSlugLen = Math.max(1, 31 - tail.length);
  const prefix = cleanedSlug.slice(0, maxSlugLen).replace(/-+$/g, "") || "run";
  return `${prefix}${tail}`;
}

/**
 * Garantiert eindeutige Ordner-/Sheet-Namen, wenn zwei Run-Namen zu demselben
 * Slug-Praefix kollabieren wuerden. Erster Treffer behaelt den Slug; jeder
 * weitere wird mit `-2`, `-3`, … suffixiert. Wir muessen die Hash-Set-Ent-
 * scheidung im Caller treffen, weil der gleiche Slug auch in der Excel-
 * Sheet-Liste auftauchen muss.
 */
export function uniqueSlug(taken: Set<string>, candidate: string): string {
  if (!taken.has(candidate)) {
    taken.add(candidate);
    return candidate;
  }
  let n = 2;
  // Bestaendig kollidierende Slugs (Run-A vs. Run-A-2) lassen wir mit
  // ueberlauf von 999 abbrechen; in der Praxis duerfte das nie greifen.
  while (n < 1000) {
    const suffixed = `${candidate}-${n}`;
    if (!taken.has(suffixed)) {
      taken.add(suffixed);
      return suffixed;
    }
    n += 1;
  }
  // Letzter Ausweg: Epoch-Suffix.
  const fallback = `${candidate}-${Date.now().toString(36).slice(-5)}`;
  taken.add(fallback);
  return fallback;
}

/**
 * Klein-Semaphore: `n` parallel laufende Tasks, alle anderen warten. Wird
 * im Bundle-Download benutzt, damit wir bei 500 Lead-PDFs nicht 500
 * `fetch()`-Connections gleichzeitig aufmachen (Bunny ist nett, aber
 * unbegrenzte Concurrency ist trotzdem unfreundlich).
 */
async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const runners: Promise<void>[] = [];
  const slots = Math.max(1, Math.min(concurrency, items.length));
  for (let s = 0; s < slots; s += 1) {
    runners.push(
      (async () => {
        while (true) {
          const i = next;
          next += 1;
          if (i >= items.length) return;
          results[i] = await worker(items[i] as T, i);
        }
      })(),
    );
  }
  await Promise.all(runners);
  return results;
}

/**
 * Ergebnis pro Lead im Download-Schritt. `bytes = null` heisst: PDF nicht
 * abrufbar (404, Body-Error, etc.) — der Lead wird im Excel mit Status
 * "PDF nicht verfuegbar" markiert und NICHT in die merged PDF aufgenommen.
 */
interface LoadedLeadPdf {
  lead: Lead;
  bytes: Uint8Array | null;
  errorMessage: string | null;
}

/**
 * Laedt + merged die PDFs einer Bundle-Charge.
 *
 * - PDFs werden parallel (max. `concurrency`) per `fetch(lead.pdfUrl)`
 *   geladen — Bunny ignoriert den `?v=...`-Cache-Buster im Path, deshalb
 *   muessen wir den Query-String NICHT abschneiden; die Datei wird auch
 *   mit Query zurueckgeliefert.
 * - Fehlgeschlagene Downloads (HTTP != 2xx, Body-Throw) bleiben im
 *   Result-Array (mit `bytes = null` + `errorMessage`), werden aber im
 *   Merge uebersprungen.
 * - Der Merge nutzt pdf-lib — identisch zum bestehenden Single-Run-PDF-
 *   Bundle-Endpoint, damit Leads, die dort funktionieren, hier nicht
 *   ploetzlich brechen.
 *
 * Returns: `{ pdfBytes, includedLeads, perLeadResults }`.
 *   `perLeadResults` ist die vollstaendige Bundle-Liste in Eingangs-
 *   Reihenfolge — die Excel-Schicht braucht das, um auch fehlgeschlagene
 *   Eintraege zeilenkorrekt zu zeigen.
 */
export async function mergePdfsInBundle(
  bundleLeads: readonly Lead[],
  concurrency = 8,
): Promise<{
  pdfBytes: Uint8Array;
  includedLeads: Lead[];
  perLeadResults: Array<{ lead: Lead; included: boolean; reason: string | null }>;
}> {
  // pdf-lib via dynamic import — gleicher Grund wie im Single-Run-Endpoint:
  // Next-Webpack mangled sonst die CJS-Default-Resolution.
  const { PDFDocument } = await import("pdf-lib");

  const loaded = await mapWithConcurrency<Lead, LoadedLeadPdf>(
    bundleLeads,
    concurrency,
    async (lead) => {
      if (!lead.pdfUrl) {
        return { lead, bytes: null, errorMessage: "kein pdf_url" };
      }
      try {
        // Wir uebergeben die URL 1:1 (inkl. eventuelles `?v=…`-Cache-Suffix).
        // Bunny routet ueber den Pfad-Teil und ignoriert den Query-String;
        // das Cache-Suffix dient nur dem Browser/CDN-Invalidation und stoert
        // den Server-zu-Server-Fetch nicht.
        const res = await fetch(lead.pdfUrl);
        if (!res.ok) {
          return {
            lead,
            bytes: null,
            errorMessage: `HTTP ${res.status}`,
          };
        }
        const buf = new Uint8Array(await res.arrayBuffer());
        return { lead, bytes: buf, errorMessage: null };
      } catch (err) {
        return {
          lead,
          bytes: null,
          errorMessage: err instanceof Error ? err.message : "fetch error",
        };
      }
    },
  );

  const merged = await PDFDocument.create();
  const includedLeads: Lead[] = [];
  const perLeadResults: Array<{
    lead: Lead;
    included: boolean;
    reason: string | null;
  }> = [];

  for (const item of loaded) {
    if (!item.bytes) {
      // eslint-disable-next-line no-console
      console.warn(
        `[bulk-export] skip lead=${item.lead.id} reason="${item.errorMessage}"`,
      );
      perLeadResults.push({
        lead: item.lead,
        included: false,
        reason: item.errorMessage,
      });
      continue;
    }
    try {
      const src = await PDFDocument.load(item.bytes, { ignoreEncryption: true });
      const pages = await merged.copyPages(src, src.getPageIndices());
      for (const p of pages) merged.addPage(p);
      includedLeads.push(item.lead);
      perLeadResults.push({ lead: item.lead, included: true, reason: null });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "pdf parse error";
      // eslint-disable-next-line no-console
      console.warn(`[bulk-export] merge fail lead=${item.lead.id}: ${msg}`);
      perLeadResults.push({
        lead: item.lead,
        included: false,
        reason: msg,
      });
    }
  }

  const pdfBytes = await merged.save();
  return { pdfBytes, includedLeads, perLeadResults };
}

/**
 * Splittet eine Lead-Liste in N-grosse Chunks. Der letzte Chunk darf kuerzer
 * sein. Trivial, aber benannt + zentralisiert weil der Endpoint sonst die
 * Off-by-One-Fallen produziert haette (Slice vs. Index).
 */
export function chunkBy<T>(items: readonly T[], size: number): T[][] {
  if (size <= 0) throw new Error("chunkBy: size muss > 0 sein");
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}
