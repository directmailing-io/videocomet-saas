export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { requireUserApi } from "@/lib/auth-guard";
import { getRun } from "@/lib/db/queries/runs";
import { parseCSV } from "@/lib/csv-parse";
import { parseXLSX } from "@/lib/excel-parse";
import { fetchGoogleSheetCsv } from "@/lib/google-sheets";

/**
 * POST /api/runs/[id]/parse-preview
 *
 * Same multipart shape as upload-leads but does NOT persist anything.
 * Used by the wizard to show a live preview during file-selection.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await requireUserApi();
  if (!auth.ok) return auth.response;

  // Tenant guard.
  try {
    await getRun(params.id, auth.user.id);
  } catch {
    return NextResponse.json({ error: "Nicht gefunden." }, { status: 404 });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json(
      { error: "multipart/form-data erwartet." },
      { status: 400 },
    );
  }

  const kind = String(form.get("kind") ?? "").trim();
  if (!["xlsx", "csv", "google-sheets-url"].includes(kind)) {
    return NextResponse.json(
      { error: "kind muss 'xlsx', 'csv' oder 'google-sheets-url' sein." },
      { status: 400 },
    );
  }

  try {
    if (kind === "google-sheets-url") {
      const url = String(form.get("url") ?? "").trim();
      if (!url) {
        return NextResponse.json(
          { error: "Google-Sheets-URL fehlt." },
          { status: 400 },
        );
      }
      const buf = await fetchGoogleSheetCsv(url);
      const out = parseCSV(buf);
      return NextResponse.json({
        preview: {
          headers: out.headers,
          rows: out.rows.slice(0, 20),
          totalRows: out.rows.length,
          encoding: out.encoding,
          delimiter: out.delimiter,
        },
      });
    }

    const file = form.get("file");
    if (!(file instanceof Blob)) {
      return NextResponse.json({ error: "Datei fehlt." }, { status: 400 });
    }
    const buf = Buffer.from(await file.arrayBuffer());

    if (kind === "xlsx") {
      const out = parseXLSX(buf);
      return NextResponse.json({
        preview: {
          headers: out.headers,
          rows: out.rows.slice(0, 20),
          totalRows: out.rows.length,
          sheetNames: out.sheetNames,
        },
      });
    }
    const out = parseCSV(buf);
    return NextResponse.json({
      preview: {
        headers: out.headers,
        rows: out.rows.slice(0, 20),
        totalRows: out.rows.length,
        encoding: out.encoding,
        delimiter: out.delimiter,
      },
    });
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? err.message
            : "Datei konnte nicht verarbeitet werden.",
      },
      { status: 400 },
    );
  }
}
