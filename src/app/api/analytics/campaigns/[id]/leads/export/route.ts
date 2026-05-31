export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/analytics/campaigns/[id]/leads/export?filter=&format=
 *
 * Exports a cross-runs lead list of one campaign as CSV or XLSX, filtered by
 * tracking-activity.
 *
 *   filter:
 *     all      every lead
 *     opened   leads with viewCount > 0
 *     played   leads with playCount > 0
 *     cta      leads with ctaClickCount > 0  (default for marketers)
 *
 *   format: csv | xlsx (default xlsx)
 *
 * Columns: original CSV fields + tracking aggregates + URLs + Run-Name +
 * Status. Same data-column inference as /api/runs/[id]/export so the user
 * sees their familiar fields first.
 */

import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import Papa from "papaparse";
import { and, desc, eq, gt } from "drizzle-orm";
import { requireUserApi } from "@/lib/auth-guard";
import { db } from "@/lib/db";
import { campaigns, leads, runs, userDomains } from "@/lib/db/schema";
import { buildLeadPublicUrl } from "@/lib/lead-public-url";

type Filter = "all" | "opened" | "played" | "cta";
type Format = "csv" | "xlsx";

function parseFilter(raw: string | null): Filter {
  if (raw === "all" || raw === "opened" || raw === "played" || raw === "cta") {
    return raw;
  }
  return "all";
}

function parseFormat(raw: string | null): Format {
  if (raw === "csv" || raw === "xlsx") return raw;
  return "xlsx";
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

function fmtTs(d: Date | null | undefined): string {
  if (!d) return "";
  const date = d instanceof Date ? d : new Date(d);
  if (!Number.isFinite(date.getTime())) return "";
  return new Intl.DateTimeFormat("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(date);
}

function fmtDuration(sec: number | null | undefined): string {
  if (typeof sec !== "number" || !Number.isFinite(sec) || sec <= 0) return "";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requireUserApi();
  if (!auth.ok) return auth.response;

  const { id: campaignId } = await params;

  // Tenant guard via SELECT.
  const [camp] = await db
    .select({ id: campaigns.id, name: campaigns.name })
    .from(campaigns)
    .where(and(eq(campaigns.id, campaignId), eq(campaigns.userId, auth.user.id)))
    .limit(1);
  if (!camp) {
    return NextResponse.json({ error: "Nicht gefunden." }, { status: 404 });
  }

  const filter = parseFilter(req.nextUrl.searchParams.get("filter"));
  const format = parseFormat(req.nextUrl.searchParams.get("format"));

  const conditions = [eq(runs.campaignId, camp.id), eq(runs.userId, auth.user.id)];
  if (filter === "opened") conditions.push(gt(leads.viewCount, 0));
  else if (filter === "played") conditions.push(gt(leads.playCount, 0));
  else if (filter === "cta") conditions.push(gt(leads.ctaClickCount, 0));

  const rows = await db
    .select({
      id: leads.id,
      rowIndex: leads.rowIndex,
      data: leads.data,
      slug: leads.slug,
      videoUrl: leads.videoUrl,
      pdfUrl: leads.pdfUrl,
      status: leads.status,
      viewCount: leads.viewCount,
      firstViewedAt: leads.firstViewedAt,
      lastViewedAt: leads.lastViewedAt,
      playCount: leads.playCount,
      watchTimeSec: leads.watchTimeSec,
      ctaClickCount: leads.ctaClickCount,
      lastCtaAt: leads.lastCtaAt,
      runId: leads.runId,
      runName: runs.name,
      runCreatedAt: runs.createdAt,
      // Pro-Lead hostname: NULL wenn keine Custom-Domain oder Domain
      // nicht (mehr) aktiv.
      customHostname: userDomains.hostname,
      customDomainStatus: userDomains.status,
    })
    .from(leads)
    .innerJoin(runs, eq(runs.id, leads.runId))
    .leftJoin(userDomains, eq(userDomains.id, leads.domainId))
    .where(and(...conditions))
    .orderBy(desc(runs.createdAt), leads.rowIndex);

  // Collect original CSV column names so the exported file preserves the
  // user's familiar layout up front (one row could have keys another doesn't).
  const seen = new Set<string>();
  const dataColumns: string[] = [];
  for (const r of rows) {
    const data = (r.data ?? {}) as Record<string, string>;
    for (const key of Object.keys(data)) {
      if (!seen.has(key)) {
        seen.add(key);
        dataColumns.push(key);
      }
    }
  }

  const appUrl = process.env.APP_URL ?? "https://app.videocomet.de";

  const TRACKING_COLS = [
    "Aufrufe",
    "Erstmals geöffnet",
    "Zuletzt geöffnet",
    "Plays",
    "Watch-Time",
    "Watch-Time (Sek.)",
    "CTA-Klicks",
    "Letzter CTA",
    "Landingpage-URL",
    "Video-URL",
    "PDF-URL",
    "Runde",
    "Status",
  ] as const;

  const exportRows = rows.map((r) => {
    const data = (r.data ?? {}) as Record<string, string>;
    const out: Record<string, string | number> = {};
    for (const col of dataColumns) out[col] = data[col] ?? "";
    out["Aufrufe"] = r.viewCount ?? 0;
    out["Erstmals geöffnet"] = fmtTs(r.firstViewedAt);
    out["Zuletzt geöffnet"] = fmtTs(r.lastViewedAt);
    out["Plays"] = r.playCount ?? 0;
    out["Watch-Time"] = fmtDuration(r.watchTimeSec ?? 0);
    out["Watch-Time (Sek.)"] = r.watchTimeSec ?? 0;
    out["CTA-Klicks"] = r.ctaClickCount ?? 0;
    out["Letzter CTA"] = fmtTs(r.lastCtaAt);
    const effectiveHost =
      r.customDomainStatus === "active" ? r.customHostname : null;
    out["Landingpage-URL"] =
      buildLeadPublicUrl(
        { slug: r.slug, customHostname: effectiveHost, defaultAppUrl: appUrl },
        { absolute: true },
      ) ?? "";
    out["Video-URL"] = r.videoUrl ?? "";
    out["PDF-URL"] = r.pdfUrl ?? "";
    out["Runde"] = r.runName ?? "";
    out["Status"] = statusLabel(r.status);
    return out;
  });

  const safeCamp = camp.name.replace(/[^a-zA-Z0-9-_]+/g, "_").slice(0, 60) || "kampagne";
  const filterTag =
    filter === "all"
      ? "alle"
      : filter === "opened"
        ? "geoeffnet"
        : filter === "played"
          ? "video"
          : "cta";
  const today = new Date().toISOString().slice(0, 10);
  const fileBase = `videocomet-${safeCamp}-${filterTag}-${today}`;

  if (format === "csv") {
    const csv = Papa.unparse(exportRows, {
      header: true,
      delimiter: ";",
      newline: "\r\n",
    });
    // UTF-8 BOM so German Excel detects encoding.
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

  const ws = XLSX.utils.json_to_sheet(exportRows, {
    header: [...dataColumns, ...TRACKING_COLS],
  });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Leads");
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
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
