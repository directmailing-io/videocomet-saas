export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { requireUserApi } from "@/lib/auth-guard";
import { getRun } from "@/lib/db/queries/runs";
import {
  listLeadsByRun,
  listExcludedLeadsByRun,
  getExclusionCounts,
  type ExcludedLeadRow,
} from "@/lib/db/queries/leads";
import { getUserDomain } from "@/lib/db/queries/user-domains";
import { getCampaign } from "@/lib/db/queries/campaigns";
import { buildLeadPublicUrl } from "@/lib/lead-public-url";

/**
 * GET /api/runs/[id]/lead-export
 *
 * Liefert ein XLSX mit zwei Sheets:
 *  1. "Erfolgreich"          — alle abgeschlossenen Leads inkl. URL-Spalten
 *  2. "Nicht durchgegangen"  — alle entfernten / fehlgeschlagenen Leads
 *                              mit synthetisierter Begründung
 *
 * Mit `?counts=1` antwortet der Endpunkt stattdessen mit JSON-Counts für die
 * Stats-Pille im Run-Detail (`ExclusionCounts`). Das spart einen separaten
 * Endpoint und hält die Auth/Tenant-Pipeline an einer Stelle.
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

  // Counts-Mode: gibt nur die Aggregate für die UI-Pille zurück.
  if (req.nextUrl.searchParams.get("counts") === "1") {
    const counts = await getExclusionCounts(params.id, auth.user.id);
    return NextResponse.json(counts, {
      status: 200,
      headers: { "Cache-Control": "no-store" },
    });
  }

  const appUrl = process.env.APP_URL ?? "https://app.videocomet.de";

  // Custom-Domain + pdfEnabled einmal vorab holen.
  let customHostname: string | null = null;
  let pdfEnabled = false;
  try {
    const campaign = await getCampaign(run.campaignId, auth.user.id);
    pdfEnabled = campaign.pdfEnabled;
    if (campaign.domainId) {
      const d = await getUserDomain(campaign.domainId, auth.user.id);
      if (d && d.status === "active") customHostname = d.hostname;
    }
  } catch {
    // schweigend — fallback auf Default-URL / pdfEnabled=false
  }

  const [allSuccessLeads, excludedLeads] = await Promise.all([
    listLeadsByRun(params.id, auth.user.id),
    listExcludedLeadsByRun(params.id, auth.user.id),
  ]);
  const successLeads = allSuccessLeads.filter((l) => l.status === "completed");

  // ── Sheet 1: Erfolgreich ────────────────────────────────────────────────
  const successDataCols = collectDataColumns(
    successLeads.map((l) => (l.data ?? {}) as Record<string, string>),
  );
  const sheet1Headers = [
    ...successDataCols,
    "Landingpage-URL",
    "Video-URL",
    ...(pdfEnabled ? ["PDF-URL"] : []),
  ];
  const sheet1Rows: string[][] = successLeads.map((lead) => {
    const data = (lead.data ?? {}) as Record<string, string>;
    const effectiveHost =
      lead.domainId && customHostname ? customHostname : null;
    const lpUrl =
      buildLeadPublicUrl(
        {
          slug: lead.slug,
          customHostname: effectiveHost,
          defaultAppUrl: appUrl,
        },
        { absolute: true },
      ) ?? "";
    const row = successDataCols.map((c) => data[c] ?? "");
    row.push(lpUrl);
    row.push(lead.videoUrl ?? "");
    if (pdfEnabled) row.push(lead.pdfUrl ?? "");
    return row;
  });

  // ── Sheet 2: Nicht durchgegangen ────────────────────────────────────────
  const excludedDataCols = collectDataColumns(excludedLeads.map((l) => l.data));
  const sheet2Headers = [...excludedDataCols, "Begründung", "Begründung-Detail"];
  const sheet2Rows: string[][] = excludedLeads.map((lead) => {
    const { label, detail } = buildExclusionReason(lead);
    const row = excludedDataCols.map((c) => lead.data[c] ?? "");
    row.push(label);
    row.push(detail);
    return row;
  });

  // ── XLSX bauen ──────────────────────────────────────────────────────────
  const wb = XLSX.utils.book_new();
  const ws1 = XLSX.utils.aoa_to_sheet([sheet1Headers, ...sheet1Rows]);
  const ws2 = XLSX.utils.aoa_to_sheet([sheet2Headers, ...sheet2Rows]);
  XLSX.utils.book_append_sheet(wb, ws1, "Erfolgreich");
  XLSX.utils.book_append_sheet(wb, ws2, "Nicht durchgegangen");
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
  const blob = new Blob([new Uint8Array(buf)], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });

  const safeName =
    run.name.replace(/[^a-zA-Z0-9-_]+/g, "_").slice(0, 80) || "runde";
  const fileName = `videocomet-${safeName}_leads.xlsx`;

  return new NextResponse(blob, {
    status: 200,
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "Cache-Control": "no-store",
    },
  });
}

/**
 * Akkumuliert in insertion-Order alle Keys, die in mindestens einem
 * data-Row auftauchen. Stabil über die CSV-Reihenfolge, weil die Leads
 * schon nach `rowIndex` sortiert ankommen.
 */
