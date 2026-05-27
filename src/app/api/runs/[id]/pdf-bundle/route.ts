export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { Readable } from "node:stream";
import { z } from "zod";
import Papa from "papaparse";
import { requireUserApi } from "@/lib/auth-guard";
import { getRun } from "@/lib/db/queries/runs";
import { listLeadsByRun } from "@/lib/db/queries/leads";
import { createArchive, addRemoteFileToZip } from "@/lib/zip-bundle";

const ALLOWED_SIZES = [25, 50, 100, 150, 200, 250, 500] as const;
type BundleSize = (typeof ALLOWED_SIZES)[number];

const sizeSchema = z.number().int().refine((n) =>
  (ALLOWED_SIZES as readonly number[]).includes(n),
);

function parseSize(value: string | null, fallback: BundleSize = 100): BundleSize {
  if (!value) return fallback;
  const n = Number(value);
  return (ALLOWED_SIZES as readonly number[]).includes(n)
    ? (n as BundleSize)
    : fallback;
}

function parseOffset(value: string | null): number {
  if (!value) return 0;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
}

/**
 * POST /api/runs/[id]/pdf-bundle
 *
 * Body: `{ size: 25|50|100|150|200|250|500, offset?: number }`
 *
 * Streams a ZIP archive of up to `size` PDFs starting at `offset` (so a
 * client can iterate through batches). Each archive contains a
 * `manifest.csv` listing every included PDF.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await requireUserApi();
  if (!auth.ok) return auth.response;

  let body: { size: BundleSize; offset?: number };
  try {
    const json = await req.json();
    const size = sizeSchema.parse(Number(json.size));
    const offset = Math.max(0, Math.floor(Number(json.offset ?? 0)));
    body = { size: size as BundleSize, offset };
  } catch (err) {
    return NextResponse.json(
      {
        error: "Ungueltige Eingabe.",
        details: err instanceof Error ? err.message : null,
      },
      { status: 400 },
    );
  }

  return streamBundle(params.id, auth.user.id, body.size, body.offset ?? 0);
}

/**
 * GET /api/runs/[id]/pdf-bundle?size=100&offset=0
 *
 * Same as POST but URL-driven so links can be opened directly from the UI.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await requireUserApi();
  if (!auth.ok) return auth.response;

  const size = parseSize(req.nextUrl.searchParams.get("size"));
  const offset = parseOffset(req.nextUrl.searchParams.get("offset"));
  return streamBundle(params.id, auth.user.id, size, offset);
}

async function streamBundle(
  runId: string,
  userId: string,
  size: number,
  offset: number,
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
  const slice = completed.slice(offset, offset + size);

  if (slice.length === 0) {
    return NextResponse.json(
      {
        error:
          "Keine PDFs verfuegbar. Vergewissere dich, dass die Runde fertig ist.",
      },
      { status: 404 },
    );
  }

  const appUrl = process.env.APP_URL ?? "https://app.videocomet.de";
  const safeName =
    run.name.replace(/[^a-zA-Z0-9-_]+/g, "_").slice(0, 80) || "runde";
  const filename = `videocomet-${safeName}-pdfs-${offset + 1}-${offset + slice.length}.zip`;

  const { archive, stream } = createArchive();

  // Build manifest first so it appears even if some PDFs fail to fetch.
  const manifestRows = slice.map((lead, i) => {
    const data = (lead.data ?? {}) as Record<string, string>;
    const prettyName =
      data.firstName || data.Vorname || data.name || data.fullName || `Lead ${lead.rowIndex}`;
    return {
      Index: offset + i + 1,
      Lead: prettyName,
      PDF: `${pdfFilename(lead, prettyName, i)}`,
      Landingpage: lead.slug ? `${appUrl}/v/${lead.slug}` : "",
    };
  });
  const manifestCsv = Papa.unparse(manifestRows, {
    header: true,
    delimiter: ";",
    newline: "\r\n",
  });
  archive.append("﻿" + manifestCsv, { name: "manifest.csv" });

  // Kick off fetches sequentially to keep memory bounded.
  (async () => {
    for (let i = 0; i < slice.length; i += 1) {
      const lead = slice[i];
      const data = (lead.data ?? {}) as Record<string, string>;
      const prettyName =
        data.firstName ||
        data.Vorname ||
        data.name ||
        data.fullName ||
        `Lead ${lead.rowIndex}`;
      const name = pdfFilename(lead, prettyName, i);
      if (!lead.pdfUrl) continue;
      await addRemoteFileToZip(archive, name, lead.pdfUrl);
    }
    archive.finalize().catch((err) => {
      // eslint-disable-next-line no-console
      console.error("[pdf-bundle] finalize failed:", err);
    });
  })().catch((err) => {
    // eslint-disable-next-line no-console
    console.error("[pdf-bundle] bundle failed:", err);
  });

  // Convert Node Readable into a Web ReadableStream for Response.
  const webStream = Readable.toWeb(stream) as unknown as ReadableStream<Uint8Array>;

  return new Response(webStream, {
    status: 200,
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}

function pdfFilename(
  lead: { rowIndex: number; id: string },
  prettyName: string,
  i: number,
): string {
  const safe = prettyName
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9-_ ]+/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 60);
  const idx = String(i + 1).padStart(4, "0");
  return `${idx}_${safe || `lead-${lead.rowIndex}`}.pdf`;
}
