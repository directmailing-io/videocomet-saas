/**
 * Worker entry point.
 *
 * Boots dotenv, starts the DB-heartbeat loop, and wires the BullMQ worker
 * to the pipeline orchestrator. Concurrency is read from `WORKER_CONCURRENCY`
 * (default 4).
 *
 * Graceful shutdown on SIGTERM/SIGINT:
 *   1. stop accepting new jobs
 *   2. wait for in-flight jobs to finish
 *   3. close browser pool
 *   4. stop heartbeat
 *   5. exit
 */

import "dotenv/config";
import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { and, eq, lt, inArray, sql } from "drizzle-orm";
import { pipelineWorker, pipelineQueue, getRedisConnection } from "./queue";
import { screenshotWorker, type ScreenshotJobData } from "./screenshot-queue";
import {
  brandExtractWorker,
  type BrandExtractJobData,
} from "./brand-extract-queue";
import { brandExtractProcessor } from "./processors/brand-extract";
import { crmSyncWorker, type CrmSyncJob } from "./crm-queue";
import { emailGifWorker, type EmailGifJobData } from "./email-gif-queue";
import { processEmailGifJob } from "./jobs/email-gif";
import { urlPreviewWorker } from "./url-preview-queue";
import { processUrlPreviewJob } from "./processors/url-preview";
import {
  voiceTrainingWorker,
  introCalibrationWorker,
  introPreviewWorker,
  introGenerationWorker,
  introGenerationQueue,
  enqueueIntroPreviewJob,
  enqueueIntroGenerationJobs,
  type VoiceTrainingJobData,
  type IntroCalibrationJobData,
  type IntroPreviewJobData,
  type IntroGenerationJobData,
} from "./intro-queue";
import { processVoiceTrainingJob } from "./processors/voice-training";
import { processIntroCalibrationJob } from "./processors/intro-calibration";
import { processIntroPreviewJob } from "./processors/intro-preview";
import {
  introGenerationProcessor,
  checkEmergencyBrake,
} from "./processors/intro-generation";
import { refreshStalePreviews } from "@/lib/media-urls/stale-refresh";
import {
  WEBHOOK_DELIVERY_QUEUE,
  type WebhookDeliveryJob,
} from "./webhook-queue";
import { DelayedError, Worker, type ConnectionOptions } from "bullmq";
import { pipelineProcessor } from "./processors/pipeline";
import { screenshotProcessor } from "./processors/screenshot";
import { processCrmSyncJob } from "./processors/crm-sync";
import { processWebhookDelivery } from "./processors/webhook-delivery";
import { closeBrowserPool } from "./lib/browser-pool";
import { computeAndCacheRunEtas } from "./lib/run-eta";
import { startDomainVerifier } from "./jobs/domain-verifier";
import { startDomainMonitor } from "./jobs/domain-monitor";
import { startBunnyPurger } from "./processors/bunny-purge";
import { startBunnyLibraryReconciler } from "./processors/bunny-library-reconcile";
import { recoverStaleEmailClaims, startEmailDrip } from "./jobs/email-drip";
import { startMailboxSync } from "./jobs/mailbox-sync";
import { startAccountCleanup } from "./jobs/account-cleanup";
import { startAnalyticsRetention } from "./jobs/analytics-retention";
import {
  startHeartbeat,
  stopHeartbeat,
  incrementInFlight,
  decrementInFlight,
} from "./lib/heartbeat";
import { db } from "@/lib/db";
import { leads, runs, workerHeartbeats } from "@/lib/db/schema";
import { sendOpsAlert } from "@/lib/ops-alert";
import {
  enqueueApprovedLeadsForPhase2,
  requeuePreflightLeads,
} from "@/lib/preflight/job-enqueue";
import { PREFLIGHT_TERMINAL_STATUSES } from "@/lib/preflight/types";
import { insertPipelineEvent } from "@/lib/db/queries/pipeline-events";
import { leadJobPriority } from "@/lib/queue-priority";
import { sendRunFailureNotification } from "@/lib/run-notifications";
import type { LeadJobData } from "./types";
import type { Job } from "bullmq";

/**
 * Findet Leads die seit >21 min in 'rendering'/'uploading' hängen
 * (Worker-Crash, Container-Restart mid-pipeline) und re-enqueued sie.
 * Wird beim Boot + alle 2 min ausgeführt.
 *
 * 21 min = knapp über PIPELINE_HARD_TIMEOUT_MS (20 min): eine legitime
 * Pipeline darf NICHT als stuck gelten, sonst requeuen wir gesunde
 * in-flight Leads und erzeugen Doppel-Pipelines.
 */
