import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { campaigns, customLpTemplates, leads } from "@/lib/db/schema";
import { removeStreamAssetRefsForGuids } from "@/lib/db/queries/bunny-assets";
import { updateRun } from "@/lib/db/queries/runs";
import { pipelineQueue } from "@/worker/queue";
import { leadJobPriority } from "@/lib/queue-priority";

/**
 * Gemeinsamer Kern für Lead-/Run-Regenerierung. Wird von den User-Routen
 * (/api/leads/[id]/regenerate, /api/runs/[id]/regenerate) UND den Admin-
 * Routen (/api/admin/...) genutzt. Ownership/Guards macht der Aufrufer —
 * hier zählt nur die owner-userId des Runs (für Asset-Refs + Job-Daten),
 * NICHT die des eingeloggten Users (Admin regeneriert fremde Runs).
 */

export type LeadRegenScope = "all" | "video" | "pdf" | "envelope";
export type RunRegenMode =
  | "all"
  | "video"
  | "pdf"
  | "envelope"
  | "landingpage"
  | "failed";

const RUN_REGEN_MODES: ReadonlyArray<RunRegenMode> = [
  "all",
  "video",
  "pdf",
  "envelope",
  "landingpage",
  "failed",
];

export function parseRunRegenMode(input: unknown): RunRegenMode {
  return RUN_REGEN_MODES.includes(input as RunRegenMode)
    ? (input as RunRegenMode)
    : "all";
}

export interface RegenOutcome {
  status: number;
  body: Record<string, unknown>;
}

export async function regenerateLeadCore(
  input: {
    leadId: string;
    runId: string;
    campaignId: string;
    ownerUserId: string;
    runStatus: string;
    rowIndex: number;
  },
  scope: LeadRegenScope,
): Promise<RegenOutcome> {
  if (input.runStatus === "generating") {
    return {
      status: 409,
      body: { error: "Runde läuft bereits — bitte warten." },
    };
  }

  // Reset abhaengig vom Scope. slug NIE anfassen — Tracking-URLs muessen
  // stabil bleiben. status wird auf "pending" gesetzt damit die
  // Live-Tabelle den Fortschritt neu tracked.
  const patch: Record<string, unknown> = {
    status: "pending" as const,
    errorMessage: null,
    startedAt: null,
    completedAt: null,
    updatedAt: new Date(),
  };
  const skipVideo = scope === "pdf" || scope === "envelope";
  const skipPdf = scope === "video" || scope === "envelope";
  if (scope === "all" || scope === "video") {
    patch.videoUrl = null;
    patch.videoMp4Url = null;
    patch.bunnyVideoId = null;
    patch.thumbnailUrl = null;
  }
  if (scope === "all" || scope === "pdf") {
    patch.pdfUrl = null;
  }
  if (scope === "all" || scope === "envelope") {
    patch.envelopePdfUrl = null;
    patch.envelopePdfExpiresAt = null;
  }

  await db.update(leads).set(patch).where(eq(leads.id, input.leadId));

  // Re-enqueue diesen einen Lead. Skip-Flags steuern welche Stages
  // ausgefuehrt werden; die Stages selbst haben eigene Idempotenz-Guards
  // (videoAlreadyDone/pdfAlreadyDone), sodass ein "envelope"-only-Regen
  // videoUrl + pdfUrl unangetastet laesst und nur Stage 9b (Envelope)
  // ausfuehrt.
  try {
    const queue = pipelineQueue();
    // BullMQ dedupliziert per jobId — eindeutiger jobId pro Regenerate
    // (leadId + Timestamp), damit BullMQ ihn immer annimmt.
    // WICHTIG: BullMQ verbietet ":" in Custom-jobIds — deshalb "-" statt ":"
    const jobId = `${input.leadId}-regen-${Date.now()}`;
    await queue.add(
      "lead-pipeline",
      {
        leadId: input.leadId,
        runId: input.runId,
        userId: input.ownerUserId,
        campaignId: input.campaignId,
        ...(skipVideo ? { skipVideo: true } : {}),
        ...(skipPdf ? { skipPdf: true } : {}),
      },
      { jobId, priority: leadJobPriority(input.rowIndex) },
    );
  } catch (err) {
    return {
      status: 503,
      body: {
        error: "Job konnte nicht eingereiht werden (Redis?).",
        details: err instanceof Error ? err.message : null,
      },
    };
  }

  return { status: 200, body: { ok: true, scope } };
}

