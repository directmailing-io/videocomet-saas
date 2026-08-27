export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUserApi } from "@/lib/auth-guard";
import { getRun } from "@/lib/db/queries/runs";
import { getCompletedLeadsForBundle } from "@/lib/db/queries/leads";
import { markLeadsExported } from "@/lib/db/queries/letter-status";
import {
  sortLeadsForBundle,
  type BundleSortDir,
} from "@/lib/bundle-helpers";
import type { leads } from "@/lib/db/schema";
import type { PDFDocument as PDFDocumentType } from "pdf-lib";

type Lead = typeof leads.$inferSelect;

/**
 * POST /api/runs/[id]/pdf-bundle
 *
 * Body: `{ pdfsPerFile: number, baseName?: string, variant?: BundleVariant }`
 *
 * Konzept (User-Wunsch):
 *   - Es werden ALLE fertigen Leads in das Bundle aufgenommen.
 *   - Je `pdfsPerFile` Lead-PDFs werden zu EINER Multi-Page-PDF gemerged.
 *   - Bei 1000 Leads + 100 pro Datei → 10 grosse PDFs als ZIP.
 *
 * A/B-Varianten (`variant`):
 *   - "mixed" (Default): Original-Reihenfolge, A und B gemischt.
 *   - "split": ein ZIP, aber getrennte Ordner briefe-A/ + briefe-B/
 *     (+ umschlaege-A/ / umschlaege-B/) mit eigener Nummerierung.
 *   - "A" / "B": nur die Leads der gewählten Variante.
 *
 * Umschlag-Garantie: Umschläge werden über EXAKT dieselbe Lead-Liste,
 * Sortierung und Batch-Aufteilung gebaut wie die Briefe — Brief-Datei
 * `…_1-100.pdf` und Umschlag-Datei `…umschlaege_1-100.pdf` enthalten
 * dieselben Leads in derselben Reihenfolge (Kuvertier-Sicherheit).
 * Abweichungen (fehlender Umschlag / fehlgeschlagener Download) landen als
 * Warnung in einer README.txt im ZIP statt still auseinanderzulaufen.
 *
 * Tech-Note: pdf-lib + jszip via dynamic import. archiver und Next-
 * Webpack vertragen sich auch mit serverComponentsExternalPackages
 * nicht — jszip ist pure JS und funktioniert sauber.
 */

const sizeSchema = z
  .number()
  .int()
  .refine((n) => n >= 1 && n <= 1000, "PDFs pro Datei: 1..1000");

const variantSchema = z.enum(["mixed", "split", "A", "B"]);
type BundleVariant = z.infer<typeof variantSchema>;

/** Spaltenname aus den Lead-Daten (User-Auswahl); fehlt → Original-Reihenfolge. */
const sortSchema = z.string().trim().min(1).max(200);
const sortDirSchema = z.enum(["asc", "desc"]);