async function stuckLeadRecovery(): Promise<void> {
  const stuckThreshold = new Date(Date.now() - 21 * 60 * 1000);

  // ── ZUERST: Orphaned-Pending-Recovery ──────────────────────────────
  // Leads die in "pending" sind aber KEIN Job in der BullMQ-Queue —
  // passiert wenn der Worker mitten in der Pipeline starb (BullMQ
  // stalled-detection nimmt sie aus active, mein Hard-Timeout setzt
  // sie auf failed mit BullMQ aber DB-status bleibt pending wenn die
  // Stage 1 nie zuende lief). Wir re-enqueuen ALLE pending leads in
  // aktiven runs — jobId-Dedup verhindert Duplikate falls schon einer
  // wartet.
  const orphanedPending = await db
    .select({
      id: leads.id,
      runId: leads.runId,
      userId: runs.userId,
      campaignId: runs.campaignId,
      rowIndex: leads.rowIndex,
    })
    .from(leads)
    .innerJoin(runs, eq(runs.id, leads.runId))
    .where(
      and(
        eq(leads.status, "pending"),
        eq(runs.status, "generating"),
        // KRITISCH: vom User aussortierte Leads NIE wieder einqueuen.
        // Ohne diesen Filter holt die Recovery alle 2 min auch die im
        // Preflight rejecteten Leads zurück in die Pipeline.
        sql`${leads.removedAt} IS NULL`,
        // Intro-Staging: Leads die gerade in der intro-generation-Queue
        // hängen sind NICHT orphaned — sie bekommen ihren Render-Job erst
        // nach dem Staging. Für diese greift introStagingRecovery().
        sql`(${leads.introStatus} IS NULL OR ${leads.introStatus} NOT IN ('queued', 'generating'))`,
      ),
    )
    .limit(2000);

  if (orphanedPending.length > 0) {
    try {
      const queue = pipelineQueue();
      // BullMQ-`addBulk` dedupt stillschweigend, wenn ein Job mit dem
      // gleichen `jobId` schon in Redis liegt — auch wenn er im
      // failed/completed-ZSET ist. Dadurch laufen pending leads in einen
      // Recovery-Deadlock. Lösung: alle stale Job-IDs explizit entfernen
      // bevor wir re-adden.
      await Promise.all(
        orphanedPending.map((s) =>
          queue.remove(s.id).catch(() => undefined),
        ),
      );
      await queue.addBulk(
        orphanedPending.map((s) => ({
          name: "lead-pipeline",
          data: {
            leadId: s.id,
            runId: s.runId,
            userId: s.userId,
            campaignId: s.campaignId,
          },
          opts: { jobId: s.id, priority: leadJobPriority(s.rowIndex) },
        })),
      );
      // eslint-disable-next-line no-console
      console.log(
        `[worker:${WORKER_ID}] orphaned-pending-recovery: re-enqueued ${orphanedPending.length} pending leads (stale-jobs purged first)`,
      );
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(`[worker:${WORKER_ID}] orphaned recovery failed:`, err);
    }
  }

  // ── DANN: Stuck-Rendering-Recovery ─────────────────────────────────
  // Hole alle stuck leads UND ihre Run-Daten in einem Query.
  // WICHTIG: attempts < 3 — sonst landet ein dauerhaft kaputter Lead
  // (broken DNS, unzugängliche URL, ...) in einer Endlos-Recovery-Schleife.
  const stuck = await db
    .select({
      id: leads.id,
      runId: leads.runId,
      userId: runs.userId,
      campaignId: runs.campaignId,
      attempts: leads.attempts,
      rowIndex: leads.rowIndex,
    })
    .from(leads)
    .innerJoin(runs, eq(runs.id, leads.runId))
    .where(
      and(
        inArray(leads.status, ["rendering", "uploading"]),
        lt(leads.startedAt, stuckThreshold),
        eq(runs.status, "generating"),
        sql`${leads.removedAt} IS NULL`,
        lt(leads.attempts, 3),
      ),
    );

  // Leads mit >=3 attempts: hart als failed markieren statt requeue.
  const exhausted = await db
    .select({ id: leads.id })
    .from(leads)
    .innerJoin(runs, eq(runs.id, leads.runId))
    .where(
      and(
        inArray(leads.status, ["rendering", "uploading"]),
        lt(leads.startedAt, stuckThreshold),
        eq(runs.status, "generating"),
        sql`${leads.removedAt} IS NULL`,
        sql`${leads.attempts} >= 3`,
      ),
    );
  if (exhausted.length > 0) {
    const exIds = exhausted.map((e) => e.id);
    await db
      .update(leads)
      .set({
        status: "failed",
        completedAt: new Date(),
        errorMessage: sql`COALESCE(${leads.errorMessage}, 'exceeded max retries (3) — likely a bad URL or unrecoverable error')`,
      })
      .where(inArray(leads.id, exIds));
    // eslint-disable-next-line no-console
    console.log(
      `[worker:${WORKER_ID}] stuck-recovery: marked ${exhausted.length} exhausted leads as failed`,
    );
  }

  if (stuck.length === 0) return;

  // eslint-disable-next-line no-console
  console.log(
    `[worker:${WORKER_ID}] stuck-recovery: found ${stuck.length} leads stuck >21min, requeueing`,
  );

  // Status zurück auf pending, startedAt = null.
  const ids = stuck.map((s) => s.id);
  await db
    .update(leads)
    .set({
      status: "pending",
      startedAt: null,
      errorMessage: sql`COALESCE(${leads.errorMessage}, 'recovered from stuck rendering')`,
    })
    .where(inArray(leads.id, ids));

  // Re-enqueue alle stuck leads in BullMQ. Stale Job-IDs erst raus, dann
  // bulk-add — siehe Kommentar oben im orphaned-pending-Block.
  try {
    const queue = pipelineQueue();
    await Promise.all(
      stuck.map((s) => queue.remove(s.id).catch(() => undefined)),
    );
    await queue.addBulk(
      stuck.map((s) => ({
        name: "lead-pipeline",
        data: {
          leadId: s.id,
          runId: s.runId,
          userId: s.userId,
          campaignId: s.campaignId,
        },
        opts: { jobId: s.id, priority: leadJobPriority(s.rowIndex) },
      })),
    );
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`[worker:${WORKER_ID}] stuck-recovery enqueue failed:`, err);
  }
}

/**
 * Intro-Staging-Recovery (Watchdog für die `intro-generation`-Queue).
 *
 *  (A) `introStatus='generating'` älter als 20 min (startedAt-Anker):
 *      Worker-Crash/verlorener Job mitten im Staging.
 *        - introAttempts < 3 → Staging-Job re-enqueuen (Purge-before-Add).
 *        - introAttempts >= 3 → expliziter `fallback_error` + pipeline_event
 *          + Render-Job direkt enqueuen (Original-Video wird ausgespielt).
 *  (B) `introStatus='queued'` älter als 5 min: Enqueue ging verloren
 *      (Redis-Blip beim Approve) → Staging-Job re-enqueuen.
 *
 * Nur Leads in Runs mit status='generating' — pausierte Runs werden vom
 * Resume-Endpoint neu angestoßen.
 */
