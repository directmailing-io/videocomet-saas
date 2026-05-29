/**
 * Pipeline orchestrator.
 *
 * Runs all 10 stages sequentially for a single Lead. Each stage updates the
 * lead's status in the DB so the live SSE table on the run-detail page can
 * track progress. Stages 6-9 (DOCX → PDF) are skipped when the campaign
 * has `pdfEnabled = false`.
 *
 * The pipeline takes a single BullMQ job (one Lead). Per-Lead failures are
 * recorded on the row (`status = failed`, `errorMessage`); BullMQ handles
 * retries via the queue's default options.
 */

import { eq } from "drizzle-orm";
import type { Job } from "bullmq";
import { db } from "@/lib/db";
import { campaigns, leads, mediaItems, runs } from "@/lib/db/schema";
import { updateLeadStatus } from "@/lib/db/queries/leads";
import { finalizeRunIfAllLeadsDone } from "@/lib/db/queries/runs";
import type { LeadJobData } from "../types";
import { createTempDir, cleanupTempDir } from "../lib/temp";
import { runVideoRender } from "./video-render";
import { runVideoUpload } from "./video-upload";
import { runThumbnailExtract } from "./thumbnail-extract";
import { runQrGenerate } from "./qr-generate";
import { runLandingPageCreate } from "./landingpage-create";
import { runDocxModify } from "./docx-modify";
import { runDocxToPdf } from "./docx-to-pdf";
import { runPdfCompress } from "./pdf-compress";
import { runPdfUpload } from "./pdf-upload";

/**
 * Look up the lead + run + campaign + webcam-media row in one Drizzle pass.
 * Returns null if anything is missing so the caller can fail the job cleanly.
 */
async function loadJobContext(jobData: LeadJobData) {
  const [leadRow] = await db
    .select()
    .from(leads)
    .where(eq(leads.id, jobData.leadId))
    .limit(1);
  if (!leadRow) return null;

  const [runRow] = await db
    .select()
    .from(runs)
    .where(eq(runs.id, jobData.runId))
    .limit(1);
  if (!runRow) return null;

  const [campaignRow] = await db
    .select()
    .from(campaigns)
    .where(eq(campaigns.id, jobData.campaignId))
    .limit(1);
  if (!campaignRow) return null;

  let webcam = null;
  if (campaignRow.webcamMediaId) {
    const [media] = await db
      .select()
      .from(mediaItems)
      .where(eq(mediaItems.id, campaignRow.webcamMediaId))
      .limit(1);
    webcam = media ?? null;
  }

  return { lead: leadRow, run: runRow, campaign: campaignRow, webcam };
}

function buildPrettyName(data: Record<string, string>): string {
  // Best-effort pretty name for the slug. Tries common columns first.
  const candidates = [
    "name",
    "fullName",
    "company",
    "Firma",
    "company_name",
    "Vorname",
    "first_name",
  ];
  for (const key of candidates) {
    const value = data[key];
    if (value && value.trim()) return value.trim();
  }
  const firstValue = Object.values(data).find((v) => v && v.trim());
  return firstValue ?? "";
}

/**
 * Picks the first non-empty value from `data` for any of the given keys
 * (case-insensitive). Returns "" when no candidate is set.
 */
function pickField(
  data: Record<string, string>,
  candidates: readonly string[],
): string {
  for (const key of candidates) {
    const value = data[key];
    if (value && value.trim()) return value.trim();
  }
  // Case-insensitive fallback.
  const lower = new Map<string, string>();
  for (const [k, v] of Object.entries(data)) lower.set(k.toLowerCase(), v);
  for (const key of candidates) {
    const v = lower.get(key.toLowerCase());
    if (v && v.trim()) return v.trim();
  }
  return "";
}

/**
 * Builds the `vars` map fed into `runDocxModify`. Starts from `lead.data`
 * (raw column-mapping output) and adds auto-derived fields so the template
 * author can use `{{landingpageUrl}}`, `{{firstName}}`, `{{lastName}}`
 * directly even if those columns aren't in the source spreadsheet.
 */
function buildDocxVars(
  leadData: Record<string, string>,
  landingpageUrl: string,
): Record<string, string> {
  const firstName = pickField(leadData, [
    "firstName",
    "Vorname",
    "first_name",
    "vorname",
  ]);
  const lastName = pickField(leadData, [
    "lastName",
    "Nachname",
    "last_name",
    "nachname",
  ]);
  return {
    ...leadData,
    landingpageUrl,
    landingpage_url: landingpageUrl,
    firstName,
    lastName,
  };
}

/**
 * Main entrypoint passed to `pipelineWorker(processor)`. Runs all stages
 * for one lead and returns a lightweight summary.
 */
