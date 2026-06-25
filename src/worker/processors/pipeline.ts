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
import { runVideoCompress } from "./video-compress";
import { runVideoUpload } from "./video-upload";
import { runThumbnailExtract } from "./thumbnail-extract";
import { runQrGenerate } from "./qr-generate";
import { runLandingPageCreate } from "./landingpage-create";
import { runDocxModify } from "./docx-modify";
import { substitute as substitutePlaceholder } from "@/lib/placeholders/substitute";
import { buildPageUrlShort } from "@/lib/placeholders/page-url";
import { runDocxToPdf } from "./docx-to-pdf";
import { runPdfCompress } from "./pdf-compress";
import { runPdfUpload } from "./pdf-upload";
import { addBunnyAssetRef } from "@/lib/db/queries/bunny-assets";
import { trackAndRefAsset } from "../lib/bunny-asset-tracking";
import { runThumbnailGenerate } from "./thumbnail-generate";
import { runLandingpageScreenshot } from "./landingpage-screenshot";
import { hasPersonalization } from "../lib/has-personalization";
import {
  getSharedThumbnailUrl,
  setSharedThumbnailUrl,
  withSharedThumbnailLock,
} from "@/lib/db/queries/runs";
import { parseStorageUrl } from "@/lib/bunny/storage";

/**
 * Per-stage hard-timeout values (ms). These bound each pipeline stage
 * independently so a single hanging Puppeteer / LibreOffice / ffmpeg
 * call cannot tie up a worker slot beyond its known-good ceiling.
 * Numbers are based on observed p99 durations + headroom. The sum
 * (~350s) plus orchestration overhead must stay under the global
 * pipeline timeout in `src/worker/index.ts`.
 */
