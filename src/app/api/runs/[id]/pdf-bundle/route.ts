export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { Readable } from "node:stream";
import { z } from "zod";
import { requireUserApi } from "@/lib/auth-guard";
import { getRun } from "@/lib/db/queries/runs";
import { listLeadsByRun } from "@/lib/db/queries/leads";
import { createArchive } from "@/lib/zip-bundle";

/**
 * POST /api/runs/[id]/pdf-bundle
 *
 * Body: `{ pdfsPerFile: number, baseName?: string }`
 *
 * Konzept (User-Wunsch):
 *   - Es werden ALLE fertigen Leads in das Bundle aufgenommen.
 *   - Je `pdfsPerFile` Lead-PDFs werden zu EINER Multi-Page-PDF gemerged.
 *   - Bei 1000 Leads + 100 pro Datei → 10 grosse PDFs:
 *     <baseName>_1-100.pdf, <baseName>_101-200.pdf, ...
 *   - Alles wandert in ein ZIP, das gestreamt wird.
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

  return streamBundle(
    params.id,
    auth.user.id,
    body.pdfsPerFile,
    body.baseName,
  );
}

/**
 * GET /api/runs/[id]/pdf-bundle?pdfsPerFile=100&baseName=Outreach
 *
 * URL-getriebene Variante (für direkten Browser-Download via <a href>).
 */
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
  const baseNameRaw =
    req.nextUrl.searchParams.get("baseName") ?? undefined;

  return streamBundle(
    params.id,
    auth.user.id,
    pdfsPerFile,
    baseNameRaw ?? undefined,
  );
}

function sanitizeBaseName(input: string | undefined, fallback: string): string {
  const raw = (input ?? fallback).trim();
  // Nur ASCII Alphanumeric + _ - + Umlaute -> ASCII; sonst durch _ ersetzen.
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

async function streamBundle(
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

  // Sort by rowIndex so the bundle reflects the CSV-Reihenfolge.
  completed.sort((a, b) => a.rowIndex - b.rowIndex);

  const baseName = sanitizeBaseName(baseNameInput, run.name);
  const zipFilename = `${baseName}_pdf-bundle.zip`;

  const { archive, stream } = await createArchive();

  // pdf-lib via dynamic import: Next-Webpack hat sonst Probleme mit
  // den ESM-Exports ("d is not a function" beim PDFDocument.create-Call,
  // selbst mit serverComponentsExternalPackages).
  const { PDFDocument } = await import("pdf-lib");

  // Build merged PDFs in batches and append each to the ZIP. Background
  // task so we can return the streaming Response immediately.
  (async () => {
    try {
      for (let batchStart = 0; batchStart < completed.length; batchStart += pdfsPerFile) {
        const batch = completed.slice(batchStart, batchStart + pdfsPerFile);
        const firstIdx = batchStart + 1;
        const lastIdx = batchStart + batch.length;

        // Merge all lead PDFs in this batch into ONE PDFDocument.
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

        const mergedBytes = Buffer.from(await merged.save());
        const pdfName = `${baseName}_${firstIdx}-${lastIdx}.pdf`;
        archive.append(mergedBytes, { name: pdfName });
      }
      await archive.finalize();
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[pdf-bundle] failure:", err);
      try {
        archive.abort();
      } catch {
        /* ignore */
      }
    }
  })();

  const webStream = Readable.toWeb(stream) as unknown as ReadableStream<Uint8Array>;

  return new Response(webStream, {
    status: 200,
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${zipFilename}"`,
      "Cache-Control": "no-store",
    },
  });
}
