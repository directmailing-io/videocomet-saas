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

// ── Bundle-Sortierung ──────────────────────────────────────────────────────

/**
 * Sortierung der Leads VOR dem Bündeln/Chunken. "original" = Import-
 * Reihenfolge (rowIndex). Alle anderen sortieren nach Lead-Datenfeldern.
 *
 * WICHTIG (Kuvertier-Garantie): Die Sortierung muss deterministisch sein —
 * Brief- und Umschlag-Export laufen als getrennte Requests über dieselbe
 * Lead-Liste und müssen exakt dieselbe Reihenfolge produzieren, damit
 * Brief N immer in Umschlag N passt. Deshalb enden alle Vergleichsketten
 * in `rowIndex` + `id` als eindeutigem Tiebreaker.
 */
export type BundleSort = "original" | "firstName" | "lastName" | "zip" | "city";

export const BUNDLE_SORT_VALUES = [
  "original",
  "firstName",
  "lastName",
  "zip",
  "city",
] as const satisfies readonly BundleSort[];

/**
 * Case-insensitives Feld-Lookup auf heterogenen CSV-Spaltennamen (deutsch/
 * englisch/snake_case/Umlaut-encodiert). Alphanumerisch normalisiert,
 * erster nicht-leerer Treffer gewinnt. Gleiche Logik wie die Adressliste
 * des Bulk-Exports — Sortierung und Excel-Anzeige sehen dieselben Werte.
 */
function lookupLeadField(
  data: Record<string, unknown> | null | undefined,
  candidates: readonly string[],
): string {
  if (!data) return "";
  const norm = (s: string) =>
    s
      .toLowerCase()
      .replace(/ä/g, "a")
      .replace(/ö/g, "o")
      .replace(/ü/g, "u")
      .replace(/ß/g, "s")
      .replace(/[^a-z0-9]/g, "");
  const map = new Map<string, string>();
  for (const [k, v] of Object.entries(data)) {
    if (typeof v === "string" && v.trim() !== "") {
      const nk = norm(k);
      if (!map.has(nk)) map.set(nk, v.trim());
    }
  }
  for (const cand of candidates) {
    const hit = map.get(norm(cand));
    if (hit) return hit;
  }
  return "";
}

const FIELD_CANDIDATES: Record<
  Exclude<BundleSort, "original">,
  readonly string[]
> = {
  firstName: ["Vorname", "firstName", "first_name"],
  lastName: ["Nachname", "lastName", "last_name", "Name"],
  zip: ["PLZ", "Postleitzahl", "zip", "zipCode", "zip_code", "postcode", "postal_code"],
  city: ["Stadt", "city", "Ort", "town"],
};

/** Sekundär-Schlüssel pro Sortierung — hält gleiche Werte sinnvoll gruppiert. */
const SORT_KEY_CHAIN: Record<
  Exclude<BundleSort, "original">,
  readonly Exclude<BundleSort, "original">[]
> = {
  firstName: ["firstName", "lastName"],
  lastName: ["lastName", "firstName"],
  zip: ["zip", "city", "lastName", "firstName"],
  city: ["city", "zip", "lastName", "firstName"],
};

/**
 * Sortiert eine Lead-Liste für den Bundle-Export. Gibt eine NEUE Liste
 * zurück (Input bleibt unangetastet).
 *
 * - de-Collation, case-insensitiv, `numeric: true` (PLZ "01067" < "10115",
 *   aber auch "Haus 2" < "Haus 10")
 * - Leads OHNE Wert im Sortierfeld landen ans Ende (nicht zwischen die
 *   sortierten — sonst zerreißt es die Stapel im Lettershop)
 * - Deterministisch bei Gleichstand: rowIndex, dann Lead-ID
 */
export function sortLeadsForBundle(
  leads: readonly Lead[],
  sort: BundleSort,
): Lead[] {
  const out = [...leads];
  if (sort === "original") return out;

  const collator = new Intl.Collator("de", {
    sensitivity: "base",
    numeric: true,
  });
  const chain = SORT_KEY_CHAIN[sort];

  // Sortierwerte einmal pro Lead vorberechnen (nicht in jedem Vergleich).
  const keys = new Map<Lead, string[]>();
  for (const lead of out) {
    keys.set(
      lead,
      chain.map((field) =>
        lookupLeadField(
          lead.data as Record<string, unknown> | null,
          FIELD_CANDIDATES[field],
        ),
      ),
    );
  }

  out.sort((a, b) => {
    const ka = keys.get(a) ?? [];
    const kb = keys.get(b) ?? [];
    // Leads ohne Wert im PRIMÄR-Feld immer ans Ende.
    const aEmpty = (ka[0] ?? "") === "";
    const bEmpty = (kb[0] ?? "") === "";
    if (aEmpty !== bEmpty) return aEmpty ? 1 : -1;
    for (let i = 0; i < chain.length; i += 1) {
      const cmp = collator.compare(ka[i] ?? "", kb[i] ?? "");
      if (cmp !== 0) return cmp;
    }
    if (a.rowIndex !== b.rowIndex) return a.rowIndex - b.rowIndex;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  return out;
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
  source: "letter" | "envelope" = "letter",
): Promise<{
  pdfBytes: Uint8Array;
  includedLeads: Lead[];
  perLeadResults: Array<{ lead: Lead; included: boolean; reason: string | null }>;
}> {
  // pdf-lib via dynamic import — gleicher Grund wie im Single-Run-Endpoint:
  // Next-Webpack mangled sonst die CJS-Default-Resolution.
  const { PDFDocument } = await import("pdf-lib");

  const pickUrl = (lead: Lead): string | null =>
    source === "envelope" ? lead.envelopePdfUrl : lead.pdfUrl;
  const missingLabel = source === "envelope" ? "kein envelope_pdf_url" : "kein pdf_url";

  const loaded = await mapWithConcurrency<Lead, LoadedLeadPdf>(
    bundleLeads,
    concurrency,
    async (lead) => {
      const url = pickUrl(lead);
      if (!url) {
        return { lead, bytes: null, errorMessage: missingLabel };
      }
      try {
        // Wir uebergeben die URL 1:1 (inkl. eventuelles `?v=…`-Cache-Suffix).
        // Bunny routet ueber den Pfad-Teil und ignoriert den Query-String;
        // das Cache-Suffix dient nur dem Browser/CDN-Invalidation und stoert
        // den Server-zu-Server-Fetch nicht.
        const res = await fetch(url);
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