const STAGE_TIMEOUTS_MS = {
  // PPTX-basierte Segmente (gslide/canva) sind teuer: LibreOffice (5-15s)
  // + pdftoppm + ffmpeg-Loop, multiplied with parallel leads under
  // BullMQ concurrency=16. 300s gibt realistischen Puffer auch fuer
  // mehrere Slides pro Lead.
  videoRender: 300_000,
  videoCompress: 90_000, // ffmpeg re-encode + remux (passthrough is fast)
  videoUpload: 60_000, // Bunny stream upload is fast
  landingPageCreate: 10_000, // single DB write
  thumbnailExtract: 15_000, // ffmpeg single-frame extract
  qrGenerate: 5_000, // pure-CPU PNG generation
  thumbnailGenerate: 30_000, // Puppeteer 1280x720 + Bunny storage PUT
  landingpageScreenshot: 45_000, // Puppeteer goto + networkidle + screenshot + upload
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
  pageUrlShort?: string | null,
  pageUrlUserAliases?: ReadonlyArray<string> | null,
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
  // `pageUrl` ist der globale System-Platzhalter (Paket A). Wir schreiben
  // den aufgelösten Kurz-URL-Wert direkt in `base`, damit der nachgelagerte
  // docxtemplater (der nur den Vars-Record kennt, NICHT die zentrale
  // `substitute()`-Engine) `{{pageUrl}}` mit der korrekten Adresse ersetzt.
  if (pageUrlShort) {
    base.pageUrl = pageUrlShort;
  }
  // Wenn der User explizit gemappt hat, schreiben wir die aufgelösten Werte
  // unter dem PLATZHALTER-Key in die Vars-Map — der nachgelagerte
  // docxtemplater ersetzt `{{key}}` dann mit dem korrekten Wert. Der
  // System-Context wird mitgegeben, damit ein gemappter Key, der zufällig
  // `pageUrl` heißt, identisch aufgelöst wird wie der direkte System-Hit.
  if (mapping) {
    const system = pageUrlShort ? { pageUrl: pageUrlShort } : undefined;
    for (const key of Object.keys(mapping)) {
      // SYSTEM-MAPPING: User hat im Wizard „🔗 Landingpage-URL (automatisch)"
      // ausgewählt → Wert kommt direkt aus pageUrlShort, ohne CSV-Lookup.
      const mappedRaw = (mapping as Record<string, unknown>)[key];
      const mappedStr =
        typeof mappedRaw === "string"
          ? mappedRaw
          : typeof mappedRaw === "object" && mappedRaw !== null
            ? (mappedRaw as { column?: string }).column ?? ""
            : "";
      if (mappedStr === "@system:pageUrl") {
        if (pageUrlShort) base[key] = pageUrlShort;
        continue;
      }
      const v = substitutePlaceholder(
        `{{${key}}}`,
        leadData,
        mapping,
        "double-brace",
        system,
      );
      // WICHTIG: auch leere Strings persistieren. substitute() resolved
      // immer einen String (egal ob aus CSV-Wert, Fallback oder leer)
      // und gibt nie undefined zurueck. Wenn wir nur `if (v)` checken,
      // werden:
      //   - Mappings mit Fallback="" (User-Intent: "absichtlich leer")
      //   - Mappings ohne CSV-Wert und ohne Fallback
      // beide aus `base` ausgelassen — was bewirkt, dass replacePlaceholders
      // den Token {{key}} als Rohtext im PDF stehen laesst (statt ihn
      // durch Fallback oder leeren String zu ersetzen). Loesung: jeden
      // String-Wert uebernehmen, inklusive "".
      if (typeof v === "string") base[key] = v;
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
    // Lokale Sicht auf die Thumbnail-Generator-Outputs (Paket D). Wir
    // mirror'n den DB-Zustand hier, damit der nachgelagerte PDF-Stage
    // (Paket E) die jeweils richtige URL übergeben kann, ohne nochmal aus
    // der DB zu lesen. Defaults reusen, was eine vorige Pipeline-Iteration
    // schon persistiert hat (Idempotenz).
    let leadCustomThumbnailUrl: string | null =
      lead.customThumbnailUrl ?? null;
    let runSharedThumbnailUrlForCustom: string | null = null;

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

      // ── Webcam-only Pfad: shared video resolve pro Run ───────────
      // Bei webcam-only ist das Video fuer alle Leads identisch. Wir
      // resolven es pro Run einmalig (Stream-URL → GUID reuse, sonst
      // single-upload via Lock + Compress). Stages videoRender +
      // videoUpload entfallen komplett — KEIN inline-Fast-Path mehr,
      // damit auch dieser Pfad Compression durchläuft (sonst landen
      // unkomprimierte WebMs/MP4s in Bunny Stream).
      const isWebcamOnly = campaign.mode !== "with-presentation";
      if (isWebcamOnly) {
        await setCurrentStage(data.leadId, "videoUpload");
        await updateLeadStatus(data.leadId, { status: "uploading" });
        const sharedStart = Date.now();
        const { runVideoResolveShared } = await import(
          "./video-resolve-shared"
        );
        const shared = await runVideoResolveShared({
          runId: data.runId,
          userId: data.userId,
          webcamMediaUrl: webcam.publicUrl,
        });
        bunnyVideoId = shared.bunnyVideoId;
        videoUrl = shared.hlsUrl;
        // KRITISCH: alle Video-Felder atomar in die DB schreiben — sonst
        // zeigt die Landingpage spaeter auf einen alten bunny_video_id
        // (z.B. aus einem frueheren Run, der ein anderes Webcam-Source
        // verwendet hat). Das Stage-10-Update (status='completed') faesst
        // diese Felder nicht an.
        await updateLeadStatus(data.leadId, {
          bunnyVideoId: shared.bunnyVideoId,
          videoUrl: shared.hlsUrl,
          thumbnailUrl: shared.thumbnailUrl || null,
          videoWidth: shared.width,
          videoHeight: shared.height,
          videoOrientation: shared.orientation,
          videoMp4Url: shared.mp4Url,
        });
        // Bunny-Asset-Ref auf den Lead (1 Asset, N Lead-Refs). Sobald der
        // letzte Lead gelöscht wird, kann der Purge-Worker (Paket E) das
        // Bunny-Stream-Video freigeben.
        if (shared.bunnyAssetId) {
          try {
            await addBunnyAssetRef(
              shared.bunnyAssetId,
              "lead",
              data.leadId,
            );
          } catch (err) {
            // Doppel-ref kollidiert (unique idx) wird intern bereits via
            // ON CONFLICT DO NOTHING geschluckt; alles andere ist ein DB-
            // Glitch — log und weiter, Pipeline darf nicht abbrechen.
            console.warn(
              `[pipeline] addBunnyAssetRef(lead) failed for asset=${shared.bunnyAssetId}: ${(err as Error).message}`,
            );
          }
        }
        const sharedMs = Date.now() - sharedStart;
        await insertPipelineEvent({
          runId: data.runId,
          leadId: data.leadId,
          level: "info",
          stage: "upload",
          message: `${leadLabel}: shared video resolved in ${(sharedMs / 1000).toFixed(1)}s (bunnyId=${shared.bunnyVideoId.slice(0, 8)}…, ${shared.orientation}${shared.mp4Url ? ", mp4=ready" : ", mp4=pending"})`,
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

      // ── Stage 1b: Compress (NEU, Paket D) ────────────────────────
      // Renderer-Output ist intentionally pure (libx264, CRF26, baseline
      // 3.1). compressForBunny prüft ob das schon Bunny-tauglich ist
      // und macht passthrough-remux statt Re-Encode, wo möglich.
      await setCurrentStage(data.leadId, "videoCompress");
      const compressed = await withStageTimeout(
        () =>
          runVideoCompress({
            leadId: data.leadId,
            runId: data.runId,
            inputPath: render.videoFilePath,
            outDir: workDir,
          }),
        STAGE_TIMEOUTS_MS.videoCompress,
        "videoCompress",
      );

      await setCurrentStage(data.leadId, "videoUpload");
      await updateLeadStatus(data.leadId, { status: "uploading" });
      const uploadStart = Date.now();
      const upload = await withStageTimeout(
        () =>
          runVideoUpload({
            leadId: data.leadId,
            userId: data.userId,
            videoFilePath: compressed.videoFilePath,
            title: `${campaign.name} – Lead ${lead.rowIndex}`,
          }),
        STAGE_TIMEOUTS_MS.videoUpload,
        "videoUpload",
      );
      bunnyVideoId = upload.bunnyVideoId;
      videoUrl = upload.videoUrl;
      // KRITISCH: `runVideoUpload` hat in EINEM atomaren UPDATE bereits
      // bunnyVideoId / videoUrl / thumbnailUrl / videoWidth / videoHeight /
      // videoOrientation / videoMp4Url auf den Lead geschrieben — analog zum
      // WO-Pfad oben (line ~419). Hier KEIN weiterer Lead-Update mehr, sonst
      // entsteht eine Race zwischen den zwei UPDATEs und der Custom-LP-
      // Renderer kann zwischendurch eine inkonsistente Snapshot-Kombination
      // sehen (z.B. neue videoUrl + alte videoMp4Url).

      // Bunny-Asset-Tracking für with-presentation (1 Asset pro Lead-
      // Video). Best-effort via Helper — Fehler werden gelogged, brechen
      // aber die Pipeline nicht ab.
      await trackAndRefAsset({
        trackInput: {
          userId: data.userId,
          kind: "stream",
          bunnyId: upload.bunnyVideoId,
          cdnUrl: upload.videoUrl,
          width: upload.width,
          height: upload.height,
        },
        ownerType: "lead",
        ownerId: data.leadId,
      });

      const uploadMs = Date.now() - uploadStart;
      await insertPipelineEvent({
        runId: data.runId,
        leadId: data.leadId,
        level: "info",
        stage: "upload",
        message: `${leadLabel}: video upload done in ${(uploadMs / 1000).toFixed(1)}s${upload.mp4Url ? " (mp4=ready)" : " (mp4=pending)"}`,
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
            campaignId: campaign.id,
            campaignSlugSuffix: campaign.slugSuffix ?? null,
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

    // ── pageUrl-Short für System-Platzhalter (Paket A/E) ───────────────
    // Wird in JEDEN substitute-Aufruf der Pipeline reingereicht, damit
    // `{{pageUrl}}` global (PDF-Brief, Thumbnail-Template, Video-Slides,
    // Custom-LP) zur Lead-Page-Kurzform aufgelöst wird. Custom-LP-Pin auf
    // lp.videocomet.de UND Custom-Domains werden separat behandelt — die
    // Kurzform soll abtippbar sein, nicht der mit `https://`-präfixierte
    // CDN-Link.
    const effectiveDomainId = lead.domainId ?? campaign.domainId ?? null;
    let pageUrlDomainHostname: string | null = null;
    if (effectiveDomainId) {
      const [d] = await db
        .select({ hostname: userDomains.hostname, status: userDomains.status })
        .from(userDomains)
        .where(eq(userDomains.id, effectiveDomainId))
        .limit(1);
      if (d && d.status === "active") {
        pageUrlDomainHostname = d.hostname;
      }
    }
    const pageUrlShort = slug
      ? buildPageUrlShort(pageUrlDomainHostname, slug, appUrl)
      : null;

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

    // ── Stage: Thumbnail-Mode-Branch (Pakete B + D) ────────────────────
    // Drei Modi, gewaehlt im Kampagnen-Wizard (Paket A schema):
    //
    //   - 'frame' (Default / Legacy):
    //       Keine eigene Render-Stage hier. Der PDF-Brief embedded den vom
    //       Video extrahierten Frame-JPG (siehe `thumbFilePath` weiter
    //       oben, Stage 3 `thumbnailExtract`). `customThumbnailUrl` bleibt
    //       unangetastet → docx-modify-Fallback-Chain trifft den Frame.
    //
    //   - 'custom_image' (Paket D):
    //       Eigenes Slide-artiges Thumbnail-Template (Background + Layers)
    //       wird via `runThumbnailGenerate` zu 1280×720 PNG gerendert.
    //       Personalisiertes Template → pro Lead, sonst run-shared mit
    //       Advisory-Lock (Details unten).
    //
    //   - 'landingpage_screenshot' (Paket B):
    //       LIVE-Landingpage in Headless-Chromium laden und 1280×720-PNG-
    //       Screenshot anfertigen. IMMER per-Lead (LP enthaelt Lead-Daten),
    //       kein Cross-Lead-Caching.
    //
    // `thumbnailMode` kommt aus dem Kampagnen-Schema (Paket A). Bestehende
    // Kampagnen ohne Migration → wir leiten den Modus aus den vorhandenen
    // Flags ab (`thumbnailImageEnabled` → 'custom_image', sonst 'frame')
    // damit Paket B unabhaengig deployed werden kann.
    type ThumbnailMode = "frame" | "custom_image" | "landingpage_screenshot";
    const campaignWithMode = campaign as typeof campaign & {
      thumbnailMode?: ThumbnailMode | null;
      thumbnailPlayIcon?: boolean | null;
    };
    const thumbnailMode: ThumbnailMode =
      campaignWithMode.thumbnailMode ??
      (campaign.thumbnailImageEnabled ? "custom_image" : "frame");
    const thumbnailPlayIcon = campaignWithMode.thumbnailPlayIcon === true;
    const pdfThumbWantedForBranch =
      !skipPdf && campaign.pdfEnabled && campaign.pdfThumbnailEnabled;

    // ── Stage: Landingpage-Screenshot (Paket B) ──────────────────────
    // Nur wenn der User explizit 'landingpage_screenshot' gewaehlt hat UND
    // ein PDF-Brief mit Thumbnail erzeugt wird. Idempotenz: customThumbnailUrl
    // schon gesetzt → skip (Retry-Pfad). Pipeline-Timeout 45 s — die LP
    // sollte in <10 s navigieren + <2 s rendern + <5 s uploaden.
    if (
      thumbnailMode === "landingpage_screenshot" &&
      pdfThumbWantedForBranch &&
      pageUrl
    ) {
      if (!leadCustomThumbnailUrl) {
        await setCurrentStage(data.leadId, "landingpageScreenshot");
        const tStart = Date.now();
        // `pageUrl` aus `runLandingPageCreate` ist bereits voll qualifiziert
        // (`https://…/…`). `pageUrlShort` (ohne Protokoll) reichen wir als
        // Display-Variante mit; der LP-Screenshot-Stage hangt `?preview=1`
        // intern an, damit das LP-Tracking sich abschaltet und keine
        // Falsch-Aufrufe zaehlt.
        try {
          const screenshot = await withStageTimeout(
            () =>
              runLandingpageScreenshot({
                leadId: data.leadId,
                userId: data.userId,
                runId: data.runId,
                pageUrl: pageUrlShort ?? pageUrl!,
                fullPageUrl: pageUrl!,
                playIconOverlay: thumbnailPlayIcon,
                outDir: workDir,
              }),
            STAGE_TIMEOUTS_MS.landingpageScreenshot,
            "landingpageScreenshot",
          );
          leadCustomThumbnailUrl = screenshot.thumbnailUrl;
          await updateLeadStatus(data.leadId, {
            customThumbnailUrl: screenshot.thumbnailUrl,
          });
          // Bunny-Asset-Tracking — 1 PNG pro Lead, owner=lead. Identisches
          // Pattern wie der custom_image-Pfad weiter unten.
          const parsedStorage = parseStorageUrl(screenshot.thumbnailUrl);
          if (parsedStorage) {
            await trackAndRefAsset({
              trackInput: {
                userId: data.userId,
                kind: "storage",
                bunnyId: parsedStorage.path,
                cdnUrl: screenshot.thumbnailUrl,
              },
              ownerType: "lead",
              ownerId: data.leadId,
            });
          }
          await insertPipelineEvent({
            runId: data.runId,
            leadId: data.leadId,
            level: "info",
            stage: "thumbnail",
            message: `${leadLabel}: landingpage screenshot rendered in ${((Date.now() - tStart) / 1000).toFixed(1)}s${thumbnailPlayIcon ? " (play-icon overlay)" : ""}`,
            durationMs: Date.now() - tStart,
          });
        } catch (err) {
          // Logging vor dem Rethrow — der globale catch-Block markiert den
          // Lead als 'failed' und schreibt das Event auf Stage 'run'. Hier
          // wollen wir die Stage-Attribution sauber auf 'thumbnail' setzen,
          // damit man im Live-Log sieht, was geknallt hat.
          const msg = err instanceof Error ? err.message : String(err);
          await insertPipelineEvent({
            runId: data.runId,
            leadId: data.leadId,
            level: "error",
            stage: "thumbnail",
            message: `${leadLabel}: landingpage screenshot failed: ${msg.slice(0, 400)}`,
            durationMs: Date.now() - tStart,
          });
          throw err;
        }
      } else {
        await insertPipelineEvent({
          runId: data.runId,
          leadId: data.leadId,
          level: "info",
          stage: "run",
          message: `${leadLabel}: skipped landingpageScreenshot: already done (lead.customThumbnailUrl set)`,
        });
      }
    }

    // ── Stage: Thumbnail-Generate (Paket D) ──────────────────────────
    // Wenn die Kampagne ein eigenes Thumbnail-Template hat, rendern wir
    // hier ein 1280×720-PNG und legen es nach Bunny Edge Storage. Zwei
    // Caching-Modi:
    //
    //   - personalisiert (`{{key}}` irgendwo im Template):
    //       pro Lead rendern → `leads.customThumbnailUrl`
    //   - nicht personalisiert (kein Token):
    //       einmal pro Run rendern → `runs.sharedThumbnailUrl`
    //       Race-Sicherheit via `pg_try_advisory_xact_lock` + Re-Check.
    //
    // Race-Strategie für den Shared-Pfad:
    //   1. Read sharedThumbnailUrl. Hat sie unser Custom-Pfad-Muster
    //      (`thumbnails/<runId>/shared.png`) → fertig, reuse.
    //   2. Sonst try-lock; Lock-Owner rendert + uploaded + schreibt URL,
    //      gibt Lock frei (Transaction-End). Alle anderen Worker pollen
    //      auf sharedThumbnailUrl (max ~30s, sonst trotzdem weitermachen
    //      und das eigene PDF ohne Custom-Thumb shippen — failsafe).
    //
    // Die Bunny-Zone ist die default-Storage-Zone (`videocomet-pdf`,
    // identisch zum PDF-Upload) — kein extra Setup nötig.
    //
    // Play-Icon-Overlay fuer 'custom_image': Paket B (LP-Screenshot) macht
    // den Composite direkt im LP-Stage. Fuer 'custom_image' wird das
    // Composite-Hook in `runThumbnailGenerate` separat in Paket D
    // nachgeschaerft — Out-of-Scope hier (siehe Paket B Spec, Pragmatik).
    if (
      thumbnailMode === "custom_image" &&
      campaign.thumbnailImageEnabled &&
      campaign.thumbnailImage &&
      pageUrl
    ) {
      const thumbCfg = campaign.thumbnailImage;
      const isPersonalized = hasPersonalization(thumbCfg);
      const sharedRemotePath = `thumbnails/${data.runId}/shared.png`;

      if (isPersonalized) {
        // Per-Lead-Render. Idempotenz: wenn die URL schon am Lead hängt,
        // skip (Retry-Pfad). NULL → frisch rendern.
        if (!leadCustomThumbnailUrl) {
          await setCurrentStage(data.leadId, "thumbnailGenerate");
          const tStart = Date.now();
          const out = await withStageTimeout(
            () =>
              runThumbnailGenerate({
                leadId: data.leadId,
                runId: data.runId,
                leadData: (lead.data ?? {}) as Record<string, string>,
                pageUrl,
                thumbnailConfig: thumbCfg,
                mapping: placeholderMapping,
                outDir: workDir,
                remotePath: `thumbnails/${data.runId}/${data.leadId}.png`,
              }),
            STAGE_TIMEOUTS_MS.thumbnailGenerate,
            "thumbnailGenerate",
          );
          leadCustomThumbnailUrl = out.thumbnailUrl;
          await updateLeadStatus(data.leadId, {
            customThumbnailUrl: out.thumbnailUrl,
          });
          // Bunny-Asset-Tracking für späteres Cleanup (Paket B):
          // 1 PNG pro Lead, owner=lead. Bunny-Stream existiert hier nicht
          // (Storage-Zone), kind='storage' mit cdnUrl als bunnyId.
          const parsedStorage = parseStorageUrl(out.thumbnailUrl);
          if (parsedStorage) {
            await trackAndRefAsset({
              trackInput: {
                userId: data.userId,
                kind: "storage",
                bunnyId: parsedStorage.path,
                cdnUrl: out.thumbnailUrl,
              },
              ownerType: "lead",
              ownerId: data.leadId,
            });
          }
          await insertPipelineEvent({
            runId: data.runId,
            leadId: data.leadId,
            level: "info",
            stage: "thumbnail",
            message: `${leadLabel}: custom thumbnail rendered (per-lead) in ${((Date.now() - tStart) / 1000).toFixed(1)}s`,
            durationMs: Date.now() - tStart,
          });
        } else {
          await insertPipelineEvent({
            runId: data.runId,
            leadId: data.leadId,
            level: "info",
            stage: "run",
            message: `${leadLabel}: skipped thumbnailGenerate: already done (lead.customThumbnailUrl set)`,
          });
        }
      } else {
        // Run-Shared-Render. Erst gucken ob das Custom-Thumb schon im
        // Cache liegt (URL-Pattern-Check: das geteilte Webcam-Thumbnail
        // aus webcam-only Mode hat einen `vz-*.b-cdn.net`-Host und matcht
        // unseren Storage-Pfad NICHT).
        const existing = await getSharedThumbnailUrl(data.runId);
        const looksLikeOurCustomThumb =
          !!existing && existing.includes(sharedRemotePath);
        if (looksLikeOurCustomThumb) {
          runSharedThumbnailUrlForCustom = existing;
        } else {
          await setCurrentStage(data.leadId, "thumbnailGenerate");
          const tStart = Date.now();
          // Advisory-Lock: nur EIN Worker rendert pro Run; andere pollen.
          const lockResult = await withSharedThumbnailLock(
            data.runId,
            async () => {
              // Double-check inside the lock — vielleicht hat der andere
              // Worker zwischen unserem ersten Read und unserem Lock fertig
              // gemacht.
              const fresh = await getSharedThumbnailUrl(data.runId);
              if (fresh && fresh.includes(sharedRemotePath)) {
                return { url: fresh, freshlyRendered: false };
              }
              const out = await runThumbnailGenerate({
                leadId: data.leadId,
                runId: data.runId,
                leadData: {}, // shared = keine Lead-Daten nötig
                pageUrl: null,
                thumbnailConfig: thumbCfg,
                mapping: placeholderMapping,
                outDir: workDir,
                remotePath: sharedRemotePath,
              });
              await setSharedThumbnailUrl(data.runId, out.thumbnailUrl);
              // Bunny-Asset-Tracking auf `run` als Owner — beim Run-Delete
              // räumt der Purge-Worker das einzelne PNG sauber weg.
              const parsedStorage = parseStorageUrl(out.thumbnailUrl);
              if (parsedStorage) {
                await trackAndRefAsset({
                  trackInput: {
                    userId: data.userId,
                    kind: "storage",
                    bunnyId: parsedStorage.path,
                    cdnUrl: out.thumbnailUrl,
                  },
                  ownerType: "run",
                  ownerId: data.runId,
                });
              }
              return { url: out.thumbnailUrl, freshlyRendered: true };
            },
          );
          if (lockResult.acquired) {
            runSharedThumbnailUrlForCustom = lockResult.value.url;
            await insertPipelineEvent({
              runId: data.runId,
              leadId: data.leadId,
              level: "info",
              stage: "thumbnail",
              message: lockResult.value.freshlyRendered
                ? `${leadLabel}: custom thumbnail rendered (shared, first writer) in ${((Date.now() - tStart) / 1000).toFixed(1)}s`
                : `${leadLabel}: custom thumbnail reused from run cache (in-lock check)`,
              durationMs: Date.now() - tStart,
            });
          } else {
            // Lock nicht bekommen — anderer Worker rendert gerade. Poll
            // mit Timeout. Failsafe: nach Timeout shippen wir das PDF
            // einfach ohne den Custom-Thumb (sharedThumbnailUrl bleibt
            // null im Vars-Bag → docx-Stage faellt auf den nächst-besseren
            // Wert in der Chain zurück).
            const POLL_MS = 1500;
            const POLL_TIMEOUT_MS = 30_000;
            const pollStart = Date.now();
            while (Date.now() - pollStart < POLL_TIMEOUT_MS) {
              await new Promise((r) => setTimeout(r, POLL_MS));
              const polled = await getSharedThumbnailUrl(data.runId);
              if (polled && polled.includes(sharedRemotePath)) {
                runSharedThumbnailUrlForCustom = polled;
                break;
              }
            }
            await insertPipelineEvent({
              runId: data.runId,
              leadId: data.leadId,
              level: runSharedThumbnailUrlForCustom ? "info" : "warn",
              stage: "thumbnail",
              message: runSharedThumbnailUrlForCustom
                ? `${leadLabel}: custom thumbnail polled from run cache in ${((Date.now() - tStart) / 1000).toFixed(1)}s`
                : `${leadLabel}: custom thumbnail poll timed out — shipping PDF without shared thumb`,
              durationMs: Date.now() - tStart,
            });
          }
        }
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

      // ── Renderer-Auswahl ────────────────────────────────────────────
      // Drive-Renderer ist Erstwahl wenn:
      //   - Env-Flag USE_GOOGLE_DRIVE_RENDERER=1
      //   - Service-Account in GOOGLE_DRIVE_SA_KEY konfiguriert
      // Vorteil: Google rendert mit derselben Engine wie im Browser,
      // Floating-Tabellen + Anchors werden 1:1 dargestellt.
      // Bei Fehler: stiller Fallback auf den LibreOffice-Pfad.
      const driveRendererFlag = process.env.USE_GOOGLE_DRIVE_RENDERER === "1";
      let driveRendererAvailable = false;
      if (driveRendererFlag) {
        const { isDriveRendererConfigured } = await import(
          "@/lib/google-docs/sa-auth"
        );
        driveRendererAvailable = isDriveRendererConfigured();
        if (!driveRendererAvailable) {
          await insertPipelineEvent({
            runId: data.runId,
            leadId: data.leadId,
            level: "warn",
            stage: "docx",
            message: `${leadLabel}: Drive-Renderer-Flag gesetzt aber GOOGLE_DRIVE_SA_KEY fehlt — Fallback LibreOffice`,
          });
        }
      }

      let drivePdfBuffer: Buffer | null = null;
      let driveThumbSource: "drive" | null = null;
      if (driveRendererAvailable) {
        try {
          await setCurrentStage(data.leadId, "docxModify");
          const driveStart = Date.now();
          const { renderViaDrive } = await import(
            "../lib/drive-pdf-pipeline"
          );

          // Bunny-CDN-URL des QR fuer die replaceImage-Request des Drive-Pfads.
          // Wir uebernehmen den lokalen qrPngPath nach Bunny (bestehende
          // Lead-Pipeline schreibt das nicht automatisch hoch — nur das
          // finale PDF). Path-Konvention: `temp/qr/<runId>/<leadId>.png`.
          let qrBunnyUrl: string | null = null;
          if (qrPngPath) {
            try {
              const { uploadFile } = await import("@/lib/bunny/storage");
              const { readFile } = await import("node:fs/promises");
              const buffer = await readFile(qrPngPath);
              const remote = `temp/qr/${data.runId}/${data.leadId}.png`;
              const up = await uploadFile({
                buffer,
                remotePath: remote,
                contentType: "image/png",
              });
              qrBunnyUrl = up.url;
            } catch (err) {
              console.warn(
                `[pipeline] qr->bunny upload failed for lead=${data.leadId}: ${(err as Error)?.message}`,
              );
            }
          }

          // Thumbnail bevorzugt aus der Generator-Chain (bereits in Bunny):
          //   customThumbnailUrl > sharedThumbnailUrl > null
          // Wenn nur ein lokaler Frame-JPG existiert (legacy thumbJpgPath),
          // heben wir den ebenfalls nach Bunny. Sonst kein Image-Replace.
          let thumbBunnyUrl: string | null =
            leadCustomThumbnailUrl ??
            runSharedThumbnailUrlForCustom ??
            run.sharedThumbnailUrl ??
            null;
          if (!thumbBunnyUrl && thumbFilePath) {
            try {
              const { uploadFile } = await import("@/lib/bunny/storage");
              const { readFile } = await import("node:fs/promises");
              const buffer = await readFile(thumbFilePath);
              const remote = `temp/thumb/${data.runId}/${data.leadId}.jpg`;
              const up = await uploadFile({
                buffer,
                remotePath: remote,
                contentType: "image/jpeg",
              });
              thumbBunnyUrl = up.url;
            } catch (err) {
              console.warn(
                `[pipeline] thumb->bunny upload failed for lead=${data.leadId}: ${(err as Error)?.message}`,
              );
            }
          }

          const driveResult = await withStageTimeout(
            () =>
              renderViaDrive({
                googleDocsUrl: campaign.pdfGoogleDocsUrl!,
                textVars: buildDocxVars(
                  lead.data ?? {},
                  pageUrl!,
                  placeholderMapping,
                  pageUrlShort,
                ),
                qrImageUrl: qrBunnyUrl,
                thumbnailImageUrl: thumbBunnyUrl,
              }),
            STAGE_TIMEOUTS_MS.docxModify + STAGE_TIMEOUTS_MS.docxToPdf,
            "driveRender",
          );
          drivePdfBuffer = driveResult.pdfBuffer;
          driveThumbSource = "drive";
          await insertPipelineEvent({
            runId: data.runId,
            leadId: data.leadId,
            level: "info",
            stage: "docx",
            message: `${leadLabel}: drive-rendered in ${((Date.now() - driveStart) / 1000).toFixed(1)}s (qr=${driveResult.qrReplaced}, thumb=${driveResult.thumbReplaced}, vars=${driveResult.textReplacements})`,
            durationMs: Date.now() - driveStart,
          });
        } catch (err) {
          await insertPipelineEvent({
            runId: data.runId,
            leadId: data.leadId,
            level: "warn",
            stage: "docx",
            message: `${leadLabel}: drive-render failed (${(err as Error)?.message}); falling back to LibreOffice`,
          });
          drivePdfBuffer = null;
        }
      }

      let pdfPathForCompress: string;
      let docxThumbSource: string;

      if (drivePdfBuffer) {
        // Drive-Pipeline lieferte PDF direkt — auf Disk schreiben, damit
        // die nachfolgenden Stages (compress/upload) unveraendert greifen.
        const { writeFile } = await import("node:fs/promises");
        const { join } = await import("node:path");
        pdfPathForCompress = join(workDir, "letter.pdf");
        await writeFile(pdfPathForCompress, drivePdfBuffer);
        docxThumbSource = driveThumbSource ?? "drive";
      } else {
        await setCurrentStage(data.leadId, "docxModify");
        const docxStart = Date.now();
        const docx = await withStageTimeout(
          () =>
            runDocxModify({
              outDir: workDir,
              googleDocsUrl: campaign.pdfGoogleDocsUrl!,
              vars: buildDocxVars(
                lead.data ?? {},
                pageUrl!,
                placeholderMapping,
                pageUrlShort,
              ),
              qrPngPath,
              thumbJpgPath: thumbFilePath,
              customThumbnailUrl: leadCustomThumbnailUrl,
              sharedThumbnailUrl:
                runSharedThumbnailUrlForCustom ?? run.sharedThumbnailUrl ?? null,
            }),
          STAGE_TIMEOUTS_MS.docxModify,
          "docxModify",
        );
        await insertPipelineEvent({
          runId: data.runId,
          leadId: data.leadId,
          level: "info",
          stage: "docx",
          message: `${leadLabel}: docx generated in ${((Date.now() - docxStart) / 1000).toFixed(1)}s (thumb=${docx.thumbSource})`,
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
        pdfPathForCompress = pdf.pdfPath;
        docxThumbSource = docx.thumbSource;
      }

      // Variable nicht-mehr-genutzt im neuen Branch, aber alte Compress-
      // Stage erwartet `pdf.pdfPath`. Wir mappen oben pdfPathForCompress.
      const pdf = { pdfPath: pdfPathForCompress };
      // Suppress unused-var warnings — `docxThumbSource` wird via
      // pipeline events bereits geloggt.
      void docxThumbSource;

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
