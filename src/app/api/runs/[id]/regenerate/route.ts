export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { requireUserApi } from "@/lib/auth-guard";
import { getRun } from "@/lib/db/queries/runs";
import {
  parseRunRegenMode,
  regenerateRunCore,
  type RunRegenMode,
} from "@/lib/regenerate";

/**
 * POST /api/runs/[id]/regenerate
 *
 * Setzt eine abgeschlossene (oder fehlgeschlagene) Runde teilweise oder
 * komplett zurück und schickt Leads erneut durch die Pipeline.
 * Kern-Logik in @/lib/regenerate (geteilt mit der Admin-Route).
 *
 * Body (optional):
 *   { mode?: "all" | "video" | "pdf" | "envelope" | "landingpage" | "failed" }
 *   - "all"    (Default): alle Outputs zurücksetzen, volle Pipeline.
 *   - "video": nur Video neu (skipPdf).
 *   - "pdf":   nur Brief-PDF neu (skipVideo).
 *   - "envelope": nur Umschlag-PDF neu (skipVideo + skipPdf).
 *   - "landingpage": Custom-LP-Version re-snapshotten (keine Queue-Jobs).
 *   - "failed": nur Leads mit status='failed', volle Pipeline.
 *
 * Ein laufender Run wird mit 409 abgelehnt.
 */

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await requireUserApi();
  if (!auth.ok) return auth.response;

  let mode: RunRegenMode = "all";
  try {
    const ct = req.headers.get("content-type") ?? "";
    if (ct.includes("application/json")) {
      const body = (await req.json()) as { mode?: unknown };
      mode = parseRunRegenMode(body?.mode);
    }
  } catch {
    // Leerer / kaputter Body → Default behalten.
  }

  let run;
  try {
    run = await getRun(params.id, auth.user.id);
  } catch {
    return NextResponse.json({ error: "Nicht gefunden." }, { status: 404 });
  }

  const outcome = await regenerateRunCore(run, mode);
  return NextResponse.json(outcome.body, { status: outcome.status });
}