async function resolveActiveCustomLpVersionId(
  campaignId: string,
): Promise<string | null> {
  const [row] = await db
    .select({
      customLpTemplateId: campaigns.customLpTemplateId,
      activeVersionId: customLpTemplates.activeVersionId,
    })
    .from(campaigns)
    .leftJoin(
      customLpTemplates,
      eq(customLpTemplates.id, campaigns.customLpTemplateId),
    )
    .where(eq(campaigns.id, campaignId))
    .limit(1);
  if (!row || !row.customLpTemplateId) return null;
  return row.activeVersionId ?? null;
}

export async function regenerateRunCore(
  run: {
    id: string;
    userId: string;
    campaignId: string;
    status: string;
    sharedBunnyVideoId: string | null;
  },
  mode: RunRegenMode,
): Promise<RegenOutcome> {
  if (run.status === "generating") {
    return {
      status: 409,
      body: { error: "Runde läuft bereits — bitte warten oder abbrechen." },
    };
  }

  // "landingpage" ist ein Sonderfall: Landingpages werden zur Laufzeit aus
  // der DB gerendert (Stage 5 schreibt nur den Slug). "Neu generieren"
  // heißt hier: die auf dem Run gepinnte Custom-LP-Version auf den
  // aktuellen aktiven Stand der Vorlage re-snapshotten. Kein Lead-Reset,
  // keine Queue-Jobs, kein Status-Wechsel nötig — Block-Landingpages
  // ziehen ihre Inhalte ohnehin immer live aus der Kampagne.
  if (mode === "landingpage") {
    const customLpVersionId = await resolveActiveCustomLpVersionId(
      run.campaignId,
    );
    await updateRun(run.id, run.userId, { customLpVersionId });
    return {
      status: 200,
      body: { ok: true, mode, totalLeads: 0, retried: 0 },
    };
  }

  // Lead-IDs in row-Reihenfolge holen — für stabile Re-enqueue-Order.
  const allLeadRows = await db
    .select({
      id: leads.id,
      rowIndex: leads.rowIndex,
      status: leads.status,
      bunnyVideoId: leads.bunnyVideoId,
    })
    .from(leads)
    .where(eq(leads.runId, run.id));

  if (allLeadRows.length === 0) {
    return { status: 400, body: { error: "Keine Leads in dieser Runde." } };
  }

  const leadRows =
    mode === "failed"
      ? allLeadRows.filter((l) => l.status === "failed")
      : allLeadRows;

  if (mode === "failed" && leadRows.length === 0) {
    return {
      status: 400,
      body: { error: "Keine fehlgeschlagenen Leads in dieser Runde." },
    };
  }

  leadRows.sort((a, b) => a.rowIndex - b.rowIndex);

  const baseReset = {
    status: "pending" as const,
    errorMessage: null,
    startedAt: null,
    completedAt: null,
    // Frischer Zähler: die Stuck-Recovery im Worker requeut nur Leads mit
    // attempts < 3 — ohne Reset würde ein manuell regenerierter Lead nach
    // vielen früheren Fehlversuchen sofort wieder als "ausgeschöpft" gelten.
    attempts: 0,
  };
  // `bunny_video_id` + `videoMp4Url` müssen synchron zu `video_url` resetted
  // werden — sonst zeigen Landingpage/Custom-LP-Renderer auf alte Bunny-
  // Assets, während die neue Pipeline noch läuft.
  const resetPatch =
    mode === "all"
      ? {
          ...baseReset,
          bunnyVideoId: null,
          videoContentHash: null,
          videoUrl: null,
          videoMp4Url: null,
          pdfUrl: null,
          thumbnailUrl: null,
        }
      : mode === "video"
        ? {
            ...baseReset,
            bunnyVideoId: null,
            videoContentHash: null,
            videoUrl: null,
            videoMp4Url: null,
            thumbnailUrl: null,
          }
        : mode === "pdf"
          ? {
              ...baseReset,
              pdfUrl: null,
            }
          : mode === "envelope"
            ? {
                ...baseReset,
                envelopePdfUrl: null,
                envelopePdfExpiresAt: null,
              }
            : // mode === "failed": keine URLs anfassen, nur Status/Error/Timestamps
              baseReset;

  // Asset-Deref VOR dem Reset: ohne das Lösen der bunny_asset_refs hielte
  // der alte Ref das Video für immer "referenziert" — der Purge-Worker
  // würde die verwaisten Videos nie aufräumen.
  if (mode === "all" || mode === "video") {
    const staleGuids = new Set<string>();
    for (const lr of leadRows) {
      if (lr.bunnyVideoId) staleGuids.add(lr.bunnyVideoId);
    }
    if (run.sharedBunnyVideoId) staleGuids.add(run.sharedBunnyVideoId);
    const owners: Array<{ ownerType: "lead" | "run"; ownerId: string }> =
      leadRows.map((lr) => ({ ownerType: "lead" as const, ownerId: lr.id }));
    if (run.sharedBunnyVideoId) {
      owners.push({ ownerType: "run", ownerId: run.id });
    }
    if (staleGuids.size > 0) {
      await removeStreamAssetRefsForGuids(
        run.userId,
        Array.from(staleGuids),
        owners,
      ).catch((err) => {
        // eslint-disable-next-line no-console
        console.warn("[regenerate] asset deref failed:", err);
      });
    }
  }

  if (mode === "failed") {
    const failedIds = leadRows.map((l) => l.id);
    await db
      .update(leads)
      .set(resetPatch)
      .where(and(eq(leads.runId, run.id), inArray(leads.id, failedIds)));
  } else {
    await db.update(leads).set(resetPatch).where(eq(leads.runId, run.id));
  }

  // Re-snapshot der aktuell aktiven Custom-LP-Version: ein Regenerate soll
  // explizit den NEUSTEN Stand der Vorlage übernehmen.
  const customLpVersionId = await resolveActiveCustomLpVersionId(
    run.campaignId,
  );

  // Shared-Run-Video-Cache invalidieren wenn Video neu generiert wird.
  const resetSharedVideo = mode === "all" || mode === "video";
  await updateRun(run.id, run.userId, {
    status: "generating",
    startedAt: new Date(),
    completedAt: null,
    customLpVersionId,
    ...(resetSharedVideo
      ? {
          sharedBunnyVideoId: null,
          sharedVideoUrl: null,
          sharedThumbnailUrl: null,
          sharedVideoUploadStartedAt: null,
        }
      : {}),
  });

  // "envelope" überspringt Video- UND PDF-Stages — nur die Envelope-Stage
  // läuft (analog Lead-scope "envelope"): envelopePdfUrl wurde genullt,
  // die Idempotenz-Guards der anderen Stages greifen.
  const skipVideo = mode === "pdf" || mode === "envelope";
  const skipPdf = mode === "video" || mode === "envelope";
  try {
    const queue = pipelineQueue();
    // Verwaiste Retries aufräumen: von früheren Fehlversuchen können noch
    // delayed/waiting Jobs für dieselben Leads in der Queue liegen. Ohne
    // Cleanup laufen ZWEI Pipelines pro Lead parallel.
    try {
      const stale = await queue.getJobs([
        "delayed",
        "waiting",
        "prioritized",
        "paused",
      ]);
      const targetLeadIds = new Set(leadRows.map((lr) => lr.id));
      await Promise.allSettled(
        stale
          .filter(
            (j) => j?.data?.runId === run.id && targetLeadIds.has(j.data.leadId),
          )
          .map((j) => j.remove()),
      );
    } catch (cleanupErr) {
      // eslint-disable-next-line no-console
      console.warn("[regenerate] stale-job cleanup failed:", cleanupErr);
    }
    const nowStamp = Date.now();
    await queue.addBulk(
      leadRows.map((lr) => ({
        name: "lead-pipeline",
        data: {
          leadId: lr.id,
          runId: run.id,
          userId: run.userId,
          campaignId: run.campaignId,
          ...(skipVideo ? { skipVideo: true } : {}),
          ...(skipPdf ? { skipPdf: true } : {}),
        },
        // WICHTIG: BullMQ verbietet ":" in Custom-jobIds — deshalb "-" statt ":"
        opts: {
          jobId: `${lr.id}-regen-${nowStamp}`,
          priority: leadJobPriority(lr.rowIndex),
        },
      })),
    );
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[regenerate] enqueue failed:", err);
    return {
      status: 503,
      body: {
        ok: false,
        error:
          "Leads zurückgesetzt, aber die Job-Queue ist nicht erreichbar. Bitte Worker prüfen.",
      },
    };
  }

  return {
    status: 200,
    body: {
      ok: true,
      mode,
      totalLeads: leadRows.length,
      retried: leadRows.length,
    },
  };
}
