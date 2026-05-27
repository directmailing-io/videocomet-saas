import { requireUser } from "@/lib/auth-guard";
import { listUserMedia } from "@/lib/db/queries/media";
import { listUserTpls } from "@/lib/db/queries/landingPageTemplates";
import { NewCampaignWizard } from "./wizard-container";

export default async function NeuePage() {
  const { user } = await requireUser();

  const [webcams, templates] = await Promise.all([
    listUserMedia(user.id, "webcam"),
    listUserTpls(user.id),
  ]);

  return (
    <NewCampaignWizard
      initialData={{
        webcams: webcams.map((w) => ({
          id: w.id,
          name: w.name,
          publicUrl: w.publicUrl,
          durationSec: w.durationSec ?? null,
        })),
        templates: templates.map((t) => ({
          id: t.id,
          name: t.name,
          themeId: t.themeId,
        })),
      }}
    />
  );
}
