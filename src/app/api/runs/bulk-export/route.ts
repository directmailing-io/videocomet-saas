export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { Readable } from "node:stream";
import { PassThrough } from "node:stream";
import * as XLSX from "xlsx";
import { z } from "zod";
import { requireUserApi } from "@/lib/auth-guard";
import { getRun } from "@/lib/db/queries/runs";
import { getCampaign } from "@/lib/db/queries/campaigns";
import { getUserDomain } from "@/lib/db/queries/user-domains";
import {
  getCompletedLeadsForBundle,
  type Lead,
} from "@/lib/db/queries/leads";
import { buildLeadPublicUrl } from "@/lib/lead-public-url";
import {
  buildBundleSheetName,
  chunkBy,
  mergePdfsInBundle,
  slugifyRunName,
  sortLeadsForBundle,
  uniqueSlug,
} from "@/lib/bundle-helpers";
import type ArchiverNs from "archiver";

/**
 * POST /api/runs/bulk-export
 *
 * Sammelt die fertigen Lead-PDFs MEHRERER Runs in eine ZIP-Datei:
 *
 *   <baseName>/
 *     <run-slug-1>/
 *       <run-slug-1>-Bundle-001.pdf   (Leads 1..pdfsPerFile)
 *       <run-slug-1>-Bundle-002.pdf   (Leads pdfsPerFile+1..)
 *       ...
 *     <run-slug-2>/
 *       ...
 *     Adressliste.xlsx                (1 Sheet pro Bundle-Datei in derselben
 *                                      Reihenfolge wie die PDF-Seiten)
 *
 * Streaming via `archiver`. Die Excel-Datei selbst wird in-Memory gebaut
 * (xlsx ist nicht streaming-faehig, bei 50 Runs × 500 Leads aber unkritisch).
 */

const bodySchema = z.object({
  runIds: z
    .array(z.string().uuid())
    .min(1, "Mindestens ein Run wird benoetigt.")
    .max(20, "Maximal 20 Runs pro Bulk-Export."),
  pdfsPerFile: z
    .number()
    .int()
    .min(1, "PDFs pro Datei muss >= 1 sein.")
    .max(1000, "PDFs pro Datei muss <= 1000 sein."),
  baseName: z
    .string()
    .max(80)
    .optional(),
  /** Was landet im ZIP: nur Briefe (Default) oder nur Umschläge. */
  exportType: z.enum(["letters", "envelopes"]).default("letters"),
  /**
   * Spaltenname aus den Lead-Daten, nach dem VOR dem Bündeln sortiert wird
   * (User wählt aus den tatsächlichen Spalten seiner Liste). Fehlt der
   * Wert → Original-Reihenfolge. Deterministisch (Tiebreaker rowIndex → id),
   * damit getrennte Brief-/Umschlag-Exporte mit derselben Sortierung exakt
   * dieselbe Reihenfolge produzieren (Kuvertier-Garantie).
   */
  sortBy: z.string().trim().min(1).max(200).optional(),
});

// Adressliste-Spalten (in dieser Reihenfolge!). `#` wird pro Sheet als
// 1-basierter Index innerhalb des Bundles befuellt.
const ADRESSLISTE_HEADER = [
  "#",
  "Vorname",
  "Nachname",
  "Anrede",
  "Firma",
  "Position",
  "E-Mail",
  "Telefon",
  "Strasse",
  "PLZ",
  "Stadt",
  "Land",
  "Webseite",
  "PageURL",
  "Run",
  "Status",
] as const;

// Spaltenbreiten fuer die Adressliste — grobe Schaetzwerte, fuer die meisten
// Werte ausreichend, ohne dass wir pro Sheet measuren muessten.
const ADRESSLISTE_COL_WIDTHS = [
  4, 16, 18, 8, 22, 18, 26, 16, 22, 8, 16, 12, 26, 36, 18, 18,
];

