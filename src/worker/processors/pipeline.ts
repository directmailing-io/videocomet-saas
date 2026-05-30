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
 *
 * Selective regeneration: when the job carries `skipVideo`/`skipPdf` flags
 * (set by /api/runs/[id]/regenerate?mode=…), the corresponding stages are
 * bypassed and the already-stored `lead.videoUrl` / `lead.thumbnailUrl` /
 * `lead.slug` / `lead.pdfUrl` are reused.
 */

import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { eq, sql } from "drizzle-orm";
import type { Job } from "bullmq";
import { db } from "@/lib/db";
import { campaigns, leads, mediaItems, runs } from "@/lib/db/schema";
import { updateLeadStatus } from "@/lib/db/queries/leads";
import { finalizeRunIfAllLeadsDone } from "@/lib/db/queries/runs";
import { insertPipelineEvent } from "@/lib/db/queries/pipeline-events";
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

/**
 * Downloads the Bunny CDN thumbnail JPG to a local file inside `outDir`.
 * Used by selective regeneration (skipVideo) so the PDF still embeds the
 * same thumbnail that the existing landing page is using — we cannot
 * re-extract a frame because we no longer have the source video locally.
 */
async function downloadThumb(
  thumbnailUrl: string,
  outDir: string,
): Promise<string> {
  const res = await fetch(thumbnailUrl);
  if (!res.ok) {
    throw new Error(
      `thumbnail fetch HTTP ${res.status} ${res.statusText} url=${thumbnailUrl}`,
    );
  }
  const buf = Buffer.from(await res.arrayBuffer());
  const outPath = join(outDir, "thumb.jpg");
  await writeFile(outPath, buf);
  return outPath;
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

  const skipVideo = data.skipVideo === true;
  const skipPdf = data.skipPdf === true;
  const leadLabel = `Lead ${lead.rowIndex + 1}`;
  const pipelineStartedAt = Date.now();

  await updateLeadStatus(data.leadId, {
    status: "rendering",
    startedAt: new Date(),
    errorMessage: null,
    attempts: (lead.attempts ?? 0) + 1,
  });

  await insertPipelineEvent({
    runId: data.runId,
    leadId: data.leadId,
    level: "info",
    stage: "run",
    message: `${leadLabel}: pipeline started${skipVideo || skipPdf ? ` (skipVideo=${skipVideo}, skipPdf=${skipPdf})` : ""}`,
  });

  try {
    // Stage outputs (filled lazily depending on skip flags). Defaults reuse
    // whatever the lead row already carries, so a selective regen leaves the
    // unrelated outputs intact.
    let bunnyVideoId: string | null = lead.bunnyVideoId ?? null;
    let videoUrl: string | null = lead.videoUrl ?? null;
    let pageUrl: string | null = null;
    let slug: string | null = lead.slug ?? null;
    let qrPngPath: string | null = null;
    let thumbFilePath: string | null = null;

    // ── Stages 1-2: Video render + upload ────────────────────────────
    if (!skipVideo) {
      if (!webcam?.publicUrl) {
        // Campaign-level config issue: the campaign row has no webcam
        // mediaId or the referenced media item has no publicUrl. We can't
        // fix this per-lead — every lead in the run will hit the same
        // error. Mark the lead failed with a clear, actionable message
        // (the user needs to attach a webcam clip to the campaign and
        // re-run) instead of the generic "[pipeline] campaign has no
        // webcam media" so the run-detail page surfaces the cause without
        // a deep-dive into the logs.
        throw new Error(
          `skipped: campaign "${campaign.name}" has no webcam media attached (campaignId=${campaign.id}). Attach a webcam clip in the campaign settings and re-run.`,
        );
      }
      const renderStart = Date.now();
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
      const renderMs = Date.now() - renderStart;
      await insertPipelineEvent({
        runId: data.runId,
        leadId: data.leadId,
        level: "info",
        stage: "render",
        message: `${leadLabel}: rendering done in ${(renderMs / 1000).toFixed(1)}s`,
        durationMs: renderMs,
      });

      await updateLeadStatus(data.leadId, { status: "uploading" });
      const uploadStart = Date.now();
      const upload = await runVideoUpload({
        leadId: data.leadId,
        videoFilePath: render.videoFilePath,
        title: `${campaign.name} – Lead ${lead.rowIndex}`,
      });
      bunnyVideoId = upload.bunnyVideoId;
      videoUrl = upload.videoUrl;
      const uploadMs = Date.now() - uploadStart;
      await insertPipelineEvent({
        runId: data.runId,
        leadId: data.leadId,
        level: "info",
        stage: "upload",
        message: `${leadLabel}: video upload done in ${(uploadMs / 1000).toFixed(1)}s`,
        durationMs: uploadMs,
      });

      // ── Stage 5 (early): Landingpage row + slug ──────────────────
      const lpStart = Date.now();
      const lp = await runLandingPageCreate({
        leadId: data.leadId,
        appUrl,
        prettyName: buildPrettyName(lead.data ?? {}),
      });
      slug = lp.slug;
      pageUrl = lp.pageUrl;
      await insertPipelineEvent({
        runId: data.runId,
        leadId: data.leadId,
        level: "info",
        stage: "landingpage",
        message: `${leadLabel}: landing page created (/v/${slug})`,
        durationMs: Date.now() - lpStart,
      });

      // ── Stage 3: Thumbnail ───────────────────────────────────────
      const thumbStart = Date.now();
      const thumb = await runThumbnailExtract({
        videoFilePath: render.videoFilePath,
        durationSec: render.durationSec,
        frameMs: campaign.pdfThumbnailFrameMs,
        outDir: workDir,
        enabled: campaign.pdfEnabled && campaign.pdfThumbnailEnabled,
      });
      thumbFilePath = thumb.thumbFilePath;
      if (campaign.pdfEnabled && campaign.pdfThumbnailEnabled) {
        await insertPipelineEvent({
          runId: data.runId,
          leadId: data.leadId,
          level: "info",
          stage: "thumbnail",
          message: `${leadLabel}: thumbnail extracted in ${((Date.now() - thumbStart) / 1000).toFixed(1)}s`,
          durationMs: Date.now() - thumbStart,
        });
      }
    } else {
      // Video stage skipped → reuse existing slug to rebuild pageUrl.
      // If the lead has no slug yet (selective regen on a never-completed
      // lead), generate one now so the QR / docx still get a valid URL.
      if (!slug) {
        const lp = await runLandingPageCreate({
          leadId: data.leadId,
          appUrl,
          prettyName: buildPrettyName(lead.data ?? {}),
        });
        slug = lp.slug;
        pageUrl = lp.pageUrl;
      } else {
        pageUrl = `${appUrl.replace(/\/+$/, "")}/v/${slug}`;
      }

      // For the PDF brief we still want the original thumbnail. Try to
      // pull the already-uploaded Bunny thumbnail down to disk; if that
      // fails we just skip the thumb replacement (the marker stays in
      // place but the rest of the PDF rebuilds correctly).
      if (
        campaign.pdfEnabled &&
        campaign.pdfThumbnailEnabled &&
        lead.thumbnailUrl
      ) {
        thumbFilePath = await downloadThumb(
          lead.thumbnailUrl,
          workDir,
        ).catch((err) => {
          console.warn(
            `[pipeline] could not fetch thumb for lead=${data.leadId}:`,
            err instanceof Error ? err.message : err,
          );
          return null;
        });
      }
    }

    // ── Stage 4: QR-Code ─────────────────────────────────────────────
    if (pageUrl) {
      const qrStart = Date.now();
      const qr = await runQrGenerate({
        outDir: workDir,
        pageUrl,
        enabled: campaign.pdfEnabled && campaign.pdfQrEnabled && !skipPdf,
      });
      qrPngPath = qr.qrPngPath;
      if (campaign.pdfEnabled && campaign.pdfQrEnabled && !skipPdf) {
        await insertPipelineEvent({
          runId: data.runId,
          leadId: data.leadId,
          level: "info",
          stage: "qr",
          message: `${leadLabel}: QR code generated`,
          durationMs: Date.now() - qrStart,
        });
      }
    }

    // ── Stages 6-9: PDF pipeline (only if enabled and not skipped) ──
    if (
      !skipPdf &&
      campaign.pdfEnabled &&
      campaign.pdfGoogleDocsUrl &&
      pageUrl
    ) {
      const pdfStart = Date.now();

      const docxStart = Date.now();
      const docx = await runDocxModify({
        outDir: workDir,
        googleDocsUrl: campaign.pdfGoogleDocsUrl,
        vars: buildDocxVars(lead.data ?? {}, pageUrl),
        qrPngPath,
        thumbJpgPath: thumbFilePath,
      });
      await insertPipelineEvent({
        runId: data.runId,
        leadId: data.leadId,
        level: "info",
        stage: "docx",
        message: `${leadLabel}: docx generated in ${((Date.now() - docxStart) / 1000).toFixed(1)}s`,
        durationMs: Date.now() - docxStart,
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
      await insertPipelineEvent({
        runId: data.runId,
        leadId: data.leadId,
        level: "info",
        stage: "pdf",
        message: `${leadLabel}: PDF rendered & uploaded in ${((Date.now() - pdfStart) / 1000).toFixed(1)}s`,
        durationMs: Date.now() - pdfStart,
      });
    }

    // ── Stage 10: mark complete ──────────────────────────────────────
    await updateLeadStatus(data.leadId, {
      status: "completed",
      completedAt: new Date(),
    });
    await insertPipelineEvent({
      runId: data.runId,
      leadId: data.leadId,
      level: "info",
      stage: "run",
      message: `${leadLabel}: completed in ${((Date.now() - pipelineStartedAt) / 1000).toFixed(1)}s`,
      durationMs: Date.now() - pipelineStartedAt,
    });

    // Run-Finalizer: wenn dies der letzte ausstehende Lead war, Run als
    // completed markieren. Idempotent — mehrere Lead-Jobs koennen den Check
    // gleichzeitig anstossen, nur der erste UPDATE faengt.
    await finalizeRunIfAllLeadsDone(data.runId)
      .then((res) => writeRunCompletionEventIfFinalized(data.runId, res))
      .catch((err) => {
        console.warn(
          `[pipeline] finalizeRunIfAllLeadsDone failed for run=${data.runId}:`,
          err instanceof Error ? err.message : err,
        );
      });

    return {
      ok: true,
      bunnyVideoId,
      videoUrl,
      pageUrl,
      skipVideo,
      skipPdf,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await updateLeadStatus(data.leadId, {
      status: "failed",
      errorMessage: message.slice(0, 1000),
    });
    await insertPipelineEvent({
      runId: data.runId,
      leadId: data.leadId,
      level: "error",
      stage: "run",
      message: `${leadLabel}: ${message.slice(0, 500)}`,
      durationMs: Date.now() - pipelineStartedAt,
    });
    // Auch im Fehlerfall den Run-Status checken — sonst haengt der Run
    // wenn der letzte Lead failt.
    await finalizeRunIfAllLeadsDone(data.runId)
      .then((res) => writeRunCompletionEventIfFinalized(data.runId, res))
      .catch(() => undefined);
    throw err;
  } finally {
    await cleanupTempDir(workDir);
  }
}

/**
 * Schreibt nach erfolgreichem Run-Finalize EIN Run-Level-Event mit der
 * Gesamttally (X done / Y failed / Z min). Wird sowohl im Success- als auch
 * im Error-Pfad aufgerufen — `finalized: true` faellt nur beim erstmaligen
 * UPDATE auf "completed", sodass das Event genau einmal erscheint.
 */
async function writeRunCompletionEventIfFinalized(
  runId: string,
  res: { finalized: boolean; total: number; done: number },
): Promise<void> {
  if (!res.finalized) return;
  try {
    const [runRow] = await db
      .select({
        startedAt: runs.startedAt,
        completedAt: runs.completedAt,
        completed: runs.completedLeads,
        failed: runs.failedLeads,
      })
      .from(runs)
      .where(eq(runs.id, runId))
      .limit(1);
    if (!runRow) return;

    // Live-Counts aus der finalize-Antwort sind authoritativer als die
    // gecachten Spalten auf runs.* (die werden bestenfalls best-effort
    // aktualisiert). Wir berechnen die Tally hier nochmal sauber.
    const [tally] = (await db.execute(sql`
      SELECT
        COUNT(*) FILTER (WHERE ${leads.status} = 'completed')::int AS completed,
        COUNT(*) FILTER (WHERE ${leads.status} = 'failed')::int AS failed
      FROM ${leads}
      WHERE ${leads.runId} = ${runId}
    `)) as unknown as Array<{ completed: number; failed: number }>;
    const tallyRow = Array.isArray(tally)
      ? tally
      : (tally as { rows?: Array<{ completed: number; failed: number }> })
          ?.rows?.[0];
    const completed = Number(
      (Array.isArray(tally) ? tally[0]?.completed : tallyRow?.completed) ?? 0,
    );
    const failed = Number(
      (Array.isArray(tally) ? tally[0]?.failed : tallyRow?.failed) ?? 0,
    );

    const startedAt = runRow.startedAt;
    const completedAt = runRow.completedAt ?? new Date();
    const durationMs =
      startedAt instanceof Date
        ? completedAt.getTime() - startedAt.getTime()
        : null;
    const minutes = durationMs != null ? Math.floor(durationMs / 60000) : null;
    const seconds = durationMs != null ? Math.floor((durationMs % 60000) / 1000) : null;
    const durationLabel =
      minutes != null && seconds != null
        ? `${minutes} min ${seconds} s`
        : "unbekannte Dauer";

    await insertPipelineEvent({
      runId,
      leadId: null,
      level: failed > 0 ? "warn" : "info",
      stage: "run",
      message: `Run abgeschlossen: ${completed} erfolgreich, ${failed} fehlgeschlagen in ${durationLabel}`,
      durationMs,
    });
  } catch (err) {
    console.warn(
      `[pipeline] writeRunCompletionEventIfFinalized failed for run=${runId}:`,
      err instanceof Error ? err.message : err,
    );
  }
}
