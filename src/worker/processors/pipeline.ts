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
 *
 * Idempotency (auto-skip on retry): independently of the explicit skip
 * flags above, every stage checks whether its persisted output is already
 * present on the `lead` row. A retry (BullMQ attempt #2, stuck-recovery,
 * etc.) reuses what's already done rather than redoing expensive work:
 *
 *   stage              skip-when                       fallback
 *   ─────────────────  ──────────────────────────────  ────────────────────
 *   videoRender        lead.videoUrl set               reuse bunnyVideoId/videoUrl
 *   videoUpload        lead.videoUrl set               reuse bunnyVideoId/videoUrl
 *   landingPageCreate  lead.slug set                   pageUrl = APP_URL + /v/slug
 *   thumbnailExtract   lead.thumbnailUrl set           downloadThumb -> workDir/thumb.jpg
 *   qrGenerate         never (cheap; slug may change)  always regen
 *   docx → pdfUpload   lead.pdfUrl set                 reuse pdfUrl as-is
 *
 * `setCurrentStage(leadId, stage)` writes `leads.current_stage` at the
 * start of every stage and clears it in the `finally` block, so stuck-
 * recovery can find where a job hung.
 */

import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { eq, sql } from "drizzle-orm";
import type { Job } from "bullmq";
import { db } from "@/lib/db";
import { campaigns, leads, mediaItems, runs, userDomains } from "@/lib/db/schema";
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
import { substitute as substitutePlaceholder } from "@/lib/placeholders/substitute";
import { runDocxToPdf } from "./docx-to-pdf";
import { runPdfCompress } from "./pdf-compress";
import { runPdfUpload } from "./pdf-upload";

/**
 * Per-stage hard-timeout values (ms). These bound each pipeline stage
 * independently so a single hanging Puppeteer / LibreOffice / ffmpeg
 * call cannot tie up a worker slot beyond its known-good ceiling.
 * Numbers are based on observed p99 durations + headroom. The sum
 * (~350s) plus orchestration overhead must stay under the global
 * pipeline timeout in `src/worker/index.ts`.
 */
const STAGE_TIMEOUTS_MS = {
  videoRender: 120_000, // CDP screencast is realtime: 60s clip + 60s buffer
  videoUpload: 60_000, // Bunny stream upload is fast
  landingPageCreate: 10_000, // single DB write
  thumbnailExtract: 15_000, // ffmpeg single-frame extract
  qrGenerate: 5_000, // pure-CPU PNG generation
  docxModify: 30_000, // docxtemplater + image inject
  docxToPdf: 60_000, // LibreOffice headless conversion
  pdfCompress: 20_000, // Ghostscript pass
  pdfUpload: 30_000, // Bunny storage PUT
} as const;

/**
 * Wraps a stage promise with a hard timeout. On expiry, throws a
 * `[pipeline:${stage}] timed out after ${ms}ms` error so the per-stage
 * attribution lands cleanly in pipeline_events without the caller
 * having to repeat the boilerplate. Always clears the timer in
 * `finally` so a successful resolution doesn't keep the process alive.
 */