/**
 * Case-insensitives Feld-Lookup auf den Lead-Daten. Die CSVs kommen mit
 * heterogenen Feldnamen (deutsch, english, snake_case, encoded-Umlaut), und
 * der Export soll auf allen Varianten konsistent rendern.
 *
 * Vergleich: alphanumerisch normalisiert (Bindestriche/Underscores/Spaces +
 * Umlaute werden ignoriert). Erster nicht-leerer Wert gewinnt.
 */
function lookupField(
  data: Record<string, string>,
  candidates: readonly string[],
): string {
  const norm = (s: string) =>
    s
      .toLowerCase()
      .replace(/ä/g, "a")
      .replace(/ö/g, "o")
      .replace(/ü/g, "u")
      .replace(/ß/g, "s")
      .replace(/[^a-z0-9]/g, "");
  // Pre-build normalisierte Lookup-Map.
  const map = new Map<string, string>();
  for (const [k, v] of Object.entries(data)) {
    if (typeof v === "string" && v.trim() !== "") {
      map.set(norm(k), v.trim());
    }
  }
  for (const cand of candidates) {
    const hit = map.get(norm(cand));
    if (hit) return hit;
  }
  return "";
}

interface RunRuntime {
  run: Awaited<ReturnType<typeof getRun>>;
  slug: string;
  customHostname: string | null;
}

interface BundleMeta {
  runName: string;
  runSlug: string;
  bundleFilename: string; // `<slug>-Bundle-NNN.pdf`
  sheetName: string;
  rows: string[][]; // ohne Header
  totalIncluded: number;
}

interface SkippedRun {
  runName: string;
  reason: string;
}

