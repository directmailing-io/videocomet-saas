export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import Papa from "papaparse";
import { requireUserApi } from "@/lib/auth-guard";
import { getRun } from "@/lib/db/queries/runs";
import { listLeadsByRun } from "@/lib/db/queries/leads";

/**
 * GET /api/runs/[id]/export?format=xlsx|csv
 *
 * Streams an XLSX or CSV containing every lead row plus the columns
 * Landingpage-URL, Video-URL, PDF-URL and Status.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await requireUserApi();
  if (!auth.ok) return auth.response;

  let run;
  try {
    run = await getRun(params.id, auth.user.id);
  } catch {
    return NextResponse.json({ error: "Nicht gefunden." }, { status: 404 });
  }

  const format = (req.nextUrl.searchParams.get("format") ?? "xlsx").toLowerCase();
  if (format !== "xlsx" && format !== "csv") {
    return NextResponse.json(
      { error: "format muss 'xlsx' oder 'csv' sein." },
      { status: 400 },
    );
  }

  const leadRows = await listLeadsByRun(params.id, auth.user.id);

  const appUrl = process.env.APP_URL ?? "https://app.videocomet.de";

  // Collect every "original" column across leads (preserving order).
  const seen = new Set<string>();
  const dataColumns: string[] = [];
  for (const lead of leadRows) {
    const data = (lead.data ?? {}) as Record<string, string>;
    for (const key of Object.keys(data)) {
      if (!seen.has(key)) {
        seen.add(key);
        dataColumns.push(key);
      }
    }
  }

  const exportRows = leadRows.map((lead) => {
    const data = (lead.data ?? {}) as Record<string, string>;
    const out: Record<string, string> = {};
    for (const col of dataColumns) {
      out[col] = data[col] ?? "";
    }
    out["Landingpage-URL"] = lead.slug ? `${appUrl}/v/${lead.slug}` : "";
    out["Video-URL"] = lead.videoUrl ?? "";
    out["PDF-URL"] = lead.pdfUrl ?? "";
    out["Status"] = statusLabel(lead.status);
    return out;
  });

  const safeName = run.name.replace(/[^a-zA-Z0-9-_]+/g, "_").slice(0, 80) || "runde";
  const fileBase = `videocomet-${safeName}`;

  if (format === "csv") {
    const csv = Papa.unparse(exportRows, {
      header: true,
      delimiter: ";", // German Excel default
      newline: "\r\n",
    });
    // Prepend UTF-8 BOM so Excel detects encoding correctly.
    const body = "﻿" + csv;
    return new NextResponse(body, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${fileBase}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  }

  // XLSX
  const ws = XLSX.utils.json_to_sheet(exportRows, {
    header: [...dataColumns, "Landingpage-URL", "Video-URL", "PDF-URL", "Status"],
  });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Leads");
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
  // Wrap as a Blob so we can hand a typed BodyInit to NextResponse.
  const blob = new Blob([new Uint8Array(buf)], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });

  return new NextResponse(blob, {
    status: 200,
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${fileBase}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}

function statusLabel(s: string): string {
  switch (s) {
    case "pending":
      return "Wartet";
    case "rendering":
      return "Wird gerendert";
    case "uploading":
      return "Wird hochgeladen";
    case "completed":
      return "Fertig";
    case "failed":
      return "Fehler";
    default:
      return s;
  }
}
