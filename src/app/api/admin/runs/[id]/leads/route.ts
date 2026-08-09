export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { asc, eq } from "drizzle-orm";
import { requireAdminApi } from "@/lib/auth-guard";
import { db } from "@/lib/db";
import { campaigns, leads, runs, userDomains } from "@/lib/db/schema";
import { buildLeadPublicUrl } from "@/lib/lead-public-url";

/**
 * GET /api/admin/runs/[id]/leads
 *
 * Admin-Drilldown: alle Leads einer Runde inkl. generierter Artefakte
 * (Video, Landingpage-Slug, Brief-/Umschlag-PDF) und Fehler-Details —
 * für Kunden-Support ("Bug bei Runde XYZ, Lead ABC").
 */

const NAME_KEYS = ["firstName", "Vorname", "first_name", "vorname"];
const LASTNAME_KEYS = ["lastName", "Nachname", "last_name", "nachname"];
const COMPANY_KEYS = ["company", "Firma", "companyName", "firma", "Unternehmen"];

function pick(data: Record<string, string>, keys: string[]): string {
  for (const k of keys) {
    const v = data[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
}

function leadDisplayName(
  data: Record<string, string>,
  rowIndex: number,
): string {
  const first = pick(data, NAME_KEYS);
  const last = pick(data, LASTNAME_KEYS);
  const name = [first, last].filter(Boolean).join(" ");
  if (name) return name;
  const company = pick(data, COMPANY_KEYS);
  if (company) return company;
  return `Zeile ${rowIndex + 1}`;
}

export async function GET(
  _req: Request,
  { params }: { params: { id: string } },
) {
  const auth = await requireAdminApi();
  if (!auth.ok) return auth.response;

  const [run] = await db
    .select({
      id: runs.id,
      name: runs.name,
      status: runs.status,
      userId: runs.userId,
      campaignDomainId: campaigns.domainId,
    })
    .from(runs)
    .innerJoin(campaigns, eq(campaigns.id, runs.campaignId))
    .where(eq(runs.id, params.id))
    .limit(1);
  if (!run) {
    return NextResponse.json({ error: "Nicht gefunden." }, { status: 404 });
  }

  let customHostname: string | null = null;
  if (run.campaignDomainId) {
    const [d] = await db
      .select({ hostname: userDomains.hostname, status: userDomains.status })
      .from(userDomains)
      .where(eq(userDomains.id, run.campaignDomainId))
      .limit(1);
    if (d && d.status === "active") customHostname = d.hostname;
  }

  const rows = await db
    .select({
      id: leads.id,
      rowIndex: leads.rowIndex,
      data: leads.data,
      slug: leads.slug,
      status: leads.status,
      errorMessage: leads.errorMessage,
      currentStage: leads.currentStage,
      attempts: leads.attempts,
      videoUrl: leads.videoUrl,
      videoMp4Url: leads.videoMp4Url,
      thumbnailUrl: leads.thumbnailUrl,
      pdfUrl: leads.pdfUrl,
      envelopePdfUrl: leads.envelopePdfUrl,
      introStatus: leads.introStatus,
      preflightStatus: leads.preflightStatus,
      preflightErrorMessage: leads.preflightErrorMessage,
      removedAt: leads.removedAt,
      removedReason: leads.removedReason,
      viewCount: leads.viewCount,
      completedAt: leads.completedAt,
    })
    .from(leads)
    .where(eq(leads.runId, params.id))
    .orderBy(asc(leads.rowIndex));

  return NextResponse.json({
    run: { id: run.id, name: run.name, status: run.status },
    leads: rows.map((l) => ({
      id: l.id,
      rowIndex: l.rowIndex,
      name: leadDisplayName(l.data ?? {}, l.rowIndex),
      slug: l.slug,
      // Immer Preview-Modus: Admin-Aufrufe duerfen keine Views tracken.
      lpUrl: buildLeadPublicUrl(
        { slug: l.slug, customHostname },
        { preview: true, absolute: true },
      ),
      status: l.status,
      errorMessage: l.errorMessage,
      currentStage: l.currentStage,
      attempts: l.attempts,
      videoUrl: l.videoUrl,
      videoMp4Url: l.videoMp4Url,
      thumbnailUrl: l.thumbnailUrl,
      pdfUrl: l.pdfUrl,
      envelopePdfUrl: l.envelopePdfUrl,
      introStatus: l.introStatus,
      preflightStatus: l.preflightStatus,
      preflightErrorMessage: l.preflightErrorMessage,
      removedAt: l.removedAt,
      removedReason: l.removedReason,
      viewCount: l.viewCount,
      completedAt: l.completedAt,
    })),
  });
}