const bodySchema = z.object({
  pdfsPerFile: sizeSchema,
  baseName: z.string().max(80).optional(),
  variant: variantSchema.optional(),
  sortBy: sortSchema.optional(),
  sortDir: sortDirSchema.optional(),
  /** Teilexport (Versandzentrale): nur diese Leads. Fehlt → alle. */
  leadIds: z.array(z.string().uuid()).min(1).max(5000).optional(),
  /** Nur Umschläge (Versandzentrale): keine Briefe im ZIP, kein Export-Protokoll. */
  envelopesOnly: z.boolean().optional(),
  /** Nur Briefe (Versandzentrale): keine Umschläge im ZIP, Export-Protokoll läuft normal. */
  lettersOnly: z.boolean().optional(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await requireUserApi();
  if (!auth.ok) return auth.response;

  let body: {
    pdfsPerFile: number;
    baseName?: string;
    variant?: BundleVariant;
    sortBy?: string;
    sortDir?: BundleSortDir;
    leadIds?: string[];
    envelopesOnly?: boolean;
    lettersOnly?: boolean;
  };
  try {
    const json = await req.json();
    body = bodySchema.parse({
      pdfsPerFile: Number(json.pdfsPerFile),
      baseName: typeof json.baseName === "string" ? json.baseName : undefined,
      variant: typeof json.variant === "string" ? json.variant : undefined,
      sortBy: typeof json.sortBy === "string" ? json.sortBy : undefined,
      sortDir: typeof json.sortDir === "string" ? json.sortDir : undefined,
      leadIds: Array.isArray(json.leadIds) ? json.leadIds : undefined,
      envelopesOnly:
        typeof json.envelopesOnly === "boolean" ? json.envelopesOnly : undefined,
      lettersOnly:
        typeof json.lettersOnly === "boolean" ? json.lettersOnly : undefined,
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

  return buildBundle(
    params.id,
    auth.user.id,
    body.pdfsPerFile,
    body.baseName,
    body.variant ?? "mixed",
    body.sortBy,
    body.sortDir ?? "asc",
    body.leadIds,
    body.envelopesOnly ?? false,
    body.lettersOnly ?? false,
  );
}

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await requireUserApi();
  if (!auth.ok) return auth.response;

  const pdfsPerFile = Math.max(
    1,
    Math.min(1000, Number(req.nextUrl.searchParams.get("pdfsPerFile") ?? 100)),
  );
  const baseNameRaw = req.nextUrl.searchParams.get("baseName") ?? undefined;
  const variantParsed = variantSchema.safeParse(
    req.nextUrl.searchParams.get("variant") ?? "mixed",
  );
  const sortParsed = sortSchema.safeParse(
    req.nextUrl.searchParams.get("sortBy"),
  );
  const sortDirParsed = sortDirSchema.safeParse(
    req.nextUrl.searchParams.get("sortDir"),
  );

  return buildBundle(
    params.id,
    auth.user.id,
    pdfsPerFile,
    baseNameRaw ?? undefined,
    variantParsed.success ? variantParsed.data : "mixed",
    sortParsed.success ? sortParsed.data : undefined,
    sortDirParsed.success ? sortDirParsed.data : "asc",
  );
}

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
  return s.slice(0, 60) || "videocomet";
}

/** Eine Export-Gruppe = ein zusammenhängender Brief-Stapel (+ passende Umschläge). */
interface BundleGroup {
  /** Lesbarer Name für README ("Brief A", "Alle Briefe", …). */
  label: string;
  /** Dateiname-Suffix, z.B. "_A". Leer für gemischt. */
  suffix: string;
  /** ZIP-Ordner für Briefe. Leer = Root. */
  letterDir: string;
  /** ZIP-Ordner für Umschläge. */
  envelopeDir: string;
  leads: Lead[];
}

function leadLabel(lead: Lead): string {
  const d = (lead.data ?? {}) as Record<string, string>;
  const name =
    [d.firstName || d.Vorname, d.lastName || d.Nachname]
      .filter(Boolean)
      .join(" ") ||
    d.name ||
    d.email ||
    d["E-Mail"] ||
    lead.id.slice(0, 8);
  return `Zeile ${lead.rowIndex + 1} (${name})`;
}

function buildGroups(
  variant: BundleVariant,
  completed: Lead[],
): BundleGroup[] {
  if (variant === "mixed") {
    return [
      {
        label: "Alle Briefe",
        suffix: "",
        letterDir: "",
        envelopeDir: "umschlaege",
        leads: completed,
      },
    ];
  }
  if (variant === "A" || variant === "B") {
    return [
      {
        label: `Brief ${variant}`,
        suffix: `_${variant}`,
        letterDir: "",
        envelopeDir: "umschlaege",
        leads: completed.filter((l) => l.abVariant === variant),
      },
    ];
  }
  // split
  const a = completed.filter((l) => l.abVariant === "A");
  const b = completed.filter((l) => l.abVariant === "B");
  const rest = completed.filter(
    (l) => l.abVariant !== "A" && l.abVariant !== "B",
  );
  const groups: BundleGroup[] = [];
  if (a.length > 0) {
    groups.push({
      label: "Brief A",
      suffix: "_A",
      letterDir: "briefe-A",
      envelopeDir: "umschlaege-A",
      leads: a,
    });
  }
  if (b.length > 0) {
    groups.push({
      label: "Brief B",
      suffix: "_B",
      letterDir: "briefe-B",
      envelopeDir: "umschlaege-B",
      leads: b,
    });
  }
  if (rest.length > 0) {
    // Defensive: Leads ohne Varianten-Zuordnung (sollte bei A/B-Runden nicht
    // vorkommen) nicht still verschlucken.
    groups.push({
      label: "Ohne Varianten-Zuordnung",
      suffix: "_ohne-variante",
      letterDir: "briefe-ohne-variante",
      envelopeDir: "umschlaege-ohne-variante",
      leads: rest,
    });
  }
  return groups;
}

async function buildBundle(
  runId: string,
  userId: string,
  pdfsPerFile: number,
  baseNameInput: string | undefined,
  variant: BundleVariant,
  sortBy: string | undefined,
  sortDir: BundleSortDir,
  leadIds?: string[],
  envelopesOnly = false,
  lettersOnly = false,
): Promise<Response> {
  let run;
  try {
    run = await getRun(runId, userId);
  } catch {
    return NextResponse.json({ error: "Nicht gefunden." }, { status: 404 });
  }

  // Geteilter Ordering-Helper — identisch zur Reihenfolge des Bulk-Export-
  // Endpoints, damit die Excel-Spalten 1:1 zur PDF-Seite passen. Sortierung
  // VOR buildGroups, damit A/B-Gruppen und Batches sortiert entstehen.
  // Teilexport (Versandzentrale): Auswahl-Filter VOR der Sortierung —
  // Briefe und Umschläge laufen danach über dieselbe gefilterte, sortierte
  // Liste, der 1:1-Kuvertier-Kontrakt bleibt erhalten.
  const allCompleted = await getCompletedLeadsForBundle(runId, userId);
  const totalCompleted = allCompleted.length;
  const selectedSet = leadIds ? new Set(leadIds) : null;
  const isPartial =
    selectedSet !== null &&
    allCompleted.some((l) => !selectedSet.has(l.id));
  const completed = sortLeadsForBundle(
    selectedSet ? allCompleted.filter((l) => selectedSet.has(l.id)) : allCompleted,
    sortBy,
    sortDir,
  );

  if (completed.length === 0) {
    return NextResponse.json(
      {
        error:
          "Keine PDFs verfügbar. Vergewissere dich, dass die Runde fertig ist.",
      },
      { status: 404 },
    );
  }

  const groups = buildGroups(variant, completed).filter(
    (g) => g.leads.length > 0,
  );
  if (groups.length === 0) {
    return NextResponse.json(
      {
        error:
          variant === "A" || variant === "B"
            ? `Keine Leads mit Brief ${variant} in dieser Runde.`
            : "Keine passenden Leads in dieser Runde.",
      },
      { status: 404 },
    );
  }

  const baseName = sanitizeBaseName(baseNameInput, run.name);
  const zipFilename = envelopesOnly
    ? `${baseName}_umschlaege.zip`
    : lettersOnly
      ? `${baseName}_briefe.zip`
      : `${baseName}_pdf-bundle.zip`;

  // Beide via dynamic import — Next-Webpack mangled sonst die Default-
  // Resolution (archiver-Bug). Dynamic import resolved at runtime.
  const { PDFDocument } = await import("pdf-lib");
  const JSZipMod = (await import("jszip")) as unknown as {
    default?: typeof import("jszip");
  } & typeof import("jszip");
  const JSZip = JSZipMod.default ?? (JSZipMod as unknown as typeof import("jszip"));

  const zip = new JSZip();
  const warnings: string[] = [];
  // Umschläge nur bauen, wenn die Runde überhaupt Umschläge hat.
  const hasEnvelopes = completed.some((l) => !!l.envelopePdfUrl);

  if (envelopesOnly && !hasEnvelopes) {
    return NextResponse.json(
      { error: "Für diese Runde gibt es keine Umschläge." },
      { status: 404 },
    );
  }

  async function appendPdf(merged: PDFDocumentType, url: string): Promise<void> {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    const src = await PDFDocument.load(buf, { ignoreEncryption: true });
    const pages = await merged.copyPages(src, src.getPageIndices());
    for (const p of pages) merged.addPage(p);
  }

  try {
    for (const group of groups) {
      for (
        let batchStart = 0;
        batchStart < group.leads.length;
        batchStart += pdfsPerFile
      ) {
        const batch = group.leads.slice(batchStart, batchStart + pdfsPerFile);
        const firstIdx = batchStart + 1;
        const lastIdx = batchStart + batch.length;
        const rangeName = `${baseName}${group.suffix}_${firstIdx}-${lastIdx}.pdf`;

        // Briefe und Umschläge im SELBEN Loop über die SELBE Lead-Liste —
        // dadurch ist die Reihenfolge in beiden Dateien garantiert identisch.
        const letterDoc = envelopesOnly ? null : await PDFDocument.create();
        const envelopeDoc =
          hasEnvelopes && !lettersOnly ? await PDFDocument.create() : null;

        for (const lead of batch) {
          if (letterDoc) {
            if (lead.pdfUrl) {
              try {
                await appendPdf(letterDoc, lead.pdfUrl);
              } catch (err) {
                warnings.push(
                  `${leadLabel(lead)}: Brief-PDF konnte nicht geladen werden (${err instanceof Error ? err.message : "Fehler"}) — fehlt in ${rangeName}. Umschlag-Reihenfolge weicht in diesem Batch ab!`,
                );
              }
            } else {
              warnings.push(
                `${leadLabel(lead)}: kein Brief-PDF vorhanden — fehlt in ${rangeName}.`,
              );
            }
          }

          if (envelopeDoc) {
            if (lead.envelopePdfUrl) {
              try {
                await appendPdf(envelopeDoc, lead.envelopePdfUrl);
              } catch (err) {
                warnings.push(
                  `${leadLabel(lead)}: Umschlag-PDF konnte nicht geladen werden (${err instanceof Error ? err.message : "Fehler"}) — Brief-/Umschlag-Reihenfolge weicht in Batch ${firstIdx}-${lastIdx} ab!`,
                );
              }
            } else {
              warnings.push(
                `${leadLabel(lead)}: kein Umschlag vorhanden — Brief-/Umschlag-Reihenfolge weicht in Batch ${firstIdx}-${lastIdx} ab!`,
              );
            }
          }
        }

        if (letterDoc) {
          const letterBytes = await letterDoc.save();
          const letterPath = group.letterDir
            ? `${group.letterDir}/${rangeName}`
            : rangeName;
          zip.file(letterPath, letterBytes);
        }

        if (envelopeDoc && envelopeDoc.getPageCount() > 0) {
          const envelopeBytes = await envelopeDoc.save();
          zip.file(
            `${group.envelopeDir}/${baseName}_umschlaege${group.suffix}_${firstIdx}-${lastIdx}.pdf`,
            envelopeBytes,
          );
        }
      }
    }

    // README: Manifest + Warnungen. Immer bei Varianten-Auswahl, Teilexport
    // oder wenn etwas schiefging — der Lettershop soll Abweichungen sehen,
    // nicht raten.
    if (variant !== "mixed" || sortBy || isPartial || envelopesOnly || lettersOnly || warnings.length > 0) {
      const lines: string[] = [
        `PDF-Bundle "${baseName}" — Runde: ${run.name}`,
        ...(envelopesOnly ? ["Nur Umschläge (keine Briefe in diesem ZIP)"] : []),
        ...(lettersOnly ? ["Nur Briefe (keine Umschläge in diesem ZIP)"] : []),
        ...(isPartial
          ? [`Teilexport: ${completed.length} von ${totalCompleted} Leads (Auswahl aus der Versandzentrale)`]
          : []),
        `Zusammenstellung: ${
          variant === "mixed"
            ? "Alle Briefe (gemischt)"
            : variant === "split"
              ? "Nach Brief-Variante getrennt"
              : `Nur Brief ${variant}`
        }`,
        `Sortierung: ${
          sortBy
            ? `Nach Spalte "${sortBy}" (${sortDir === "desc" ? "absteigend" : "aufsteigend"})`
            : "Original-Reihenfolge (wie importiert)"
        }`,
        "",
        ...groups.map((g) => `${g.label}: ${g.leads.length} Leads`),
        ...(envelopesOnly || lettersOnly
          ? []
          : [
              "",
              "Brief- und Umschlag-Dateien mit gleichem Nummernbereich enthalten",
              "dieselben Leads in derselben Reihenfolge (Kuvertier-Reihenfolge).",
            ]),
      ];
      if (warnings.length > 0) {
        lines.push(
          "",
          `ACHTUNG — ${warnings.length} Abweichung(en):`,
          ...warnings.map((w) => `  - ${w}`),
        );
      }
      zip.file("README.txt", lines.join("\n") + "\n");
    }

    // JSZip generateAsync streamed nicht — wir bauen das gesamte ZIP
    // im Memory. Bei 1000 Leads × 100KB pro Lead-PDF = ~100MB. Bei
    // 10 Multi-Page PDFs liegt das im Range, sollte für die meisten
    // Runden problemlos sein.
    const zipBuffer = await zip.generateAsync({
      type: "nodebuffer",
      compression: "DEFLATE",
      compressionOptions: { level: 6 },
    });

    // Wrap als Blob: Node's Buffer ist nicht direkt BodyInit-assignable
    // unter den aktuellen TS-lib types (SharedArrayBuffer vs ArrayBuffer).
    const ab = zipBuffer.buffer.slice(
      zipBuffer.byteOffset,
      zipBuffer.byteOffset + zipBuffer.byteLength,
    ) as ArrayBuffer;
    const blob = new Blob([ab], { type: "application/zip" });

    // Export-Protokoll (Versandzentrale): letter_exported_at + lead_events.
    // Ändert NIE den letter_status — der User entscheidet nach dem Download
    // im Dialog. Fire-and-forget, darf den Download nicht verzögern.
    // Nur-Umschläge-Downloads zählen nicht als Brief-Export.
    if (!envelopesOnly) {
      const exportedIds = groups.flatMap((g) => g.leads.map((l) => l.id));
      void markLeadsExported(exportedIds, {
        runId,
        total: totalCompleted,
        partial: isPartial || exportedIds.length < totalCompleted,
      });
    }


    return new Response(blob, {
      status: 200,
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${zipFilename}"`,
        "Content-Length": String(zipBuffer.byteLength),
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[pdf-bundle] failure:", err);
    return NextResponse.json(
      {
        error: "Bundle konnte nicht erzeugt werden.",
        details: err instanceof Error ? err.message : null,
      },
      { status: 500 },
    );
  }
}
