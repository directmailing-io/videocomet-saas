import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth-guard";
import { getCampaign } from "@/lib/db/queries/campaigns";
import { WizardV4 } from "./wizard-v4";

/**
 * Runden-Wizard-Einstieg.
 *
 * Zeigt den 5-Screen-Wizard (früher v4). Die alten Wizard-Dateien
 * (run-wizard.tsx, source-picker.tsx, tab-picker.tsx, dedupe-card,
 * step-placeholders, value-rules-dialog) wurden am 2026-08-17
 * entfernt.
 *
 * Optionale ?listId= im Query bringt eine bereits gewählte Liste mit
 * (kommt aus /kontakte "Runde starten"-Modal) und springt den Wizard
 * direkt zu Step 3 (Optionen), weil Import und Duplikat-Check nicht
 * mehr nötig sind.
 */
export default async function NewRunPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const { user } = await requireUser();

  const campaign = await getCampaign(id, user.id);
  if (!campaign) notFound();

  const preselectedListId = typeof sp.listId === "string" ? sp.listId : null;

  return (
    <WizardV4
      campaignId={campaign.id}
      campaignName={campaign.name}
      campaignMode={
        campaign.mode === "webcam-only" ? "webcam-only" : "with-presentation"
      }
      pdfEnabled={campaign.pdfEnabled}
      preselectedListId={preselectedListId}
    />
  );
}
