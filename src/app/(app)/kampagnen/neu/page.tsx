import { headers } from "next/headers";
import { requireUser } from "@/lib/auth-guard";
import { listUserMedia } from "@/lib/db/queries/media";
import { listUserTpls } from "@/lib/db/queries/landingPageTemplates";
import { listUserDomains } from "@/lib/db/queries/user-domains";
import { getCampaign } from "@/lib/db/queries/campaigns";
import { NewCampaignWizard } from "./wizard-container";

interface CustomLpApiRow {
  id: string;
  name: string;
  description: string | null;
  versionCount: number;
  thumbnailUrl: string | null;
  activeVersion: { id: string } | null;
}

/**
 * Holt die Custom-LP-Vorlagen des Users über Agent As API. Wir nutzen
 * den HTTP-Endpoint statt einen direkten DB-Query, weil die Such-/
 * Authorisierungslogik dort zentralisiert ist und Agent A noch keinen
 * exportierten `listUserCustomLpTemplates`-Helper hat.
 *
 * Bei Fehler fallen wir auf eine leere Liste zurück — der Wizard bleibt
 * benutzbar (nur ohne Custom-Tab).
 */
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

export default async function NeuePage({
  searchParams,
}: {
  searchParams: Promise<{ draft?: string }>;
}) {
  const { user } = await requireUser();
  const { draft: draftParam } = await searchParams;

  // Server-Draft-Resume (Migration 0052): `?draft=<id>` lädt einen
  // Entwurf. Ungültige/fremde IDs oder bereits aktivierte Kampagnen
  // werden ignoriert → frischer Wizard.
  let initialDraft: { id: string; envelope: unknown } | null = null;
  if (draftParam) {
    try {
      const campaign = await getCampaign(draftParam, user.id);
      if (campaign.status === "draft") {
        initialDraft = { id: campaign.id, envelope: campaign.wizardState };
      }
    } catch {
      // Nicht gefunden → frisch starten.
    }
  }

  const [webcams, templates, allMedia, domains, customTemplates] =
    await Promise.all([
      // Step 1 picks any "human-spoken" video: classic webcam recordings AND
      // videos the user uploaded directly to the media library. They behave
      // the same way downstream — both serve as the spoken-segment source.
      listUserMedia(user.id, ["webcam", "video"]),
      listUserTpls(user.id),
      // Editor needs images + videos for image / video segments
      listUserMedia(user.id),
      listUserDomains(user.id),
      fetchCustomTemplates(),
    ]);

  return (
    <NewCampaignWizard
      key={initialDraft?.id ?? "new"}
      userId={user.id}
      initialDraft={initialDraft}
      initialData={{
        webcams: webcams.map((w) => ({
          id: w.id,
          name: w.name,
          publicUrl: w.publicUrl,
          durationSec: w.durationSec ?? null,
          kind: w.type === "video" ? "video" : "webcam",
          width: w.width ?? null,
          height: w.height ?? null,
        })),
        templates: templates.map((t) => ({
          id: t.id,
          name: t.name,
          themeId: t.themeId,
          content: t.content,
        })),
        customTemplates: customTemplates.map((t) => ({
          id: t.id,
          name: t.name,
          description: t.description,
          versionCount: t.versionCount,
          thumbnailUrl: t.thumbnailUrl ?? null,
          hasActiveVersion: Boolean(t.activeVersion),
        })),
        media: allMedia
          .filter(
            (m) =>
              m.type === "image" ||
              m.type === "video" ||
              m.type === "logo",
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
      }}
    />
  );
}