export async function pipelineProcessor(
  job: Job<LeadJobData>,
): Promise<Record<string, unknown>> {
  const data = job.data;
  const ctx = await loadJobContext(data);
  if (!ctx) {
    throw new Error(`[pipeline] missing context for lead=${data.leadId}`);
  }
  const { lead, campaign, webcam } = ctx;

  const workDir = await createTempDir(`lead-${data.leadId.slice(0, 8)}`);
  const appUrl = process.env.APP_URL ?? "https://app.videocomet.de";

  await updateLeadStatus(data.leadId, {
    status: "rendering",
    startedAt: new Date(),
    errorMessage: null,
    attempts: (lead.attempts ?? 0) + 1,
  });

  try {
    if (!webcam?.publicUrl) {
      throw new Error("[pipeline] campaign has no webcam media");
    }

    // ── Stage 1: Video render ────────────────────────────────────────
    const render = await runVideoRender({
      outDir: workDir,
      mode: (campaign.mode === "with-presentation"
        ? "with-presentation"
        : "webcam-only") as "webcam-only" | "with-presentation",
      webcamSourceUrl: webcam.publicUrl,
      website: lead.data?.website ?? null,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      segments: (campaign.segments as any) ?? [],
      leadData: (lead.data ?? {}) as Record<string, string>,
      pip: {
        position: campaign.pipPosition?.includes("right") ? "right" : "left",
        shape:
          campaign.pipShape === "circle"
            ? "circle"
            : campaign.pipShape === "square"
              ? "square"
              : "rounded",
      },
      defaultDurationSec: webcam.durationSec ?? 30,
    });

    // ── Stage 2: Video upload ────────────────────────────────────────
    await updateLeadStatus(data.leadId, { status: "uploading" });
    const upload = await runVideoUpload({
      leadId: data.leadId,
      videoFilePath: render.videoFilePath,
      title: `${campaign.name} – Lead ${lead.rowIndex}`,
    });

    // ── Stage 5 (early): Landingpage row + slug ──────────────────────
    // Done before QR so we can encode the page URL into the QR PNG.
    const lp = await runLandingPageCreate({
      leadId: data.leadId,
      appUrl,
      prettyName: buildPrettyName(lead.data ?? {}),
    });

    // ── Stage 3: Thumbnail ───────────────────────────────────────────
    const thumb = await runThumbnailExtract({
      videoFilePath: render.videoFilePath,
      durationSec: render.durationSec,
      frameMs: campaign.pdfThumbnailFrameMs,
      outDir: workDir,
      enabled: campaign.pdfEnabled && campaign.pdfThumbnailEnabled,
    });

    // ── Stage 4: QR-Code ─────────────────────────────────────────────
    const qr = await runQrGenerate({
      outDir: workDir,
      pageUrl: lp.pageUrl,
      enabled: campaign.pdfEnabled && campaign.pdfQrEnabled,
    });

    // ── Stages 6-9: PDF pipeline (only if enabled) ───────────────────
    if (campaign.pdfEnabled && campaign.pdfGoogleDocsUrl) {
      const docx = await runDocxModify({
        outDir: workDir,
        googleDocsUrl: campaign.pdfGoogleDocsUrl,
        vars: buildDocxVars(lead.data ?? {}, lp.pageUrl),
        qrPngPath: qr.qrPngPath,
        thumbJpgPath: thumb.thumbFilePath,
      });

      const pdf = await runDocxToPdf({
        docxPath: docx.docxPath,
        outDir: workDir,
      });

      const compressed = await runPdfCompress({
        pdfPath: pdf.pdfPath,
        outDir: workDir,
      });

      await runPdfUpload({
        leadId: data.leadId,
        runId: data.runId,
        pdfPath: compressed.pdfPath,
      });
    }

    // ── Stage 10: mark complete ──────────────────────────────────────
    await updateLeadStatus(data.leadId, {
      status: "completed",
      completedAt: new Date(),
    });

    // Run-Finalizer: wenn dies der letzte ausstehende Lead war, Run als
    // completed markieren. Idempotent — mehrere Lead-Jobs koennen den Check
    // gleichzeitig anstossen, nur der erste UPDATE faengt.
    await finalizeRunIfAllLeadsDone(data.runId).catch((err) => {
      console.warn(
        `[pipeline] finalizeRunIfAllLeadsDone failed for run=${data.runId}:`,
        err instanceof Error ? err.message : err,
      );
    });

    return {
      ok: true,
      bunnyVideoId: upload.bunnyVideoId,
      videoUrl: upload.videoUrl,
      pageUrl: lp.pageUrl,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await updateLeadStatus(data.leadId, {
      status: "failed",
      errorMessage: message.slice(0, 1000),
    });
    // Auch im Fehlerfall den Run-Status checken — sonst haengt der Run
    // wenn der letzte Lead failt.
    await finalizeRunIfAllLeadsDone(data.runId).catch(() => undefined);
    throw err;
  } finally {
    await cleanupTempDir(workDir);
  }
}
