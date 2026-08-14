import { notFound, redirect } from "next/navigation";
import { and, count, eq, inArray } from "drizzle-orm";
import { requireUser } from "@/lib/auth-guard";
import { getCampaign } from "@/lib/db/queries/campaigns";
import { listUserMedia } from "@/lib/db/queries/media";
import { db } from "@/lib/db";
import { runs } from "@/lib/db/schema";
import type { Segment } from "@/lib/segments/types";
import { EditorClient } from "./editor-client";

/**
 * /kampagnen/[id]/editor — Re-Entry in den Video-Editor (Wizard-Schritt 3)
 * für bereits erstellte Kampagnen im Modus "with-presentation".
 *
 * Entwürfe haben keinen eigenen Editor — sie leben im Wizard und werden
 * dorthin zurückgeleitet (gleiches Muster wie die Detailseite).
 */
export default async function CampaignEditorPage({
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

  // Entwürfe → zurück in den Wizard (Server-Draft-Resume, Migration 0052).
  if (campaign.status === "draft") {
    redirect(`/kampagnen/neu?draft=${campaign.id}`);
  }
  // Ohne Präsentations-Modus gibt es keine Segment-Timeline → Detailseite.
  if (campaign.mode !== "with-presentation") {
    redirect(`/kampagnen/${campaign.id}`);
  }

  // Parallel: alle Media-Items (Editor-Auswahl + Webcam-Quelle) und die
  // Anzahl laufender Runden (Warn-Banner: neue Segmente greifen nur für
  // noch nicht gerenderte Leads).
  const activeRunStatuses = [
    "mapping",
    "preflighting",
    "awaiting_approval",
    "approved",
    "generating",
  ] as const;
  const [allMedia, activeRunRows] = await Promise.all([
    listUserMedia(user.id),
    db
      .select({ n: count() })
      .from(runs)
      .where(
        and(
          eq(runs.campaignId, campaign.id),
          eq(runs.userId, user.id),
          inArray(runs.status, [...activeRunStatuses]),
        ),
      ),
  ]);
  const activeRunCount = Number(activeRunRows[0]?.n ?? 0);

  // Webcam der Kampagne (URL + Dauer für die Editor-Vorschau).
  const webcam = campaign.webcamMediaId
    ? allMedia.find((m) => m.id === campaign.webcamMediaId) ?? null
    : null;

  return (
    <EditorClient
      campaignId={campaign.id}
      campaignName={campaign.name}
      initialSegments={((campaign.segments ?? []) as Segment[])}
      initialPipPosition={
        (campaign.pipPosition as "bottom-left" | "bottom-right" | null) ??
        "bottom-left"
      }
      initialPipShape={
        (campaign.pipShape as "square" | "rounded" | "circle" | null) ??
        "rounded"
      }
      webcamUrl={webcam?.publicUrl ?? null}
      webcamDurationSec={webcam?.durationSec ?? null}
      mediaItems={allMedia
        .filter(
          (m) => m.type === "image" || m.type === "video" || m.type === "logo",
        )
        .map((m) => ({
          id: m.id,
          name: m.name,
          publicUrl: m.publicUrl,
          type: m.type,
        }))}
      activeRunCount={activeRunCount}
    />
  );
}