export async function POST(req: NextRequest) {
  const auth = await requireUserApi();
  if (!auth.ok) return auth.response;

  let body: z.infer<typeof bodySchema>;
  try {
    const json = await req.json();
    body = bodySchema.parse({
      runIds: Array.isArray(json?.runIds) ? json.runIds : [],
      pdfsPerFile: Number(json?.pdfsPerFile),
      baseName: typeof json?.baseName === "string" ? json.baseName : undefined,
      exportType: typeof json?.exportType === "string" ? json.exportType : undefined,
      sortBy: typeof json?.sortBy === "string" ? json.sortBy : undefined,
    });
  } catch (err) {
    return NextResponse.json(
      {
        error: "Ungültige Eingabe.",
        details: err instanceof Error ? err.message : null,
      },
      { status: 400 },
    );
  }

  // Tenant-Pruefung: ALLE Runs muessen dem authentifizierten User gehoeren.
  // `getRun()` filtert bereits auf `runs.user_id = userId` UND nicht-soft-
  // deleted; ein Fremd-Run wirft → wir antworten generisch mit 404.
  const uniqueRunIds = Array.from(new Set(body.runIds));
  const runs: Awaited<ReturnType<typeof getRun>>[] = [];
  try {
    for (const runId of uniqueRunIds) {
      const r = await getRun(runId, auth.user.id);
      runs.push(r);
    }
  } catch {
    return NextResponse.json(
      { error: "Mindestens eine Runde wurde nicht gefunden." },
      { status: 404 },
    );
  }

  const appUrl = process.env.APP_URL ?? "https://app.videocomet.de";

  // Pro Run die Custom-Domain (sofern vorhanden) holen. `getCampaign` ist
  // tenant-gesichert; ein Fehler hier laesst den Run als „kein Custom-Host"
  // durchgehen — entspricht dem Verhalten des Single-Run Lead-Exports.
  const runtimes: RunRuntime[] = [];
  const takenSlugs = new Set<string>();
  for (const run of runs) {
    const baseSlug = slugifyRunName(run.name);
    const slug = uniqueSlug(takenSlugs, baseSlug);
    let host: string | null = null;
    try {
      const campaign = await getCampaign(run.campaignId, auth.user.id);
      if (campaign.domainId) {
        const d = await getUserDomain(campaign.domainId, auth.user.id);
        if (d && d.status === "active") host = d.hostname;
      }
    } catch {
      // schweigend — Default-Domain fuer alle Leads dieses Runs.
    }
    runtimes.push({ run, slug, customHostname: host });
  }

  const today = new Date().toISOString().slice(0, 10);
  const baseName = sanitizeBaseName(body.baseName, `bulk-export-${today}`);
  const zipFilename = `${baseName}.zip`;

  // ── ZIP via JSZip (in-memory) ─────────────────────────────────────────
  // Wir hatten archiver-Streaming probiert, scheiterte am Next-Standalone-
  // Tracer (kette an Webpack-Bundle-Bugs + fehlenden Transitives bei jeder
  // Iteration). JSZip ist hier schon im Einsatz fuer /api/runs/[id]/pdf-
  // bundle, in-memory aber fuer die typische Customer-Last (< 2 GB ZIP)
  // unproblematisch. Kein Streaming, dafuer bullet-proof.
  const JSZipMod = (await import("jszip")) as unknown as {
    default?: typeof import("jszip");
  } & typeof import("jszip");
  const JSZip = JSZipMod.default ?? (JSZipMod as unknown as typeof import("jszip"));
  const zip = new JSZip();

  const bundleMetas: BundleMeta[] = [];
  const skipped: SkippedRun[] = [];

  const isEnvelope = body.exportType === "envelopes";
  const bundleKind = isEnvelope ? "Umschlag" : "Brief";
  const emptyReason = isEnvelope
    ? "Keine fertigen Leads mit Umschlag."
    : "Keine fertigen Leads mit Brief.";
  const bundleTag = isEnvelope ? "Umschlaege" : "Bundle";

  try {
    for (const rt of runtimes) {
      // Sortierung VOR dem Typ-Filter — Brief- und Umschlag-Export mit
      // derselben Sortierung liefern so garantiert dieselbe Reihenfolge.
      const allLeads = sortLeadsForBundle(
        await getCompletedLeadsForBundle(rt.run.id, auth.user.id),
        body.sortBy,
      );
      // Nur die Leads, die den gewählten Ausgabe-Typ tatsächlich haben —
      // sonst wird das Bundle mit „PDF nicht verfügbar"-Zeilen aufgeblasen.
      const leads = isEnvelope
        ? allLeads.filter((l) => Boolean(l.envelopePdfUrl))
        : allLeads.filter((l) => Boolean(l.pdfUrl));
      if (leads.length === 0) {
        skipped.push({ runName: rt.run.name, reason: emptyReason });
        continue;
      }
      const chunks = chunkBy(leads, body.pdfsPerFile);
      for (let i = 0; i < chunks.length; i += 1) {
        const chunk = chunks[i] as Lead[];
        const bundleNumber = i + 1;
        const bundleFilename = `${rt.slug}-${bundleTag}-${String(bundleNumber).padStart(3, "0")}.pdf`;
        const sheetName = buildBundleSheetName(rt.slug, bundleNumber);

        const { pdfBytes, perLeadResults } = await mergePdfsInBundle(
          chunk,
          8,
          isEnvelope ? "envelope" : "letter",
        );

        zip.file(
          `${baseName}/${rt.slug}/${bundleFilename}`,
          Buffer.from(pdfBytes),
        );

        const rows: string[][] = perLeadResults.map((r, idx) =>
          leadToRow(
            r.lead,
            idx + 1,
            rt,
            appUrl,
            r.included
              ? "OK"
              : `${bundleKind}-PDF nicht verfuegbar${r.reason ? ` (${r.reason})` : ""}`,
          ),
        );

        bundleMetas.push({
          runName: rt.run.name,
          runSlug: rt.slug,
          bundleFilename,
          sheetName,
          rows,
          totalIncluded: perLeadResults.filter((p) => p.included).length,
        });
      }
    }

    // ── Adressliste.xlsx bauen ────────────────────────────────────────
    const wb = XLSX.utils.book_new();

    if (skipped.length > 0) {
      const skippedHeader = ["Run", "Grund"];
      const wsSkipped = XLSX.utils.aoa_to_sheet([
        skippedHeader,
        ...skipped.map((s) => [s.runName, s.reason]),
      ]);
      wsSkipped["!cols"] = [{ wch: 32 }, { wch: 40 }];
      applyBoldHeader(wsSkipped, skippedHeader.length);
      appendSheetSafe(wb, wsSkipped, "Ausgelassen");
    }

    const usedSheetNames = new Set<string>();
    if (skipped.length > 0) usedSheetNames.add("Ausgelassen");
    for (const meta of bundleMetas) {
      const uniqueName = makeUniqueSheetName(usedSheetNames, meta.sheetName);
      const ws = XLSX.utils.aoa_to_sheet([
        [...ADRESSLISTE_HEADER],
        ...meta.rows,
      ]);
      ws["!cols"] = ADRESSLISTE_COL_WIDTHS.map((wch) => ({ wch }));
      applyBoldHeader(ws, ADRESSLISTE_HEADER.length);
      appendSheetSafe(wb, ws, uniqueName);
    }

    const overviewHeader = [
      "Run-Name",
      "Bundle-Datei",
      "Anzahl Leads",
      "Sheet-Name",
    ];
    const wsOverview = XLSX.utils.aoa_to_sheet([
      overviewHeader,
      ...bundleMetas.map((m) => [
        m.runName,
        m.bundleFilename,
        String(m.rows.length),
        m.sheetName,
      ]),
    ]);
    wsOverview["!cols"] = [{ wch: 28 }, { wch: 38 }, { wch: 14 }, { wch: 32 }];
    applyBoldHeader(wsOverview, overviewHeader.length);
    appendSheetSafe(wb, wsOverview, "Uebersicht");

    const xlsxBuffer = XLSX.write(wb, {
      type: "buffer",
      bookType: "xlsx",
    }) as Buffer;
    zip.file(`${baseName}/Adressliste.xlsx`, xlsxBuffer);

    const zipBuffer = await zip.generateAsync({
      type: "nodebuffer",
      compression: "DEFLATE",
      compressionOptions: { level: 6 },
    });

    return new NextResponse(new Blob([new Uint8Array(zipBuffer)]), {
      status: 200,
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${zipFilename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[bulk-export] build failure:", err);
    return NextResponse.json(
      {
        error: "Bulk-Export fehlgeschlagen.",
        details: err instanceof Error ? err.message : null,
      },
      { status: 500 },
    );
  }
}

/**
 * Render ein Lead-Row fuer die Adressliste. Liest Felder case-insensitive aus
 * `lead.data` (Vorname / Nachname / E-Mail / …) und baut die PageURL aus
 * `buildLeadPublicUrl` — Custom-Domain wenn aktiv, sonst Default-`/v/<slug>`.
 */
function leadToRow(
  lead: Lead,
  positionInBundle: number,
  rt: RunRuntime,
  appUrl: string,
  status: string,
): string[] {
  const data = (lead.data ?? {}) as Record<string, string>;
  const vorname = lookupField(data, ["Vorname", "firstName", "first_name"]);
  const nachname = lookupField(data, [
    "Nachname",
    "lastName",
    "last_name",
    "Name",
  ]);
  const anrede = lookupField(data, ["Anrede", "salutation"]);
  const firma = lookupField(data, ["Firma", "company", "companyName"]);
  const position = lookupField(data, ["Position", "role"]);
  const email = lookupField(data, ["E-Mail", "Email", "email", "eMail"]);
  const telefon = lookupField(data, ["Telefon", "phone", "Tel"]);
  const strasse = lookupField(data, ["Strasse", "Straße", "street"]);
  const plz = lookupField(data, ["PLZ", "Postleitzahl", "zip"]);
  const stadt = lookupField(data, ["Stadt", "city", "Ort"]);
  const land = lookupField(data, ["Land", "country"]);
  const webseite = lookupField(data, ["Webseite", "website", "Website", "url"]);

  // PageURL: wir respektieren `lead.domainId`, NICHT pauschal den Campaign-
  // Host — Leads koennen pro Lead auf Default-Domain gepinnt sein, selbst
  // wenn die Kampagne eine Custom-Domain hat. Identische Logik wie im
  // Single-Run Lead-Export.
  const effectiveHost =
    lead.domainId && rt.customHostname ? rt.customHostname : null;
  const pageUrl =
    buildLeadPublicUrl(
      {
        slug: lead.slug,
        customHostname: effectiveHost,
        defaultAppUrl: appUrl,
      },
      { absolute: true },
    ) ?? "";

  return [
    String(positionInBundle),
    vorname,
    nachname,
    anrede,
    firma,
    position,
    email,
    telefon,
    strasse,
    plz,
    stadt,
    land,
    webseite,
    pageUrl,
    rt.run.name,
    status,
  ];
}

/**
 * Macht den Header-Row fett. xlsx packt das in den jeweiligen Cell-Style,
 * was die `xlsx`-Lib auch in `bookType: 'xlsx'` schreibt.
 */
function applyBoldHeader(
  ws: XLSX.WorkSheet,
  numCols: number,
): void {
  for (let c = 0; c < numCols; c += 1) {
    const addr = XLSX.utils.encode_cell({ r: 0, c });
    const cell = ws[addr] as XLSX.CellObject | undefined;
    if (!cell) continue;
    cell.s = { font: { bold: true } } as unknown as XLSX.CellObject["s"];
  }
}

/**
 * Excel-Sheet-Namen muessen workbook-eindeutig sein. Wenn zwei Bundles
 * denselben Sheet-Namen produzieren wuerden (sehr lange Run-Namen, deren
 * Trunkat identisch ist), suffixieren wir `-2`, `-3`, … unter Beibehaltung
 * des 31-Zeichen-Limits.
 */
function makeUniqueSheetName(taken: Set<string>, candidate: string): string {
  let name = candidate.slice(0, 31);
  if (!taken.has(name)) {
    taken.add(name);
    return name;
  }
  let n = 2;
  while (n < 1000) {
    const suffix = `-${n}`;
    const trunc = candidate.slice(0, Math.max(1, 31 - suffix.length));
    name = `${trunc}${suffix}`;
    if (!taken.has(name)) {
      taken.add(name);
      return name;
    }
    n += 1;
  }
  // Letzter Ausweg.
  const fb = `sheet-${Date.now().toString(36).slice(-5)}`;
  taken.add(fb);
  return fb;
}

/**
 * Wrapper um `XLSX.utils.book_append_sheet`, der den Namen vorher trimmen
 * sollte (defensive — `makeUniqueSheetName` macht das bereits, aber so
 * vermeiden wir, dass ein versehentlich uebergebener Name >31 die Lib
 * silently truncated).
 */
function appendSheetSafe(
  wb: XLSX.WorkBook,
  ws: XLSX.WorkSheet,
  name: string,
): void {
  XLSX.utils.book_append_sheet(wb, ws, name.slice(0, 31));
}

/**
 * Saubert den Datei-Basenamen — gleiche Regeln wie der Single-Run-Endpoint,
 * aber lokal, weil der Default-Fallback hier `bulk-export-YYYY-MM-DD` ist
 * und nicht der Run-Name.
 */
function sanitizeBaseName(input: string | undefined, fallback: string): string {
  const raw = (input ?? fallback).trim();
  const transl: Record<string, string> = {
    ä: "ae",
    ö: "oe",
    ü: "ue",
    ß: "ss",
    Ä: "Ae",
    Ö: "Oe",
    Ü: "Ue",
  };
  let s = raw.replace(/[äöüßÄÖÜ]/g, (c) => transl[c] ?? c);
  s = s.replace(/[^a-zA-Z0-9-_]+/g, "_").replace(/_+/g, "_");
  s = s.replace(/^_+|_+$/g, "");
  return s.slice(0, 80) || "bulk-export";
}
