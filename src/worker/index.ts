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
import { pipelineWorker, pipelineQueue } from "./queue";
import { screenshotWorker, type ScreenshotJobData } from "./screenshot-queue";
import { pipelineProcessor } from "./processors/pipeline";
import { screenshotProcessor } from "./processors/screenshot";
import { closeBrowserPool } from "./lib/browser-pool";
import { startDomainVerifier } from "./jobs/domain-verifier";
import { startDomainMonitor } from "./jobs/domain-monitor";
import {
  startHeartbeat,
  stopHeartbeat,
  incrementInFlight,
  decrementInFlight,
} from "./lib/heartbeat";
import { db } from "@/lib/db";
import { leads, runs } from "@/lib/db/schema";
import {
  enqueueApprovedLeadsForPhase2,
  requeuePreflightLeads,
} from "@/lib/preflight/job-enqueue";
import { PREFLIGHT_TERMINAL_STATUSES } from "@/lib/preflight/types";
import type { LeadJobData } from "./types";
import type { Job } from "bullmq";

/**
 * Findet Leads die seit >5 min in 'rendering'/'uploading' hängen
 * (Worker-Crash, Container-Restart mid-pipeline) und re-enqueued sie.
 * Wird beim Boot + alle 2 min ausgeführt.
 */
async function stuckLeadRecovery(): Promise<void> {
  const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);

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
          opts: { jobId: s.id },
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
    })
    .from(leads)
    .innerJoin(runs, eq(runs.id, leads.runId))
    .where(
      and(
        inArray(leads.status, ["rendering", "uploading"]),
        lt(leads.startedAt, fiveMinutesAgo),
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
        lt(leads.startedAt, fiveMinutesAgo),
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
    `[worker:${WORKER_ID}] stuck-recovery: found ${stuck.length} leads stuck >5min, requeueing`,
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
        opts: { jobId: s.id },
      })),
    );
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`[worker:${WORKER_ID}] stuck-recovery enqueue failed:`, err);
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
    await db.execute(sql`
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
    `);
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
    for (const r of approvedRuns) {
      try {
        const result = await enqueueApprovedLeadsForPhase2(r.id, r.userId);
        if (result.transitioned) {
          // eslint-disable-next-line no-console
          console.log(
            `[worker:${WORKER_ID}] approved-run-watcher: enqueued ${result.queued} leads for run=${r.id}`,
          );
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

  // Custom-Domain-Verifier: läuft alle 30s, checkt pending/verifying/
  // issuing_cert Domains gegen DNS+TXT und schreibt Traefik-YAMLs nach
  // erfolgreicher Verifikation. Boot-Sync schreibt aktive Domains neu —
  // damit ein Container-Restart die Configs garantiert wiederherstellt.
  const stopDomainVerifier = startDomainVerifier();

  // Custom-Domain-Monitor: stuendlicher HTTPS-Health-Check pro aktiver
  // Domain + taegliches acme.json-Backup. Ergaenzt den Verifier (der nur
  // bis "active" geht) um Operational-Reliability.
  const stopDomainMonitor = startDomainMonitor();

  // 4 min global cap — sum of per-stage timeouts in processors/pipeline.ts
  // (videoRender 120 + videoUpload 60 + landingPage 10 + thumb 15 + qr 5 +
  // docxModify 30 + docxToPdf 60 + pdfCompress 20 + pdfUpload 30 = 350s)
  // plus ~10s orchestration headroom. The per-stage timeouts are the
  // first line of defense; this is the belt-and-suspenders catch-all.
  const PIPELINE_HARD_TIMEOUT_MS = 4 * 60 * 1000;
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
    if (preflightWorkerShutdown) {
      try {
        await preflightWorkerShutdown();
      } catch (err) {
        log("error", "preflight worker stop failed:", err);
      }
    }
    stopHeartbeat();
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
