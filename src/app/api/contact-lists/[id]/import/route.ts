/**
 * Import-API für Kontakt-Listen (Mini-CRM Etappe 5).
 *
 *   POST /api/contact-lists/:id/import
 *     multipart/form-data:
 *        kind      = "csv" | "xlsx" | "google-sheets"
 *        file      (bei csv/xlsx)
 *        url       (bei google-sheets)
 *
 *   Response:
 *     {
 *       headers, previewRows, totalRows, suggested, parseId
 *     }
 *
 *   Danach: POST /api/contact-lists/:id/import/apply mit dem parseId +
 *   dem finalen Mapping.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { requireUserApi } from "@/lib/auth-guard";
import { parseCSV } from "@/lib/csv-parse";
import { parseXLSX } from "@/lib/excel-parse";
import { fetchGoogleSheetCsv } from "@/lib/google-sheets";
import { detectFieldSlot } from "@/lib/contacts/detect-field";
import { saveParseSnapshot } from "@/lib/contacts/import-cache";

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await requireUserApi();
  if (!auth.ok) return auth.response;

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "multipart/form-data erwartet." }, { status: 400 });
  }
  const kind = String(form.get("kind") ?? "");

  let headers: string[] = [];
  let rows: Array<Record<string, string>> = [];

  try {
    if (kind === "csv") {
      const file = form.get("file");
      if (!(file instanceof File)) {
        return NextResponse.json({ error: "Datei fehlt." }, { status: 400 });
      }
      const buf = Buffer.from(await file.arrayBuffer());
      const res = parseCSV(buf);
      headers = res.headers;
      rows = res.rows;
    } else if (kind === "xlsx") {
      const file = form.get("file");
      if (!(file instanceof File)) {
        return NextResponse.json({ error: "Datei fehlt." }, { status: 400 });
      }
      const buf = Buffer.from(await file.arrayBuffer());
      const res = parseXLSX(buf);
      headers = res.headers;
      rows = res.rows;
    } else if (kind === "google-sheets") {
      const url = String(form.get("url") ?? "");
      if (!url) return NextResponse.json({ error: "URL fehlt." }, { status: 400 });
      const buf = await fetchGoogleSheetCsv(url);
      const res = parseCSV(buf);
      headers = res.headers;
      rows = res.rows;
    } else {
      return NextResponse.json({ error: "Unbekannter kind." }, { status: 400 });
    }
  } catch (err) {
    return NextResponse.json(
      { error: "Datei konnte nicht gelesen werden.", details: err instanceof Error ? err.message : null },
      { status: 400 },
    );
  }

  if (headers.length === 0) {
    return NextResponse.json({ error: "Keine Spalten erkannt." }, { status: 400 });
  }
  if (rows.length === 0) {
    return NextResponse.json({ error: "Keine Zeilen erkannt." }, { status: 400 });
  }

  const suggested = headers.map((h) => {
    const sample = rows.slice(0, 20).map((r) => r[h] ?? "");
    const d = detectFieldSlot(h, sample);
    return {
      header: h,
      slot: d.slot,
      detectedType: d.detectedType,
      sample: sample.slice(0, 3),
    };
  });

  const parseId = randomUUID();
  saveParseSnapshot(parseId, {
    userId: auth.user.id,
    listId: params.id,
    headers,
    rows,
    createdAt: Date.now(),
  });

  return NextResponse.json({
    headers,
    previewRows: rows.slice(0, 5).map((r) => headers.map((h) => r[h] ?? "")),
    totalRows: rows.length,
    suggested,
    parseId,
  });
}
