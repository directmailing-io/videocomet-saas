import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/lib/auth-guard";
import { getRun } from "@/lib/db/queries/runs";

/**
 * Alte Route — der Versand lebt jetzt als Tab direkt auf der Runden-Seite.
 * Gespeicherte Links (Dashboard, Mails, Browserverlauf) landen dort.
 */
export default async function VersandRunPage({
  params,
}: {
  params: Promise<{ runId: string }>;
}) {
  const { runId } = await params;
  const { user } = await requireUser();

  let run;
  try {
    run = await getRun(runId, user.id);
  } catch {
    notFound();
  }

  redirect(`/kampagnen/${run.campaignId}/runs/${run.id}?tab=versand`);
}
