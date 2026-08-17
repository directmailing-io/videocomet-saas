import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth-guard";
import { getCampaign } from "@/lib/db/queries/campaigns";
import { WizardV4 } from "./wizard-v4";

/**
 * Neuer Runden-Wizard (v4). Parallel zum alten `/neu`-Wizard, hinter
 * einem Feature-Flag pro User freigeschaltet (Etappe 4). Nach Beta wird
 * der alte Wizard entfernt (Etappe 5).
 */
export default async function NewRunV4Page({
  params,
}: {
  params: { id: string };
}) {
  const { user } = await requireUser();
  const campaign = await getCampaign(params.id, user.id);
  if (!campaign) notFound();

  return (
    <WizardV4
      campaignId={campaign.id}
      campaignName={campaign.name}
      campaignMode={campaign.mode as "webcam-only" | "with-presentation"}
      pdfEnabled={campaign.pdfEnabled}
    />
  );
}