async function introStagingRecovery(): Promise<void> {
  const generatingThreshold = new Date(Date.now() - 20 * 60 * 1000);
  const queuedThreshold = new Date(Date.now() - 5 * 60 * 1000);

  // (A) Hängende 'generating'-Leads.
  const stuckGenerating = await db
    .select({
      id: leads.id,
      runId: leads.runId,
      userId: runs.userId,
      campaignId: runs.campaignId,
      introAttempts: leads.introAttempts,
      rowIndex: leads.rowIndex,
    })
    .from(leads)
    .innerJoin(runs, eq(runs.id, leads.runId))
    .where(
      and(
        eq(leads.status, "pending"),
        sql`${leads.introStatus} = 'generating'`,
        lt(leads.startedAt, generatingThreshold),
        eq(runs.status, "generating"),
        sql`${leads.removedAt} IS NULL`,
      ),
    )
    .limit(500);

  const retryable = stuckGenerating.filter((l) => (l.introAttempts ?? 0) < 3);
  const exhausted = stuckGenerating.filter((l) => (l.introAttempts ?? 0) >= 3);

  if (retryable.length > 0) {
    try {
      // startedAt neu ankern, damit der Watchdog nicht alle 2 min erneut
      // feuert, solange der re-enqueued Job noch in der Queue wartet.
      await db
        .update(leads)
        .set({ startedAt: new Date() })
        .where(inArray(leads.id, retryable.map((l) => l.id)));
      await enqueueIntroGenerationJobs(
        retryable.map((l) => ({ leadId: l.id, runId: l.runId })),
      );
      log(
        "info",
        `intro-recovery: re-enqueued ${retryable.length} stuck generating intro leads`,
      );
    } catch (err) {
      log("error", "intro-recovery re-enqueue (generating) failed:", err);
    }
  }

  if (exhausted.length > 0) {
    const exIds = exhausted.map((l) => l.id);
    await db
      .update(leads)
      .set({ introStatus: "fallback_error", introResult: null })
      .where(inArray(leads.id, exIds));
    for (const l of exhausted) {
      await insertPipelineEvent({
        runId: l.runId,
        leadId: l.id,
        level: "warn",
        stage: "render",
        message:
          "Intro-Fallback — Staging nach 3 Versuchen aufgegeben (Watchdog); Original-Video wird verwendet",
      }).catch(() => undefined);
    }
    // Notbremse auch hier prüfen — sonst würde der Watchdog-Pfad die
    // fallback_error-Quote am Brake vorbei hochtreiben und trotzdem
    // rendern. Pausierte Runs bekommen KEINEN Render-Enqueue mehr; der
    // Resume-Endpoint reiht die Leads später neu ein.
    const pausedRuns = new Set<string>();
    for (const runId of Array.from(new Set(exhausted.map((l) => l.runId)))) {
      try {
        if (await checkEmergencyBrake(runId)) pausedRuns.add(runId);
      } catch (err) {
        log("error", `intro-recovery brake check failed for run=${runId}:`, err);
      }
    }
    const toRender = exhausted.filter((l) => !pausedRuns.has(l.runId));
    // Render direkt anstoßen — Original-Video, explizit ausgewiesen.
    if (toRender.length > 0) {
      try {
        const queue = pipelineQueue();
        await Promise.all(
          toRender.map((l) => queue.remove(l.id).catch(() => undefined)),
        );
        await queue.addBulk(
          toRender.map((l) => ({
            name: "lead-pipeline",
            data: {
              leadId: l.id,
              runId: l.runId,
              userId: l.userId,
              campaignId: l.campaignId,
            },
            opts: { jobId: l.id, priority: leadJobPriority(l.rowIndex) },
          })),
        );
        log(
          "warn",
          `intro-recovery: ${toRender.length} intro leads exhausted (>=3 attempts) → fallback_error + render enqueued` +
            (pausedRuns.size > 0
              ? ` (${pausedRuns.size} run(s) paused by emergency brake)`
              : ""),
        );
      } catch (err) {
        log("error", "intro-recovery render enqueue failed:", err);
      }
    }
  }

  // (B) Verlorene 'queued'-Leads.
  const staleQueued = await db
    .select({ id: leads.id, runId: leads.runId })
    .from(leads)
    .innerJoin(runs, eq(runs.id, leads.runId))
    .where(
      and(
        eq(leads.status, "pending"),
        sql`${leads.introStatus} = 'queued'`,
        lt(leads.startedAt, queuedThreshold),
        eq(runs.status, "generating"),
        sql`${leads.removedAt} IS NULL`,
      ),
    )
    .limit(500);
  if (staleQueued.length > 0) {
    try {
      // startedAt für ALLE re-ankern (verhindert erneutes Feuern alle 2 min),
      // aber nur wirklich VERLORENE Jobs neu enqueuen: existiert der Staging-
      // Job noch in der Queue (waiting/delayed/active), würde ein blindes
      // Re-Enqueue mit Purge-before-Add einen wartenden Job zerstören.
      await db
        .update(leads)
        .set({ startedAt: new Date() })
        .where(inArray(leads.id, staleQueued.map((l) => l.id)));
      const queue = introGenerationQueue();
      const lost: Array<{ leadId: string; runId: string }> = [];
      for (const l of staleQueued) {
        const existing = await queue.getJob(`intro-gen-${l.id}`).catch(() => null);
        if (existing) {
          const state = await existing.getState().catch(() => "unknown");
          if (state !== "completed" && state !== "failed") continue;
        }
        lost.push({ leadId: l.id, runId: l.runId });
      }
      if (lost.length > 0) {
        await enqueueIntroGenerationJobs(lost);
        log(
          "info",
          `intro-recovery: re-enqueued ${lost.length}/${staleQueued.length} stale queued intro leads`,
        );
      }
    } catch (err) {
      log("error", "intro-recovery re-enqueue (queued) failed:", err);
    }
  }
}

/**
 * Preflight-Recovery: gleiche Idee wie stuckLeadRecovery() für Phase 1.
 *
 *  (A) Orphaned-pending-Recovery
 *      Leads mit `preflight_status='pending'` in Runs mit `status='preflighting'`.
 *      Diese können durch Worker-Crash zwischen DB-Insert und Queue-Enqueue
 *      entstehen, oder durch eine kurze Redis-Unavailability beim
 *      `/api/runs/[id]/start`-Call.
 *
 *  (B) Stuck-running-Recovery
 *      Leads mit `preflight_status='running'` deren preflight_started_at
 *      des parent Runs >5 min in der Vergangenheit liegt UND attempts < 3.
 *      Zurück auf 'pending', re-enqueue.
 *
 *  (C) Exhausted
 *      attempts >= 3 → terminal `unknown_error`, kein Re-enqueue.
 *
 *  (D) Run-Finalization
 *      Für jeden Run in `preflighting`: wenn ALLE Leads (nicht-removed) in
 *      einem terminalen preflight-Status sind → `runs.status='awaiting_approval'`
 *      + `preflight_completed_at=NOW()`.
 *
 * Race-Hinweis: dieses Recovery läuft alle 2 min und ist idempotent.
 * Mehrere Worker-Instanzen führen denselben Pass aus; durch jobId-Dedup
 * + WHERE-Filter auf alten Stati gibt es keine Korruption.
 */
