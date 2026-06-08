import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { requireUser } from "@/lib/auth-guard";
import { getCampaign } from "@/lib/db/queries/campaigns";
import { listUserMedia } from "@/lib/db/queries/media";
import { listUserTpls } from "@/lib/db/queries/landingPageTemplates";
import { listUserDomains } from "@/lib/db/queries/user-domains";
import { EditCampaignForm, type EditCampaignData } from "./edit-form";

interface CustomLpApiRow {
  id: string;
  name: string;
  description: string | null;
  versionCount: number;
  activeVersion: { id: string } | null;
}

async function fetchCustomTemplates(): Promise<CustomLpApiRow[]> {
  const h = await headers();
  const proto = h.get("x-forwarded-proto") ?? "http";
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const cookie = h.get("cookie") ?? "";
  try {
    const res = await fetch(`${proto}://${host}/api/custom-lp`, {
      headers: { cookie },
      cache: "no-store",
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { templates?: CustomLpApiRow[] };
    return Array.isArray(data.templates) ? data.templates : [];
  } catch {
    return [];
  }
}

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

  const [webcams, templates, allMedia, domains, customTemplates] =
    await Promise.all([
      // Step 1 also accepts directly-uploaded videos (type=video), not just
      // webcam recordings — both serve as the spoken-segment source.
      listUserMedia(user.id, ["webcam", "video"]),
      listUserTpls(user.id),
      listUserMedia(user.id),
      listUserDomains(user.id),
      fetchCustomTemplates(),
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
      customLpTemplateId: campaign.customLpTemplateId ?? null,
      domainId: campaign.domainId ?? null,
      slugTemplate: campaign.slugTemplate ?? null,
      slugSuffix: campaign.slugSuffix ?? null,
      pdfEnabled: campaign.pdfEnabled,
      pdfGoogleDocsUrl: campaign.pdfGoogleDocsUrl ?? "",
      pdfQrEnabled: campaign.pdfQrEnabled,
      pdfThumbnailEnabled: campaign.pdfThumbnailEnabled,
      pdfThumbnailFrameMs: campaign.pdfThumbnailFrameMs ?? null,
      // Paket C — Personalisiertes Vorschaubild (Migration 0018).
      thumbnailImageEnabled: campaign.thumbnailImageEnabled,
      thumbnailImage: campaign.thumbnailImage ?? null,
      // Migration 0019 — Modus + Play-Icon-Overlay.
      thumbnailMode: campaign.thumbnailMode,
      thumbnailPlayIcon: campaign.thumbnailPlayIcon,
    },
    webcams: webcams.map((w) => ({
      id: w.id,
      name: w.name,
      publicUrl: w.publicUrl,
      durationSec: w.durationSec ?? null,
      kind: w.type === "video" ? "video" : "webcam",
    })),
    templates: templates.map((t) => ({
      id: t.id,
      name: t.name,
      themeId: t.themeId,
    })),
    customTemplates: customTemplates.map((t) => ({
      id: t.id,
      name: t.name,
      description: t.description,
      versionCount: t.versionCount,
      hasActiveVersion: Boolean(t.activeVersion),
    })),
    media: allMedia
      .filter(
        (m) =>
          m.type === "image" || m.type === "video" || m.type === "logo",
      )
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
  };

  return <EditCampaignForm data={data} />;
}
