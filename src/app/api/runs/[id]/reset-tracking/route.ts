export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { requireUserApi } from "@/lib/auth-guard";
import { resetRunTracking } from "@/lib/db/queries/runs";

/**
 * POST /api/runs/[id]/reset-tracking
 *
 * Löscht alle erfassten Tracking-Daten für die Runde:
 *   - lead_events- und analytics_events-Rows für alle Leads der Runde
 *   - denormalisierte Tracking-Aggregate auf den Leads
 *     (viewCount, playCount, watchTimeSec, ctaClickCount,
 *      firstViewedAt, lastViewedAt, lastCtaAt)
 *
 * Lässt Pipeline-Ergebnisse (PDFs, Videos, Landingpages, Slugs, Status,
 * removed_at) sowie Pipeline-Logs und Run-Counter unberührt.
 *
 * Body: keine Parameter erforderlich.
 *
 * Tenant-Safety: nicht-eigene Run-IDs liefern 404 (nichts wird darüber
 * verraten, ob die ID existiert oder nicht).
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await requireUserApi();
  if (!auth.ok) return auth.response;

  try {
    const { leadsReset, leadEventsDeleted, analyticsEventsDeleted } =
      await resetRunTracking(params.id, auth.user.id);
    return NextResponse.json({
      ok: true,
      leadsReset,
      leadEventsDeleted,
      analyticsEventsDeleted,
    });
  } catch (err) {
    // `getRun` wirft mit "Not found" wenn der Run nicht zum User gehört
    // oder soft-deleted ist — beides → 404, ohne preisszugeben welcher Fall.
    if (err instanceof Error && err.message === "Not found") {
      return NextResponse.json({ error: "Nicht gefunden." }, { status: 404 });
    }
    // eslint-disable-next-line no-console
    console.error("[runs:reset-tracking] failed:", err);
    return NextResponse.json(
      { error: "Zurücksetzen fehlgeschlagen." },
      { status: 500 },
    );
  }
}
