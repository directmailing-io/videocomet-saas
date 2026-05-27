export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { eq, and } from "drizzle-orm";
import { requireUserApi } from "@/lib/auth-guard";
import { db } from "@/lib/db";
import { runs } from "@/lib/db/schema";
import { getRun } from "@/lib/db/queries/runs";
import { parseCSV } from "@/lib/csv-parse";
import { parseXLSX } from "@/lib/excel-parse";
import { fetchGoogleSheetCsv } from "@/lib/google-sheets";

// Cap to keep JSONB-size sane. 5000 rows ≈ ~few MB; well below the 1GB limit.
const MAX_ROWS = 5000;

interface StoredColumnMapping {
  mapping?: Record<string, string>;
  parsed?: {
    headers: string[];
    rows: Record<string, string>[];
    totalRows: number;
    source: "xlsx" | "csv" | "google-sheets";
    encoding?: string;
    delimiter?: string;
  };
}

/**
 * POST /api/runs/[id]/upload-leads
 *
 * multipart/form-data fields:
 *   - kind: "xlsx" | "csv" | "google-sheets-url"
 *   - file: File (when kind != google-sheets-url)
 *   - url:  string (when kind = google-sheets-url)
 *
 * Persists the parsed headers + rows on the run row (`columnMapping.parsed`)
 * so the wizard's step 3 can submit `start` later without re-uploading.
 *
 * Returns a preview of the first 20 rows.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await requireUserApi();
  if (!auth.ok) return auth.response;

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
    let parsed: StoredColumnMapping["parsed"];

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
      parsed = {
        headers: out.headers,
        rows: out.rows.slice(0, MAX_ROWS),
        totalRows: out.rows.length,
        source: "google-sheets",
        encoding: out.encoding,
        delimiter: out.delimiter,
      };
    } else {
      const file = form.get("file");
      if (!(file instanceof Blob)) {
        return NextResponse.json(
          { error: "Datei fehlt." },
          { status: 400 },
        );
      }
      const buf = Buffer.from(await file.arrayBuffer());
      if (kind === "xlsx") {
        const out = parseXLSX(buf);
        parsed = {
          headers: out.headers,
          rows: out.rows.slice(0, MAX_ROWS),
          totalRows: out.rows.length,
          source: "xlsx",
        };
      } else {
        const out = parseCSV(buf);
        parsed = {
          headers: out.headers,
          rows: out.rows.slice(0, MAX_ROWS),
          totalRows: out.rows.length,
          source: "csv",
          encoding: out.encoding,
          delimiter: out.delimiter,
        };
      }
    }

    // Persist on the run row.
    const existing = await getColumnMapping(params.id, auth.user.id);
    const next: StoredColumnMapping = { ...existing, parsed };
    await db
      .update(runs)
      .set({ columnMapping: next as unknown as Record<string, string> })
      .where(and(eq(runs.id, params.id), eq(runs.userId, auth.user.id)));

    return NextResponse.json({
      preview: {
        headers: parsed.headers,
        rows: parsed.rows.slice(0, 20),
        totalRows: parsed.totalRows,
        truncated: parsed.totalRows > MAX_ROWS,
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

async function getColumnMapping(
  runId: string,
  userId: string,
): Promise<StoredColumnMapping> {
  const [row] = await db
    .select({ cm: runs.columnMapping })
    .from(runs)
    .where(and(eq(runs.id, runId), eq(runs.userId, userId)))
    .limit(1);
  return (row?.cm as StoredColumnMapping | null) ?? {};
}
