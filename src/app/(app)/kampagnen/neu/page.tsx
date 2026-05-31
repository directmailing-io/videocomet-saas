import { requireUser } from "@/lib/auth-guard";
import { listUserMedia } from "@/lib/db/queries/media";
import { listUserTpls } from "@/lib/db/queries/landingPageTemplates";
import { listUserDomains } from "@/lib/db/queries/user-domains";
import { NewCampaignWizard } from "./wizard-container";

export default async function NeuePage() {
  const { user } = await requireUser();

  const [webcams, templates, allMedia, domains] = await Promise.all([
    listUserMedia(user.id, "webcam"),
    listUserTpls(user.id),
    // Editor needs images + videos for image / video segments
    listUserMedia(user.id),
    listUserDomains(user.id),
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
        media: allMedia
          .filter((m) => m.type === "image" || m.type === "video")
          .map((m) => ({
            id: m.id,
            name: m.name,
            publicUrl: m.publicUrl,
            type: m.type,
          })),
        domains: domains.map((d) => ({
          id: d.id,
          hostname: d.hostname,
          status: d.status,
          kind: d.kind,
        })),
      }}
    />
  );
}