function collectDataColumns(rows: Record<string, string>[]): string[] {
  const seen = new Set<string>();
  const cols: string[] = [];
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (!seen.has(key)) {
        seen.add(key);
        cols.push(key);
      }
    }
  }
  return cols;
}

/**
 * Synthetisiert eine menschenlesbare Begründung pro Lead aus `removedReason`,
 * `removedDetail`, `preflightStatus`, `status` und `errorMessage`. Reihenfolge
 * der Checks entspricht der Spec-Priorität:
 *
 *   duplicate > incomplete_data > status=failed (rohstatus) >
 *   preflight-Problemfälle > user_rejected > fallback
 */
function buildExclusionReason(lead: ExcludedLeadRow): {
  label: string;
  detail: string;
} {
  const detail = lead.removedDetail;

  if (
    lead.removedReason === "duplicate" &&
    detail &&
    detail.reason === "duplicate"
  ) {
    const ruleLabel =
      detail.matchedRule.label.length > 0
        ? detail.matchedRule.label
        : "unbekannte Regel";
    return {
      label: "Duplikat",
      detail: `Duplikat von Zeile ${detail.duplicateOfRowIndex + 1} (Regel: ${ruleLabel})`,
    };
  }
  if (lead.removedReason === "duplicate") {
    return { label: "Duplikat", detail: "Duplikat (Details fehlen)" };
  }

  if (
    lead.removedReason === "incomplete_data" &&
    detail &&
    detail.reason === "incomplete_data"
  ) {
    const missing = detail.missingColumns;
    return {
      label: "Daten unvollständig",
      detail:
        missing.length > 0
          ? `Daten unvollständig: ${missing.join(", ")}`
          : "Daten unvollständig",
    };
  }
  if (lead.removedReason === "incomplete_data") {
    return {
      label: "Daten unvollständig",
      detail: "Daten unvollständig",
    };
  }

  // Pipeline-Failure als Rohstatus (Sweeper hat noch nicht soft-deleted) ODER
  // explizit als removed_reason=pipeline_failed/auto_failed markiert.
  if (
    lead.removedReason === "pipeline_failed" ||
    lead.removedReason === "auto_failed" ||
    (lead.status === "failed" && lead.removedAt === null)
  ) {
    return {
      label: "Pipeline-Fehler",
      detail: `Pipeline-Fehler: ${lead.errorMessage ?? "Unbekannt"}`,
    };
  }

  if (lead.removedReason === "user_rejected") {
    return { label: "Manuell entfernt", detail: "Manuell entfernt" };
  }

  // Kein expliziter removedReason → Begründung aus Preflight-Status ableiten.
  const preflight = preflightLabel(lead.preflightStatus);
  if (preflight) {
    return {
      label: preflight,
      detail: lead.preflightErrorMessage
        ? `${preflight}: ${lead.preflightErrorMessage}`
        : preflight,
    };
  }

  return {
    label: "Nicht erfolgreich",
    detail: "Nicht erfolgreich (siehe Status)",
  };
}

function preflightLabel(status: string): string | null {
  switch (status) {
    case "url_dead":
      return "Webseite nicht erreichbar";
    case "url_redirect":
      return "URL leitet weiter";
    case "missing_field":
      return "Pflichtfeld fehlt";
    case "duplicate":
      return "Duplikat (Preflight)";
    case "tls_error":
      return "TLS-Fehler";
    case "slow":
      return "Webseite zu langsam";
    case "bot_block":
      return "Bot-Schutz aktiv";
    case "screenshot_unavailable":
      return "Screenshot nicht verfügbar";
    case "unknown_error":
      return "Unbekannter Preflight-Fehler";
    default:
      return null;
  }
}
