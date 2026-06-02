import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth-guard";
import { getCampaign } from "@/lib/db/queries/campaigns";
import { getRun } from "@/lib/db/queries/runs";
import { PreflightReviewClient } from "./preflight-review-client";

/**
 * Server-Entrypoint für das Quality-Check-Grid einer Runde.
 *
 * Wir laden hier bewusst NUR die Authentifizierungs-Wurzel (User +
 * Kampagnen-/Run-Existenz). Die eigentliche Lead-Liste und die Live-
 * Counts holt die Client-Komponente per fetch — so vermeiden wir, dass
 * der Server-Roundtrip beim ersten Render den TTFB blockiert, wenn die
 * `leads`-Tabelle bei einem 500-Lead-Run gerade noch im Schreibe-Burst
 * der Phase-1-Worker steht.
 *
 * Die zugehörigen API-Routen (`/api/runs/[id]/preflight/*`) liefert
 * Agent 1 separat aus. Diese Page-Komponente kennt nur ihren Vertrag.
 */
export default async function PreflightReviewPage({
  params,
}: {
  params: Promise<{ id: string; runId: string }>;
}) {
  const { id, runId } = await params;
  const { user } = await requireUser();

  let campaign;
  let run;
  try {
    campaign = await getCampaign(id, user.id);
    run = await getRun(runId, user.id);
    if (run.campaignId !== campaign.id) notFound();
  } catch {
    notFound();
  }

  return (
    <PreflightReviewClient
      campaignId={campaign.id}
      campaignName={campaign.name}
      runId={run.id}
      runName={run.name}
    />
  );
}
