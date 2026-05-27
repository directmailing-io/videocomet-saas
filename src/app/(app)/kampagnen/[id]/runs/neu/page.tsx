import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth-guard";
import { getCampaign } from "@/lib/db/queries/campaigns";
import { RunWizard } from "./run-wizard";

/**
 * Server entry for the new-run wizard. Resolves the parent campaign
 * (tenant-aware) and forwards it into the client wizard.
 */
export default async function NewRunPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { user } = await requireUser();

  let campaign;
  try {
    campaign = await getCampaign(id, user.id);
  } catch {
    notFound();
  }

  return (
    <RunWizard
      campaignId={campaign.id}
      campaignName={campaign.name}
      pdfEnabled={campaign.pdfEnabled}
    />
  );
}