async function preflightRecovery(): Promise<void> {
  const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);

  // ── (A) Orphaned-pending in `preflighting`-Runs ───────────────────────
  const orphanedPending = await db
    .select({
      id: leads.id,
      runId: leads.runId,
      userId: runs.userId,
      campaignId: runs.campaignId,
    })
    .from(leads)
    .innerJoin(runs, eq(runs.id, leads.runId))
    .where(
      and(
        eq(leads.preflightStatus, "pending"),
        eq(runs.status, "preflighting"),
        sql`${leads.removedAt} IS NULL`,
      ),
    )
    .limit(2000);

  if (orphanedPending.length > 0) {
    try {
      await requeuePreflightLeads(
        orphanedPending.map((o) => ({
          leadId: o.id,
          runId: o.runId,
          userId: o.userId,
          campaignId: o.campaignId,
        })),
      );
      // eslint-disable-next-line no-console
      console.log(
        `[worker:${WORKER_ID}] preflight-orphan-recovery: re-enqueued ${orphanedPending.length} pending leads`,
      );
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(
        `[worker:${WORKER_ID}] preflight-orphan-recovery enqueue failed:`,
        err,
      );
    }
  }

  // ── (B) Stuck-running > 5 min, attempts < 3 ───────────────────────────
  // Wir nutzen `runs.preflight_started_at` als "5min-Stuck-Boundary": ein
  // Run der vor mehr als 5 min angefangen hat UND in dessen Leads noch
  // running-Stati sind, hat einen Stale-Job.
  const stuckRunning = await db
    .select({
      id: leads.id,
      runId: leads.runId,
      userId: runs.userId,
      campaignId: runs.campaignId,
      attempts: leads.preflightAttempts,
    })
    .from(leads)
    .innerJoin(runs, eq(runs.id, leads.runId))
    .where(
      and(
        eq(leads.preflightStatus, "running"),
        eq(runs.status, "preflighting"),
        sql`${leads.removedAt} IS NULL`,
        sql`${runs.preflightStartedAt} < ${fiveMinutesAgo.toISOString()}`,
        sql`${leads.preflightAttempts} < 3`,
      ),
    );

  // ── (C) Exhausted: attempts >= 3 → terminal unknown_error ──────────────
  const exhausted = await db
    .select({ id: leads.id })
    .from(leads)
    .innerJoin(runs, eq(runs.id, leads.runId))
    .where(
      and(
        eq(leads.preflightStatus, "running"),
        eq(runs.status, "preflighting"),
        sql`${leads.removedAt} IS NULL`,
        sql`${leads.preflightAttempts} >= 3`,
      ),
    );
  if (exhausted.length > 0) {
    const exIds = exhausted.map((e) => e.id);
    await db
      .update(leads)
      .set({
        preflightStatus: "unknown_error",
        preflightCompletedAt: new Date(),
        preflightErrorMessage: sql`COALESCE(${leads.preflightErrorMessage}, 'preflight exceeded max retries (3) — likely a bad URL or unrecoverable error')`,
      })
      .where(inArray(leads.id, exIds));
    // eslint-disable-next-line no-console
    console.log(
      `[worker:${WORKER_ID}] preflight-recovery: marked ${exhausted.length} exhausted leads as unknown_error`,
    );
  }

  if (stuckRunning.length > 0) {
    // eslint-disable-next-line no-console
    console.log(
      `[worker:${WORKER_ID}] preflight-stuck-recovery: found ${stuckRunning.length} leads running >5min, requeueing`,
    );
    const ids = stuckRunning.map((s) => s.id);
    // Zurück auf pending — Worker setzt beim Re-Pickup wieder running.
    await db
      .update(leads)
      .set({
        preflightStatus: "pending",
        preflightErrorMessage: sql`COALESCE(${leads.preflightErrorMessage}, 'preflight recovered from stuck running state')`,
      })
      .where(inArray(leads.id, ids));

    try {
      await requeuePreflightLeads(
        stuckRunning.map((s) => ({
          leadId: s.id,
          runId: s.runId,
          userId: s.userId,
          campaignId: s.campaignId,
        })),
      );
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(
        `[worker:${WORKER_ID}] preflight-stuck-recovery enqueue failed:`,
        err,
      );
    }
  }

  // ── (D) Run-Finalization: alle Leads terminal → awaiting_approval ─────
  // Idempotent via WHERE-Filter auf status='preflighting'.
  try {
    const finalized = await db.execute(sql`
      UPDATE ${runs}
      SET status = 'awaiting_approval',
          preflight_completed_at = COALESCE(${runs.preflightCompletedAt}, NOW())
      WHERE ${runs.id} IN (
        SELECT r.id
        FROM ${runs} r
        WHERE r.status = 'preflighting'
          AND NOT EXISTS (
            SELECT 1
            FROM ${leads} l
            WHERE l.run_id = r.id
              AND l.removed_at IS NULL
              AND l.preflight_status NOT IN (${sql.join(
                PREFLIGHT_TERMINAL_STATUSES.map((s) => sql`${s}`),
                sql`, `,
              )})
          )
          AND EXISTS (
            SELECT 1 FROM ${leads} l2
            WHERE l2.run_id = r.id AND l2.removed_at IS NULL
          )
      )
      RETURNING ${runs.id} AS id
    `);
    // Intro-Previews für recovery-promotete Runs anstoßen (best effort,
    // dedupe via jobId; Processor prüft selbst ob Intro aktiv/bereit ist).
    // postgres-js liefert die Rows direkt als Array; defensiv auch .rows
    // unterstützen (gleicher Zugriffs-Pattern wie queries/runs.ts).
    const promotedRows = Array.isArray(finalized)
      ? (finalized as unknown as Array<{ id: string }>)
      : ((finalized as unknown as { rows?: Array<{ id: string }> }).rows ?? []);
    for (const row of promotedRows) {
      if (!row?.id) continue;
      try {
        await enqueueIntroPreviewJob(row.id);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn(
          `[worker:${WORKER_ID}] intro-preview enqueue failed for run ${row.id}:`,
          err,
        );
      }
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(
      `[worker:${WORKER_ID}] preflight-run-finalization failed:`,
      err,
    );
  }

  // ── (E) Approved-Run-Watcher: triggert Phase-2-Enqueue ────────────────
  // Agent 1's `/preflight/approve`-Endpoint setzt nur runs.status='approved'
  // und liefert die Response zurück. Den eigentlichen Übergang nach
  // 'generating' + das Bulk-Enqueue in `lead-pipeline` machen wir hier —
  // genau so wie es Agent 1 im Kommentar seines Routes dokumentiert hat.
  //
  // Idempotenz: `enqueueApprovedLeadsForPhase2` macht das Status-Update
  // mit `WHERE status='approved'`. Mehrfache Recovery-Pässe sind sicher;
  // nur der erste Pass schreibt + enqueued.
  try {
    const approvedRuns = await db
      .select({ id: runs.id, userId: runs.userId })
      .from(runs)
      .where(eq(runs.status, "approved"))
      .limit(100);
    const seenIds = new Set(approvedRuns.map((r) => r.id));
    for (const id of Array.from(approvedStuckFirstSeen.keys())) {
      if (!seenIds.has(id)) approvedStuckFirstSeen.delete(id);
    }
    for (const r of approvedRuns) {
      try {
        const result = await enqueueApprovedLeadsForPhase2(r.id, r.userId);
        if (result.transitioned) {
          approvedStuckFirstSeen.delete(r.id);
          // eslint-disable-next-line no-console
          console.log(
            `[worker:${WORKER_ID}] approved-run-watcher: enqueued ${result.queued} leads for run=${r.id}`,
          );
          continue;
        }
        // transitioned=false + 0 queued: Run ist approved, hat aber keinen
        // einzigen Lead mit approved_at (alle removed/abgelehnt). Der Run
        // würde still für immer hängen — sichtbar machen + nach 10 min als
        // failed terminieren, damit der User nicht ewig auf einen Worker
        // wartet (DigiSpace-Incident 2026-08-06).
        // eslint-disable-next-line no-console
        console.warn(
          `[worker:${WORKER_ID}] approved-run-watcher: run=${r.id} is approved but has 0 approved leads — nothing to enqueue`,
        );
        const firstSeen = approvedStuckFirstSeen.get(r.id);
        if (firstSeen === undefined) {
          approvedStuckFirstSeen.set(r.id, Date.now());
        } else if (Date.now() - firstSeen > APPROVED_STUCK_TIMEOUT_MS) {
          const failed = await db
            .update(runs)
            .set({ status: "failed", completedAt: new Date() })
            .where(and(eq(runs.id, r.id), eq(runs.status, "approved")))
            .returning({ id: runs.id });
          if (failed.length > 0) {
            approvedStuckFirstSeen.delete(r.id);
            await insertPipelineEvent({
              runId: r.id,
              level: "error",
              stage: "watchdog",
              message:
                "Runde gestoppt: Es gibt keinen einzigen freigegebenen Lead zum Produzieren — alle Leads wurden entfernt oder abgelehnt (z.B. Duplikate innerhalb der Liste oder fehlende Vornamen). Bitte prüfe deine Liste und starte eine neue Runde.",
            });
            // eslint-disable-next-line no-console
            console.error(
              `[worker:${WORKER_ID}] approved-run-watchdog: marked run=${r.id} as failed (approved >10min without any approved leads)`,
            );
            void sendRunFailureNotification(
              r.id,
              "Es gab keinen einzigen freigegebenen Lead zum Produzieren. Alle Leads wurden entfernt oder abgelehnt, zum Beispiel Duplikate innerhalb der Liste oder fehlende Vornamen. Bitte prüfe deine Liste und starte eine neue Runde.",
            );
          }
        }
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error(
          `[worker:${WORKER_ID}] approved-run-watcher failed for run=${r.id}:`,
          err,
        );
      }
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(
      `[worker:${WORKER_ID}] approved-run-watcher query failed:`,
      err,
    );
  }
}

/**
 * First-seen-Tracking für approved-Runs ohne approvte Leads. In-memory
 * reicht: ein Worker-Restart setzt die 10-min-Uhr zurück, was den Watchdog
 * nur verzögert, nie falsch auslöst.
 */
const approvedStuckFirstSeen = new Map<string, number>();
const APPROVED_STUCK_TIMEOUT_MS = 10 * 60 * 1000;

/**
 * Heartbeat-Watchdog (Reliability 2026-08-20): Worker schreiben alle 30 s
 * einen Heartbeat. Bleibt ein Heartbeat > 3 min aus, gilt der Worker als
 * tot → Ops-Alert an den Admin. Fenster nach oben: 24 h, damit längst
 * ausgemusterte Worker-IDs nicht ewig alarmieren. Läuft nur auf dem
 * Haupt-Worker (Singleton) — stirbt der Haupt-Worker selbst, greift
 * dieser Watchdog nicht (bekannte Grenze, externes Monitoring nötig).
 */
async function staleWorkerWatchdog(): Promise<void> {
  // Kein JS-Date als Query-Param — der Treiber akzeptiert hier nur Strings
  // (Boot-Fehler 2026-08-20: ERR_INVALID_ARG_TYPE bei Date-Parametern).
  const stale = await db
    .select({
      workerId: workerHeartbeats.workerId,
      hostname: workerHeartbeats.hostname,
      lastSeenAt: workerHeartbeats.lastSeenAt,
    })
    .from(workerHeartbeats)
    .where(
      and(
        sql`${workerHeartbeats.lastSeenAt} < now() - interval '3 minutes'`,
        sql`${workerHeartbeats.lastSeenAt} > now() - interval '24 hours'`,
      ),
    );
  for (const w of stale) {
    // Eigener Prozess kann hier nicht stale sein (wir schreiben alle 30s).
    log("warn", `stale worker heartbeat: ${w.workerId} last seen ${w.lastSeenAt.toISOString()}`);
    await sendOpsAlert({
      topic: `stale-worker-${w.workerId}`,
      subject: `Worker ohne Heartbeat: ${w.hostname}`,
      text: `Der Worker ${w.workerId} (Host ${w.hostname}) hat seit ${w.lastSeenAt.toISOString()} keinen Heartbeat mehr geschrieben. Bitte Container und Server pruefen. (Einmal-Alert: der Eintrag wird jetzt entfernt; meldet sich der Worker zurueck, legt sein Heartbeat ihn neu an.)`,
    });
    // Alert once, then bury: die Row danach löschen. Jede WORKER_ID ist
    // eine Einweg-Identität (Random-UUID pro Boot) — ein toter Eintrag wird
    // nie wieder lebendig, nur sein Nachfolger. Ohne Delete mailt jeder
    // `docker rm -f`-Deploy (SIGKILL, kein stopHeartbeat-Cleanup) den Admin
    // 24 h lang alle 30 min an (Alert-Sturm 2026-08-21, 8 Deploy-Leichen).
    await db
      .delete(workerHeartbeats)
      .where(eq(workerHeartbeats.workerId, w.workerId));
  }
}

const WORKER_ID = `${hostname()}-${randomUUID().slice(0, 8)}`;

function log(level: "info" | "warn" | "error", msg: string, extra?: unknown): void {
  // eslint-disable-next-line no-console
  const fn = level === "error" ? console.error : level === "warn" ? console.warn : console.log;
  if (extra) fn(`[worker:${WORKER_ID}] ${msg}`, extra);
  else fn(`[worker:${WORKER_ID}] ${msg}`);
}

async function main(): Promise<void> {
  log("info", "booting…");
  startHeartbeat(WORKER_ID);

  // Stuck-Lead-Recovery: leads die in rendering/uploading hängen
  // (Worker-Crash, Container-Restart mitten in Pipeline) zurück auf
  // pending setzen + re-enqueue. Wird beim Boot ausgeführt + alle 2 min.
  await stuckLeadRecovery().catch((err) => {
    log("error", "initial stuck-recovery failed:", err);
  });
  const recoveryTimer = setInterval(() => {
    stuckLeadRecovery().catch((err) => {
      log("error", "periodic stuck-recovery failed:", err);
    });
  }, 120_000);
  recoveryTimer.unref();

  // Intro-Staging-Watchdog: verlorene queued/generating Intro-Leads
  // re-enqueuen bzw. nach 3 Versuchen explizit auf Fallback setzen.
  await introStagingRecovery().catch((err) => {
    log("error", "initial intro-staging-recovery failed:", err);
  });
  const introRecoveryTimer = setInterval(() => {
    introStagingRecovery().catch((err) => {
      log("error", "periodic intro-staging-recovery failed:", err);
    });
  }, 120_000);
  introRecoveryTimer.unref();

  // Preflight-Recovery: orphaned-pending / stuck-running / exhausted /
  // run-finalization für die Phase-1-Pipeline. Eigenständige Timer-Schleife,
  // damit ein Fehler im Preflight-Recovery den klassischen Pipeline-Recovery
  // nicht mitreißt (und vice versa).
  await preflightRecovery().catch((err) => {
    log("error", "initial preflight-recovery failed:", err);
  });
  const preflightRecoveryTimer = setInterval(() => {
    preflightRecovery().catch((err) => {
      log("error", "periodic preflight-recovery failed:", err);
    });
  }, 120_000);
  preflightRecoveryTimer.unref();

  // Heartbeat-Watchdog: tote Worker (z. B. render-1 down) per Mail melden.
  const staleWorkerTimer = setInterval(() => {
    staleWorkerWatchdog().catch((err) => {
      log("error", "stale-worker-watchdog failed:", err);
    });
  }, 120_000);
  staleWorkerTimer.unref();

  // Run-ETA (W3): auslastungsbewusste Restzeit für alle laufenden Runs,
  // alle 12 s frisch nach Redis. Reine Anzeige-Hilfe — Fehler loggen, nie
  // den Worker mitreißen.
  const etaTimer = setInterval(() => {
    computeAndCacheRunEtas().catch((err) => {
      log("error", "run-eta tick failed:", err);
    });
  }, 12_000);
  etaTimer.unref();

  // Custom-Domain-Verifier: läuft alle 30s, checkt pending/verifying/
  // issuing_cert Domains gegen DNS+TXT und schreibt Traefik-YAMLs nach
  // erfolgreicher Verifikation. Boot-Sync schreibt aktive Domains neu —
  // damit ein Container-Restart die Configs garantiert wiederherstellt.
  const stopDomainVerifier = startDomainVerifier();

  // Custom-Domain-Monitor: stuendlicher HTTPS-Health-Check pro aktiver
  // Domain + taegliches acme.json-Backup. Ergaenzt den Verifier (der nur
  // bis "active" geht) um Operational-Reliability.
  const stopDomainMonitor = startDomainMonitor();

  // Bunny-Asset-Purger (Paket B): sweept Orphans + loescht physisch via
  // Bunny-Stream/-Storage-APIs. Tickt alle 60s. Erste Iteration startet
  // sofort beim Boot — laufende Orphans (z.B. aus einem Cascade-Delete
  // vor Container-Restart) werden im naechsten Minutenfenster aufgeraeumt.
  const stopBunnyPurger = startBunnyPurger();

  // Bunny-Library-Reconcile: gleicht die KOMPLETTE Stream-Library gegen die
  // DB ab und loescht nachweislich unreferenzierte Videos (>24h alt).
  // Faengt die Leichen, die der Purger nie sieht, weil sie nie im
  // bunny_assets-Register gelandet sind (abgebrochene Pipelines, Alt-Bestand).
  const stopBunnyReconciler = startBunnyLibraryReconciler();

  // E-Mail-Outreach: vor dem Start des Drip-Loops verwaiste Claims aus
  // einem Crash (claimed_at gesetzt, nie versendet) als failed abräumen,
  // damit die Blast-Zähler stimmen und nichts hängen bleibt.
  await recoverStaleEmailClaims().catch((err) => {
    log("error", "initial email stale-claim recovery failed:", err);
  });

  // Drip-Engine: 60s-Loop, versendet pro Tick max. 1 Mail pro Postfach
  // (Sendefenster + Warmup + Tageslimit), Claim via SKIP LOCKED.
  const stopEmailDrip = startEmailDrip();

  // Rückkanal-Sync: 5-min-Loop, pollt verbundene Postfächer (Graph-Delta /
  // IMAP-UID) auf Bounces und Replies.
  const stopMailboxSync = startMailboxSync();

  // Abo-Ende-Cleanup: 6h-Sweep. 30 Tage nach Abo-Ende werden Seiten +
  // Videos komplett geloescht — mit Ankuendigungs-, Erinnerungs- und
  // Bestaetigungs-Mail. Credits und Account bleiben erhalten.
  const stopAccountCleanup = startAccountCleanup();

  // Analytics-Retention: 6h-Sweep. Heartbeats > 24h + andere Events > 90d
  // löschen, damit site_events unabhängig vom Traffic stabil bleibt.
  const stopAnalyticsRetention = startAnalyticsRetention();

  // Global cap — muss über der Summe der per-stage timeouts in
  // processors/pipeline.ts liegen. Worst case (Docs-native-Kampagne):
  // videoRender 300 + videoCompress 90 + videoUpload 330 (inkl. Bunny-
  // Encoding-Wait) + landingPage 10 + thumb 15 + qr 5 + thumbnailGenerate 30
  // + lpScreenshot 45 + docsNativeRender 270 + pdfCompress 20 + pdfUpload 30
  // ≈ 1145s (~19 min) plus Orchestration-Headroom. Env-Override für
  // Sonderfälle (z.B. langsame Bunny-Encoding-Phasen bei Groß-Runs).
  const PIPELINE_HARD_TIMEOUT_MS = Number(
    process.env.PIPELINE_HARD_TIMEOUT_MS ?? String(20 * 60 * 1000),
  );
  const worker = pipelineWorker(async (job: Job<LeadJobData>) => {
    incrementInFlight();
    try {
      log("info", `start job=${job.id} lead=${job.data.leadId}`);
      // Hard timeout per Lead: wenn die Pipeline länger als 4 min braucht,
      // werfen wir, BullMQ markiert den Job als failed UND der Slot wird
      // frei. Verhindert dass ein hängendes Puppeteer/LibreOffice das
      // ganze System einfriert.
      const result = await Promise.race([
        pipelineProcessor(job),
        new Promise<never>((_, reject) =>
          setTimeout(
            () =>
              reject(
                new Error(
                  `[pipeline] lead exceeded ${PIPELINE_HARD_TIMEOUT_MS}ms hard timeout`,
                ),
              ),
            PIPELINE_HARD_TIMEOUT_MS,
          ),
        ),
      ]);
      log("info", `done  job=${job.id} lead=${job.data.leadId}`);
      return result;
    } catch (err) {
      log("error", `fail  job=${job?.id} lead=${job?.data?.leadId}`, err);
      throw err;
    } finally {
      decrementInFlight();
    }
  });

  worker.on("failed", (job, err) => {
    log("error", `job ${job?.id} failed:`, err?.message);
  });
  worker.on("error", (err) => {
    log("error", "worker error:", err.message);
  });

  // Screenshot worker — runs in the same process so it shares the same
  // browser pool. Concurrency is controlled separately via
  // SCREENSHOT_WORKER_CONCURRENCY (default 2).
  const screenshotW = screenshotWorker(async (job: Job<ScreenshotJobData>) => {
    incrementInFlight();
    try {
      log("info", `screenshot start job=${job.id} screenshotJob=${job.data.jobId}`);
      const result = await screenshotProcessor(job);
      log("info", `screenshot done  job=${job.id} screenshotJob=${job.data.jobId}`);
      return result;
    } catch (err) {
      log(
        "error",
        `screenshot fail  job=${job?.id} screenshotJob=${job?.data?.jobId}`,
        err,
      );
      throw err;
    } finally {
      decrementInFlight();
    }
  });

  screenshotW.on("failed", (job, err) => {
    log("error", `screenshot job ${job?.id} failed:`, err?.message);
  });
  screenshotW.on("error", (err) => {
    log("error", "screenshot worker error:", err.message);
  });

  // Brand-Extraktion (Landingpage v3): Website-URL → BrandKit + Logo-
  // Kandidaten. Läuft im selben Prozess und teilt sich den Browser-Pool
  // mit den Screenshot-Jobs. Concurrency default 2
  // (BRAND_EXTRACT_WORKER_CONCURRENCY).
  const brandExtractW = brandExtractWorker(
    async (job: Job<BrandExtractJobData>) => {
      incrementInFlight();
      try {
        log(
          "info",
          `brand-extract start job=${job.id} extractJob=${job.data.jobId}`,
        );
        const result = await brandExtractProcessor(job);
        log(
          "info",
          `brand-extract done  job=${job.id} extractJob=${job.data.jobId}`,
        );
        return result;
      } catch (err) {
        log(
          "error",
          `brand-extract fail  job=${job?.id} extractJob=${job?.data?.jobId}`,
          err,
        );
        throw err;
      } finally {
        decrementInFlight();
      }
    },
  );

  brandExtractW.on("failed", (job, err) => {
    log("error", `brand-extract job ${job?.id} failed:`, err?.message);
  });
  brandExtractW.on("error", (err) => {
    log("error", "brand-extract worker error:", err.message);
  });

  // CRM-Sync worker — pushes lead-event aggregates to external CRMs
  // (HubSpot/Salessuite/Close) on a 30s debounce. Concurrency is
  // deliberately small (default 2) to stay inside Salessuite's
  // 3-concurrent-request quota per tenant; tunable via
  // CRM_WORKER_CONCURRENCY env. See `worker/crm-queue.ts` + the
  // processor at `processors/crm-sync.ts`.
  const crmSyncW = crmSyncWorker(async (job: Job<CrmSyncJob>) => {
    incrementInFlight();
    try {
      log(
        "info",
        `crm-sync start job=${job.id} lead=${job.data.leadId} kind=${job.data.kind}`,
      );
      await processCrmSyncJob(job);
      log(
        "info",
        `crm-sync done  job=${job.id} lead=${job.data.leadId} kind=${job.data.kind}`,
      );
    } catch (err) {
      log(
        "error",
        `crm-sync fail  job=${job?.id} lead=${job?.data?.leadId} kind=${job?.data?.kind}`,
        err,
      );
      throw err;
    } finally {
      decrementInFlight();
    }
  });

  crmSyncW.on("failed", (job, err) => {
    log("error", `crm-sync job ${job?.id} failed:`, err?.message);
  });
  crmSyncW.on("error", (err) => {
    log("error", "crm-sync worker error:", err.message);
  });

  // Outgoing-Webhook-Delivery worker — pushes signed JSON payloads to
  // customer-configured endpoints. Concurrency default 8 (tunable via
  // WEBHOOK_WORKER_CONCURRENCY) — most pushes are <500ms; per-endpoint
  // rate-limit (`webhook:inflight:<endpointId>`) caps to 4 parallel
  // pushes per endpoint regardless of global concurrency.
  const webhookW = new Worker<WebhookDeliveryJob>(
    WEBHOOK_DELIVERY_QUEUE,
    async (job) => {
      incrementInFlight();
      try {
        log(
          "info",
          `webhook start job=${job.id} delivery=${job.data.deliveryId}`,
        );
        await processWebhookDelivery(job);
        log(
          "info",
          `webhook done  job=${job.id} delivery=${job.data.deliveryId}`,
        );
      } catch (err) {
        log(
          "error",
          `webhook fail  job=${job?.id} delivery=${job?.data?.deliveryId}`,
          err,
        );
        throw err;
      } finally {
        decrementInFlight();
      }
    },
    {
      connection: getRedisConnection() as unknown as ConnectionOptions,
      concurrency: Number(process.env.WEBHOOK_WORKER_CONCURRENCY ?? "8"),
      stalledInterval: 30_000,
      maxStalledCount: 2,
      lockDuration: 60_000,
      lockRenewTime: 20_000,
      removeOnComplete: { count: 500 },
      removeOnFail: { count: 2000 },
    },
  );

  webhookW.on("failed", (job, err) => {
    log("error", `webhook job ${job?.id} failed:`, err?.message);
  });
  webhookW.on("error", (err) => {
    log("error", "webhook worker error:", err.message);
  });

  // Outreach-GIF-Worker (E-Mail-Feature, Step 2). Encodiert pro Lead den
  // GIF-Ausschnitt aus dem Lead-Video (ffmpeg via runFfmpeg-Wrapper) und
  // laedt ihn nach Bunny Storage. Concurrency default 2
  // (EMAIL_GIF_WORKER_CONCURRENCY) — palettegen ist CPU-lastig.
  const emailGifW = emailGifWorker(async (job: Job<EmailGifJobData>) => {
    incrementInFlight();
    try {
      log("info", `email-gif start job=${job.id} lead=${job.data.leadId}`);
      const result = await processEmailGifJob(job);
      log(
        "info",
        `email-gif done  job=${job.id} lead=${job.data.leadId} status=${result.status}`,
      );
      return result;
    } catch (err) {
      log(
        "error",
        `email-gif fail  job=${job?.id} lead=${job?.data?.leadId}`,
        err,
      );
      throw err;
    } finally {
      decrementInFlight();
    }
  });
  emailGifW.on("failed", (job, err) => {
    log("error", `email-gif job ${job?.id} failed:`, err?.message);
  });
  emailGifW.on("error", (err) => {
    log("error", "email-gif worker error:", err.message);
  });

  // URL-Mediathek-Preview-Worker. Eigene Queue, eigene Concurrency (4 default).
  // Trennt kurzlebige Puppeteer-Screenshots von den langlaufenden Render-Jobs.
  const urlPreviewW = urlPreviewWorker(async (job) => {
    incrementInFlight();
    try {
      log("info", `url-preview start job=${job.id} mediaUrlId=${job.data.mediaUrlId}`);
      const result = await processUrlPreviewJob(job);
      log(
        "info",
        `url-preview done  job=${job.id} mediaUrlId=${job.data.mediaUrlId} status=${result.status}`,
      );
    } catch (err) {
      log(
        "error",
        `url-preview fail  job=${job?.id} mediaUrlId=${job?.data?.mediaUrlId}`,
        err,
      );
      throw err;
    } finally {
      decrementInFlight();
    }
  });
  urlPreviewW.on("failed", (job, err) => {
    log("error", `url-preview job ${job?.id} failed:`, err?.message);
  });
  urlPreviewW.on("error", (err) => {
    log("error", "url-preview worker error:", err.message);
  });

  // Voice-Training-Worker (Intro-Feature): trainiert den Fish-Audio-Voice-
  // Clone aus dem User-Sample. Concurrency 1 (VOICE_TRAINING_WORKER_
  // CONCURRENCY) — selten und I/O-bound.
  const voiceTrainingW = voiceTrainingWorker(
    async (job: Job<VoiceTrainingJobData>) => {
      incrementInFlight();
      try {
        log("info", `voice-training start job=${job.id} profile=${job.data.voiceProfileId}`);
        const result = await processVoiceTrainingJob(job);
        log(
          "info",
          `voice-training done  job=${job.id} profile=${job.data.voiceProfileId} status=${result.status}`,
        );
        return result;
      } catch (err) {
        log(
          "error",
          `voice-training fail  job=${job?.id} profile=${job?.data?.voiceProfileId}`,
          err,
        );
        throw err;
      } finally {
        decrementInFlight();
      }
    },
  );
  voiceTrainingW.on("failed", (job, err) => {
    log("error", `voice-training job ${job?.id} failed:`, err?.message);
  });
  voiceTrainingW.on("error", (err) => {
    log("error", "voice-training worker error:", err.message);
  });

  // Intro-Kalibrierungs-Worker: Audio-Analyse eines Webcam-Videos
  // (Silence-Struktur, LUFS/Spektrum, Raumton). Kurzlebig, ffmpeg-bound.
  const introCalibrationW = introCalibrationWorker(
    async (job: Job<IntroCalibrationJobData>) => {
      incrementInFlight();
      try {
        log("info", `intro-calibration start job=${job.id} cal=${job.data.calibrationId}`);
        const result = await processIntroCalibrationJob(job);
        log(
          "info",
          `intro-calibration done  job=${job.id} cal=${job.data.calibrationId} status=${result.status}`,
        );
        return result;
      } catch (err) {
        log(
          "error",
          `intro-calibration fail  job=${job?.id} cal=${job?.data?.calibrationId}`,
          err,
        );
        throw err;
      } finally {
        decrementInFlight();
      }
    },
  );
  introCalibrationW.on("failed", (job, err) => {
    log("error", `intro-calibration job ${job?.id} failed:`, err?.message);
  });
  introCalibrationW.on("error", (err) => {
    log("error", "intro-calibration worker error:", err.message);
  });

  // Intro-Preview-Worker: bis zu 3 Vorschau-Videos (~15s) mit KI-Begrüßung
  // nach der awaiting_approval-Promotion. Läuft asynchron, blockiert die
  // Promotion nie; die UI pollt runs.intro_preview.
  const introPreviewW = introPreviewWorker(
    async (job: Job<IntroPreviewJobData>) => {
      incrementInFlight();
      try {
        log("info", `intro-preview start job=${job.id} run=${job.data.runId}`);
        const result = await processIntroPreviewJob(job);
        log(
          "info",
          `intro-preview done  job=${job.id} run=${job.data.runId} status=${result.status}` +
            (result.previews !== undefined ? ` previews=${result.previews}` : "") +
            (result.reason ? ` reason=${result.reason}` : ""),
        );
        return result;
      } catch (err) {
        log(
          "error",
          `intro-preview fail  job=${job?.id} run=${job?.data?.runId}`,
          err,
        );
        throw err;
      } finally {
        decrementInFlight();
      }
    },
  );
  introPreviewW.on("failed", (job, err) => {
    log("error", `intro-preview job ${job?.id} failed:`, err?.message);
  });
  introPreviewW.on("error", (err) => {
    log("error", "intro-preview worker error:", err.message);
  });

  // Intro-Staging-Worker: personalisierte Begrüßung pro Lead VOR dem
  // Render (eigene Queue, Concurrency = sync.so-Limit). Enqueued nach
  // Abschluss selbst den Render-Job — siehe processors/intro-generation.ts.
  const introGenerationW = introGenerationWorker(
    async (job: Job<IntroGenerationJobData>, token?: string) => {
      incrementInFlight();
      try {
        log(
          "info",
          `intro-generation start job=${job.id} lead=${job.data.leadId}`,
        );
        const result = await introGenerationProcessor(job, token);
        log(
          "info",
          `intro-generation done  job=${job.id} lead=${job.data.leadId}` +
            (result.introStatus ? ` status=${String(result.introStatus)}` : "") +
            (result.skipped ? ` skipped=${String(result.skipped)}` : ""),
        );
        return result;
      } catch (err) {
        if (err instanceof DelayedError) {
          // Dedup-Wartender: Job wurde nach delayed verschoben — kein Fehler.
          log(
            "info",
            `intro-generation wait  job=${job.id} lead=${job.data.leadId} (dedup)`,
          );
          throw err;
        }
        log(
          "error",
          `intro-generation fail  job=${job?.id} lead=${job?.data?.leadId}`,
          err,
        );
        throw err;
      } finally {
        decrementInFlight();
      }
    },
  );
  introGenerationW.on("failed", (job, err) => {
    log("error", `intro-generation job ${job?.id} failed:`, err?.message);
  });
  introGenerationW.on("error", (err) => {
    log("error", "intro-generation worker error:", err.message);
  });

  // URL-Preview-Stale-Refresh-Tick. 1×/h scannt nach Preview-Eintraegen
  // deren TTL ueberfaellig ist und enqueued Refresh-Jobs (max 50 pro Tick).
  // Beim Boot 1× sofort, damit ein langer Container-Outage Stale-Backlog
  // schnell abarbeitet.
  refreshStalePreviews()
    .then((r) => log("info", `url-preview stale-refresh boot: ${r.enqueued}/${r.scanned}`))
    .catch((err) => log("error", "stale-refresh boot failed:", err));
  const stalePreviewTimer = setInterval(() => {
    refreshStalePreviews()
      .then((r) => {
        if (r.enqueued > 0)
          log("info", `url-preview stale-refresh tick: ${r.enqueued}/${r.scanned}`);
      })
      .catch((err) => log("error", "stale-refresh tick failed:", err));
  }, 60 * 60 * 1000); // 1×/h
  stalePreviewTimer.unref();

  // Preflight-Worker mit-booten. Agent 2 liefert `bootPreflightWorker()` aus
  // `src/worker/preflight-worker-setup.ts` — der Return ist ein BullMQ-
  // Worker, dessen `.close()` wir im Shutdown aufrufen. Wir umschließen den
  // Boot mit try/catch, damit ein kaputter Preflight-Worker NICHT den
  // bestehenden Pipeline-Worker mitreißt (siehe Coolify-Restart-Risiko).
  const { bootPreflightWorker } = await import("./preflight-worker-setup");
  let preflightWorkerShutdown: (() => Promise<void> | void) | null = null;
  try {
    const handle = bootPreflightWorker();
    preflightWorkerShutdown = () => handle.close();
    log("info", "preflight worker booted.");
  } catch (err) {
    log(
      "warn",
      "preflight worker not booted (boot failed):",
      (err as Error)?.message ?? err,
    );
  }

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    log("info", `received ${signal}, shutting down…`);
    // Heartbeat-Row ZUERST löschen: die BullMQ-Drains unten können länger
    // dauern als Dockers 10s-Stop-Timeout → SIGKILL, und die Leiche in
    // worker_heartbeats triggert den Watchdog-Alert. Früh löschen ist
    // sicher — die Row signalisiert nur Lebendigkeit, harte Crashes fängt
    // der Watchdog weiterhin.
    try {
      await stopHeartbeat();
    } catch (err) {
      log("error", "heartbeat stop failed:", err);
    }
    try {
      await worker.close(); // waits for in-flight jobs
    } catch (err) {
      log("error", "worker close failed:", err);
    }
    try {
      await screenshotW.close();
    } catch (err) {
      log("error", "screenshot worker close failed:", err);
    }
    try {
      await brandExtractW.close();
    } catch (err) {
      log("error", "brand-extract worker close failed:", err);
    }
    try {
      await crmSyncW.close();
    } catch (err) {
      log("error", "crm-sync worker close failed:", err);
    }
    try {
      await webhookW.close();
    } catch (err) {
      log("error", "webhook worker close failed:", err);
    }
    try {
      await emailGifW.close();
    } catch (err) {
      log("error", "email-gif worker close failed:", err);
    }
    try {
      await urlPreviewW.close();
    } catch (err) {
      log("error", "url-preview worker close failed:", err);
    }
    try {
      await voiceTrainingW.close();
    } catch (err) {
      log("error", "voice-training worker close failed:", err);
    }
    try {
      await introCalibrationW.close();
    } catch (err) {
      log("error", "intro-calibration worker close failed:", err);
    }
    try {
      await introPreviewW.close();
    } catch (err) {
      log("error", "intro-preview worker close failed:", err);
    }
    try {
      await introGenerationW.close();
    } catch (err) {
      log("error", "intro-generation worker close failed:", err);
    }
    try {
      await closeBrowserPool();
    } catch (err) {
      log("error", "browser pool shutdown failed:", err);
    }
    try {
      stopDomainVerifier();
    } catch (err) {
      log("error", "domain verifier stop failed:", err);
    }
    try {
      stopDomainMonitor();
    } catch (err) {
      log("error", "domain monitor stop failed:", err);
    }
    try {
      stopBunnyPurger();
    } catch (err) {
      log("error", "bunny purger stop failed:", err);
    }
    try {
      stopBunnyReconciler();
    } catch (err) {
      log("error", "bunny reconciler stop failed:", err);
    }
    try {
      stopEmailDrip();
    } catch (err) {
      log("error", "email drip stop failed:", err);
    }
    try {
      stopMailboxSync();
    } catch (err) {
      log("error", "mailbox sync stop failed:", err);
    }
    try {
      stopAccountCleanup();
    } catch (err) {
      log("error", "account cleanup stop failed:", err);
    }
    try {
      stopAnalyticsRetention();
    } catch (err) {
      log("error", "analytics retention stop failed:", err);
    }
    if (preflightWorkerShutdown) {
      try {
        await preflightWorkerShutdown();
      } catch (err) {
        log("error", "preflight worker stop failed:", err);
      }
    }
    log("info", "bye.");
    process.exit(0);
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));

  log("info", "ready.");
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(`[worker:${WORKER_ID}] fatal:`, err);
  process.exit(1);
});