async function withStageTimeout<T>(
  fn: () => Promise<T>,
  ms: number,
  stage: string,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      fn(),
      new Promise<T>((_, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new Error(`[pipeline:${stage}] timed out after ${ms}ms`),
            ),
          ms,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Writes `leads.current_stage` so stuck-recovery / observability tooling
 * can see which stage a lead is actively in. Never throws — a logging
 * write failure must not abort the pipeline.
 */
async function setCurrentStage(
  leadId: string,
  stage: string | null,
): Promise<void> {
  try {
    await db
      .update(leads)
      .set({ currentStage: stage })
      .where(eq(leads.id, leadId));
  } catch (err) {
    console.warn(
      `[pipeline] setCurrentStage(${stage}) failed for lead=${leadId}:`,
      err instanceof Error ? err.message : err,
    );
  }
}

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

/**
 * Reconstructs the public page URL for a lead based on its resolved
 * `domainId`. Used on retry / skipped-stage paths where the slug is already
 * persisted. Falls back to the default app URL if the custom domain has
 * been deleted/deactivated in the meantime.
 */
async function rebuildPageUrl(
  domainId: string | null,
  slug: string,
  defaultAppUrl: string,
  customLpVersionId: string | null,
  customLpHost: string,
): Promise<string> {
  if (domainId) {
    const [d] = await db
      .select({ hostname: userDomains.hostname, status: userDomains.status })
      .from(userDomains)
      .where(eq(userDomains.id, domainId))
      .limit(1);
    if (d && d.status === "active") {
      return `https://${d.hostname}/${slug}`;
    }
  }
  if (customLpVersionId) {
    return `https://${customLpHost}/${slug}`;
  }
  return `${defaultAppUrl.replace(/\/+$/, "")}/v/${slug}`;
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
 *
 * Wenn das `placeholderMapping` (neues Format) gesetzt ist, gewinnen seine
 * Werte über die Alias-Heuristik — dadurch greift die User-Wahl aus der
 * Mapping-Stage konsistent in PDF + Video.
 */
function buildDocxVars(
  leadData: Record<string, string>,
  landingpageUrl: string,
  mapping?: Record<string, string> | Record<string, { column?: string; fallback?: string }>,
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
  const base: Record<string, string> = {
    ...leadData,
    landingpageUrl,
    landingpage_url: landingpageUrl,
    firstName,
    lastName,
  };
  // Wenn der User explizit gemappt hat, schreiben wir die aufgelösten Werte
  // unter dem PLATZHALTER-Key in die Vars-Map — der nachgelagerte
  // docxtemplater ersetzt `{{key}}` dann mit dem korrekten Wert.
  if (mapping) {
    for (const key of Object.keys(mapping)) {
      const v = substitutePlaceholder(
        `{{${key}}}`,
        leadData,
        mapping,
        "double-brace",
      );
      if (v) base[key] = v;
    }
  }
  return base;
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
  const { lead, run, campaign, webcam } = ctx;

  const workDir = await createTempDir(`lead-${data.leadId.slice(0, 8)}`);
  const appUrl = process.env.APP_URL ?? "https://app.videocomet.de";

  // Explicit skip flags from selective-regen mode.
  const skipVideoFlag = data.skipVideo === true;
  const skipPdfFlag = data.skipPdf === true;

  // Idempotency checks: if the prior pipeline run already produced an
  // output and persisted it on the lead row, the stage may be skipped on
  // retry. Combined with the explicit flags above.
  const videoAlreadyDone = !!lead.videoUrl;
  const slugAlreadyDone = !!lead.slug;
  const thumbAlreadyDone = !!lead.thumbnailUrl;
  const pdfAlreadyDone = !!lead.pdfUrl;

  const skipVideo = skipVideoFlag || videoAlreadyDone;
  const skipPdf = skipPdfFlag || pdfAlreadyDone;

  // Platzhalter-Mapping aus dem Run extrahieren. Liegt seit 2026-06-02 als
  // `placeholderMapping` (neues Format) in `runs.column_mapping`. Bestehende
  // Runs haben evtl. nur das Legacy-`mapping` (Record<string,string>) — die
  // zentrale `substitute()` versteht beides via `resolveMapping`.
  const storedCm =
    (run.columnMapping as {
      mapping?: Record<string, string>;
      placeholderMapping?: Record<string, { column?: string; fallback?: string }>;
    } | null) ?? {};
  const placeholderMapping = storedCm.placeholderMapping ?? storedCm.mapping;

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
    // Local MP4 path produced by videoRender. null when we skipped render
    // (either via flag or because the upload already happened) — the
    // thumbnail-extract stage handles that by downloading from Bunny.
    let renderedVideoPath: string | null = null;
    let renderedDurationSec: number | null = null;

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

      // ── Webcam-only Fast-Path: shared video pro Run ──────────────
      // Bei webcam-only ist das Video fuer alle Leads identisch. Wir
      // resolven es pro Run einmalig (Stream-URL → GUID reuse, sonst
      // single-upload mit Lock) und kopieren die IDs auf den Lead.
      // Spart N×Re-Upload + N×Bunny-Encode-Wartezeit.
      const isWebcamOnly = campaign.mode !== "with-presentation";
      if (isWebcamOnly) {
        await setCurrentStage(data.leadId, "videoUpload");
        await updateLeadStatus(data.leadId, { status: "uploading" });
        const sharedStart = Date.now();
        const { resolveSharedRunVideo } = await import(
          "../lib/shared-run-video"
        );
        const shared = await resolveSharedRunVideo(
          data.runId,
          webcam.publicUrl,
        );
        bunnyVideoId = shared.bunnyVideoId;
        videoUrl = shared.videoUrl;
        // KRITISCH: alle drei Felder atomar in die DB schreiben — sonst
        // zeigt die Landingpage spaeter auf einen alten bunny_video_id
        // (z.B. aus einem frueheren Run, der ein anderes Webcam-Source
        // verwendet hat). Das Stage-10-Update (status='completed') faesst
        // diese Felder nicht an.
        await updateLeadStatus(data.leadId, {
          bunnyVideoId: shared.bunnyVideoId,
          videoUrl: shared.videoUrl,
          thumbnailUrl: shared.thumbnailUrl || null,
        });
        const sharedMs = Date.now() - sharedStart;
        await insertPipelineEvent({
          runId: data.runId,
          leadId: data.leadId,
          level: "info",
          stage: "upload",
          message: `${leadLabel}: shared video resolved in ${(sharedMs / 1000).toFixed(1)}s (bunnyId=${shared.bunnyVideoId.slice(0, 8)}…)`,
          durationMs: sharedMs,
        });
        // Stages 1+2 erledigt — direkt weiter zu landingPageCreate.
        // `renderedVideoPath` / `renderedDurationSec` bleiben null; die
        // PDF-Stage faellt auf das gespeicherte thumbnailUrl zurueck.
      } else {
      await setCurrentStage(data.leadId, "videoRender");
      const renderStart = Date.now();
      const render = await withStageTimeout(
        () =>
          runVideoRender({
            outDir: workDir,
            mode: (campaign.mode === "with-presentation"
              ? "with-presentation"
              : "webcam-only") as "webcam-only" | "with-presentation",
            webcamSourceUrl: webcam.publicUrl!,
            website: lead.data?.website ?? null,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            segments: (campaign.segments as any) ?? [],
            leadData: (lead.data ?? {}) as Record<string, string>,
            placeholderMapping,
            pip: {
              position: campaign.pipPosition?.includes("right")
                ? "right"
                : "left",
              shape:
                campaign.pipShape === "circle"
                  ? "circle"
                  : campaign.pipShape === "square"
                    ? "square"
                    : "rounded",
            },
            defaultDurationSec: webcam.durationSec ?? 30,
          }),
        STAGE_TIMEOUTS_MS.videoRender,
        "videoRender",
      );
      renderedVideoPath = render.videoFilePath;
      renderedDurationSec = render.durationSec;
      const renderMs = Date.now() - renderStart;
      await insertPipelineEvent({
        runId: data.runId,
        leadId: data.leadId,
        level: "info",
        stage: "render",
        message: `${leadLabel}: rendering done in ${(renderMs / 1000).toFixed(1)}s`,
        durationMs: renderMs,
      });

      await setCurrentStage(data.leadId, "videoUpload");
      await updateLeadStatus(data.leadId, { status: "uploading" });
      const uploadStart = Date.now();
      const upload = await withStageTimeout(
        () =>
          runVideoUpload({
            leadId: data.leadId,
            videoFilePath: render.videoFilePath,
            title: `${campaign.name} – Lead ${lead.rowIndex}`,
          }),
        STAGE_TIMEOUTS_MS.videoUpload,
        "videoUpload",
      );
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
      } // ← Ende `else` (with-presentation Pfad)
    } else {
      // Skip reason for the live log.
      const reason = videoAlreadyDone
        ? "already done (lead.videoUrl set)"
        : "skipVideo flag";
      await insertPipelineEvent({
        runId: data.runId,
        leadId: data.leadId,
        level: "info",
        stage: "run",
        message: `${leadLabel}: skipped videoRender + videoUpload: ${reason}`,
      });
    }

    // ── Stage 5: Landingpage row + slug ─────────────────────────────
    const customLpHost = process.env.SANDBOX_LP_HOST || "lp.videocomet.de";
    const customLpVersionId = run.customLpVersionId ?? null;
    if (!slugAlreadyDone) {
      await setCurrentStage(data.leadId, "landingPageCreate");
      const lpStart = Date.now();
      const lp = await withStageTimeout(
        () =>
          runLandingPageCreate({
            leadId: data.leadId,
            appUrl,
            leadData: (lead.data ?? {}) as Record<string, string>,
            rowIndex: lead.rowIndex,
            slugTemplate: campaign.slugTemplate ?? null,
            placeholderMapping,
            domainId: campaign.domainId ?? null,
            customLpVersionId,
            customLpHost,
          }),
        STAGE_TIMEOUTS_MS.landingPageCreate,
        "landingPageCreate",
      );
      slug = lp.slug;
      pageUrl = lp.pageUrl;
      await insertPipelineEvent({
        runId: data.runId,
        leadId: data.leadId,
        level: "info",
        stage: "landingpage",
        message: `${leadLabel}: landing page created (${pageUrl})`,
        durationMs: Date.now() - lpStart,
      });
    } else {
      // Reuse existing slug; reconstruct the public URL respecting the
      // lead's resolved domain (set during the original landingPageCreate)
      // AND any Custom-LP pin on the run.
      // slugAlreadyDone guarantees `slug` is non-null at this point.
      pageUrl = await rebuildPageUrl(
        lead.domainId ?? null,
        slug!,
        appUrl,
        customLpVersionId,
        customLpHost,
      );
      await insertPipelineEvent({
        runId: data.runId,
        leadId: data.leadId,
        level: "info",
        stage: "run",
        message: `${leadLabel}: skipped landingPageCreate: already done (slug=${slug})`,
      });
    }

    // ── Stage 3: Thumbnail extract ──────────────────────────────────
    // Only needed when the PDF pipeline runs (PDF embeds the thumb).
    // Three branches:
    //   (a) thumb already on lead → download from Bunny to local file
    //   (b) we just rendered the video → extract a frame
    //   (c) neither → no local thumb (skipPdf likely true; ok)
    const pdfThumbWanted =
      !skipPdf && campaign.pdfEnabled && campaign.pdfThumbnailEnabled;

    if (thumbAlreadyDone) {
      if (pdfThumbWanted && lead.thumbnailUrl) {
        await setCurrentStage(data.leadId, "thumbnailExtract");
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
      await insertPipelineEvent({
        runId: data.runId,
        leadId: data.leadId,
        level: "info",
        stage: "run",
        message: `${leadLabel}: skipped thumbnailExtract: already done (lead.thumbnailUrl set)`,
      });
    } else if (renderedVideoPath && renderedDurationSec != null) {
      await setCurrentStage(data.leadId, "thumbnailExtract");
      const thumbStart = Date.now();
      const thumb = await withStageTimeout(
        () =>
          runThumbnailExtract({
            videoFilePath: renderedVideoPath!,
            durationSec: renderedDurationSec!,
            frameMs: campaign.pdfThumbnailFrameMs,
            outDir: workDir,
            enabled: campaign.pdfEnabled && campaign.pdfThumbnailEnabled,
          }),
        STAGE_TIMEOUTS_MS.thumbnailExtract,
        "thumbnailExtract",
      );
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
    }
    // else: no local video AND no stored thumbnail → can't extract; if
    // pdfThumbWanted the docx stage will simply ship without the thumb.

    // ── Stage 4: QR-Code ─────────────────────────────────────────────
    // Always regenerate — it's <5s pure-CPU and `slug` may change on a
    // selective regen (e.g. landingPageCreate just ran fresh).
    if (pageUrl) {
      await setCurrentStage(data.leadId, "qrGenerate");
      const qrStart = Date.now();
      const qr = await withStageTimeout(
        () =>
          runQrGenerate({
            outDir: workDir,
            pageUrl: pageUrl!,
            enabled: campaign.pdfEnabled && campaign.pdfQrEnabled && !skipPdf,
          }),
        STAGE_TIMEOUTS_MS.qrGenerate,
        "qrGenerate",
      );
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

      await setCurrentStage(data.leadId, "docxModify");
      const docxStart = Date.now();
      const docx = await withStageTimeout(
        () =>
          runDocxModify({
            outDir: workDir,
            googleDocsUrl: campaign.pdfGoogleDocsUrl!,
            vars: buildDocxVars(lead.data ?? {}, pageUrl!, placeholderMapping),
            qrPngPath,
            thumbJpgPath: thumbFilePath,
          }),
        STAGE_TIMEOUTS_MS.docxModify,
        "docxModify",
      );
      await insertPipelineEvent({
        runId: data.runId,
        leadId: data.leadId,
        level: "info",
        stage: "docx",
        message: `${leadLabel}: docx generated in ${((Date.now() - docxStart) / 1000).toFixed(1)}s`,
        durationMs: Date.now() - docxStart,
      });

      await setCurrentStage(data.leadId, "docxToPdf");
      const pdf = await withStageTimeout(
        () =>
          runDocxToPdf({
            docxPath: docx.docxPath,
            outDir: workDir,
          }),
        STAGE_TIMEOUTS_MS.docxToPdf,
        "docxToPdf",
      );

      await setCurrentStage(data.leadId, "pdfCompress");
      const compressed = await withStageTimeout(
        () =>
          runPdfCompress({
            pdfPath: pdf.pdfPath,
            outDir: workDir,
          }),
        STAGE_TIMEOUTS_MS.pdfCompress,
        "pdfCompress",
      );

      await setCurrentStage(data.leadId, "pdfUpload");
      await withStageTimeout(
        () =>
          runPdfUpload({
            leadId: data.leadId,
            runId: data.runId,
            pdfPath: compressed.pdfPath,
          }),
        STAGE_TIMEOUTS_MS.pdfUpload,
        "pdfUpload",
      );
      await insertPipelineEvent({
        runId: data.runId,
        leadId: data.leadId,
        level: "info",
        stage: "pdf",
        message: `${leadLabel}: PDF rendered & uploaded in ${((Date.now() - pdfStart) / 1000).toFixed(1)}s`,
        durationMs: Date.now() - pdfStart,
      });
    } else if (
      pdfAlreadyDone &&
      campaign.pdfEnabled &&
      campaign.pdfGoogleDocsUrl
    ) {
      // PDF was already produced on a prior attempt — log the skip
      // (4 stages collapsed into one event for log brevity).
      await insertPipelineEvent({
        runId: data.runId,
        leadId: data.leadId,
        level: "info",
        stage: "run",
        message: `${leadLabel}: skipped docxModify + docxToPdf + pdfCompress + pdfUpload: already done (lead.pdfUrl set)`,
      });
    }

    // ── Stage 10: mark complete ──────────────────────────────────────
    await setCurrentStage(data.leadId, null);
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
    // completed markieren. Idempotent — mehrere Lead-Jobs können den Check
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
    // Clear current_stage so the lead doesn't look "stuck in stage X" after
    // a hard failure. The stage that failed is still discoverable via the
    // last `pipeline_events` row for the lead.
    await setCurrentStage(data.leadId, null);
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
