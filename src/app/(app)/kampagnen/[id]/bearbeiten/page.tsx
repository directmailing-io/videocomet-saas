import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth-guard";
import { getCampaign } from "@/lib/db/queries/campaigns";
import { listUserMedia } from "@/lib/db/queries/media";
import { listUserTpls } from "@/lib/db/queries/landingPageTemplates";
import { EditCampaignForm, type EditCampaignData } from "./edit-form";

export default async function CampaignEditPage({
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

  const [webcams, templates, allMedia] = await Promise.all([
    listUserMedia(user.id, "webcam"),
    listUserTpls(user.id),
    listUserMedia(user.id),
  ]);

  const data: EditCampaignData = {
    campaign: {
      id: campaign.id,
      name: campaign.name,
      mode: campaign.mode as "webcam-only" | "with-presentation",
      webcamMediaId: campaign.webcamMediaId,
      pipPosition:
        (campaign.pipPosition as "bottom-left" | "bottom-right" | null) ??
        "bottom-left",
      pipShape:
        (campaign.pipShape as "square" | "rounded" | "circle" | null) ??
        "rounded",
      landingPageTemplateId: campaign.landingPageTemplateId,
      pdfEnabled: campaign.pdfEnabled,
      pdfGoogleDocsUrl: campaign.pdfGoogleDocsUrl ?? "",
      pdfQrEnabled: campaign.pdfQrEnabled,
      pdfThumbnailEnabled: campaign.pdfThumbnailEnabled,
      pdfThumbnailFrameMs: campaign.pdfThumbnailFrameMs ?? null,
    },
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
  };

  return <EditCampaignForm data={data} />;
}
