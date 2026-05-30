export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUserApi } from "@/lib/auth-guard";
import { getRun } from "@/lib/db/queries/runs";
import { listLeadsByRun } from "@/lib/db/queries/leads";

/**
 * POST /api/runs/[id]/pdf-bundle
 *
 * Body: `{ pdfsPerFile: number, baseName?: string }`
 *
 * Konzept (User-Wunsch):
 *   - Es werden ALLE fertigen Leads in das Bundle aufgenommen.
 *   - Je `pdfsPerFile` Lead-PDFs werden zu EINER Multi-Page-PDF gemerged.
 *   - Bei 1000 Leads + 100 pro Datei → 10 grosse PDFs als ZIP.
 *
 * Tech-Note: pdf-lib + jszip via dynamic import. archiver und Next-
 * Webpack vertragen sich auch mit serverComponentsExternalPackages
 * nicht — jszip ist pure JS und funktioniert sauber.
 */

const sizeSchema = z
  .number()
  .int()
  .refine((n) => n >= 1 && n <= 1000, "PDFs pro Datei: 1..1000");

const bodySchema = z.object({
  pdfsPerFile: sizeSchema,
  baseName: z.string().max(80).optional(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await requireUserApi();
  if (!auth.ok) return auth.response;

  let body: { pdfsPerFile: number; baseName?: string };
  try {
    const json = await req.json();
    body = bodySchema.parse({
      pdfsPerFile: Number(json.pdfsPerFile),
      baseName: typeof json.baseName === "string" ? json.baseName : undefined,
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

  return buildBundle(
    params.id,
    auth.user.id,
    pdfsPerFile,
    baseNameRaw ?? undefined,
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

async function buildBundle(
  runId: string,
  userId: string,
  pdfsPerFile: number,
  baseNameInput: string | undefined,
): Promise<Response> {
  let run;
  try {
    run = await getRun(runId, userId);
  } catch {
    return NextResponse.json({ error: "Nicht gefunden." }, { status: 404 });
  }

  const allLeads = await listLeadsByRun(runId, userId);
  const completed = allLeads.filter(
    (l) => l.status === "completed" && !!l.pdfUrl,
  );

  if (completed.length === 0) {
    return NextResponse.json(
      {
        error:
          "Keine PDFs verfuegbar. Vergewissere dich, dass die Runde fertig ist.",
      },
      { status: 404 },
    );
  }

  completed.sort((a, b) => a.rowIndex - b.rowIndex);

  const baseName = sanitizeBaseName(baseNameInput, run.name);
  const zipFilename = `${baseName}_pdf-bundle.zip`;

  // Beide via dynamic import — Next-Webpack mangled sonst die Default-
  // Resolution (archiver-Bug). Dynamic import resolved at runtime.
  const { PDFDocument } = await import("pdf-lib");
  const JSZipMod = (await import("jszip")) as unknown as {
    default?: typeof import("jszip");
  } & typeof import("jszip");
  const JSZip = JSZipMod.default ?? (JSZipMod as unknown as typeof import("jszip"));

  const zip = new JSZip();

  try {
    for (let batchStart = 0; batchStart < completed.length; batchStart += pdfsPerFile) {
      const batch = completed.slice(batchStart, batchStart + pdfsPerFile);
      const firstIdx = batchStart + 1;
      const lastIdx = batchStart + batch.length;

      const merged = await PDFDocument.create();
      for (const lead of batch) {
        if (!lead.pdfUrl) continue;
        try {
          const res = await fetch(lead.pdfUrl);
          if (!res.ok) {
            // eslint-disable-next-line no-console
            console.warn(
              `[pdf-bundle] skip lead=${lead.id} HTTP ${res.status}`,
            );
            continue;
          }
          const buf = Buffer.from(await res.arrayBuffer());
          const src = await PDFDocument.load(buf, {
            ignoreEncryption: true,
          });
          const pages = await merged.copyPages(src, src.getPageIndices());
          for (const p of pages) merged.addPage(p);
        } catch (err) {
          // eslint-disable-next-line no-console
          console.warn(
            `[pdf-bundle] merge fail lead=${lead.id}:`,
            err instanceof Error ? err.message : err,
          );
        }
      }

      const mergedBytes = await merged.save();
      const pdfName = `${baseName}_${firstIdx}-${lastIdx}.pdf`;
      zip.file(pdfName, mergedBytes);
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
