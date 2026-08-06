/**
 * Job-Enqueue-Helper für die Lead-Quality-Check / Preflight-Pipeline.
 *
 * Diese Datei sitzt bewusst in `src/lib/preflight/` (nicht in `worker/`), weil
 * sie sowohl vom Next.js-API-Layer (Route-Handler) als auch potentiell vom
 * Worker importiert wird — Letzteres wäre zwar ein Cross-Layer-Sprung, aber
 * indem wir hier eine eigene `preflightQueue()`-Instanz aufmachen, vermeiden
 * wir die Abhängigkeit auf `src/worker/queue.ts` (Agent 2's Hoheit).
 *
 * Verträge mit Agent 1 + Agent 2
 * ────────────────────────────────────────────────────────────────────────────
 *  - Agent 1 baut `/api/runs/[id]/preflight/approve/route.ts`. Diese Route
 *    MUSS am Ende `enqueueApprovedLeadsForPhase2(runId, userId)` aus diesem
 *    Modul aufrufen — damit aus dem Status `approved` heraus die teure
 *    Phase-2-Pipeline angeworfen wird.
 *  - Agent 2 hält den `lead-preflight`-Worker am Laufen. Die Queue-Name muss
 *    übereinstimmen (siehe `PREFLIGHT_QUEUE_NAME`). Das Job-Payload-Schema
 *    ist `PreflightJobData` (s.u.) — Felder analog zu `LeadJobData`, damit
 *    Agent 2's Processor sich an gewohnten Mustern orientieren kann.
 *  - Stale-Job-Purge VOR jedem `addBulk` (siehe Recovery-Bug von gestern):
 *    BullMQ dedupt stillschweigend bei identischer jobId, auch wenn der
 *    Job in completed/failed-Sets liegt — Lösung: `remove(jobId)` first.
 *
 * Tenant-Safety: alle DB-Queries laufen mit JOIN auf `runs.userId`, damit
 * niemals Leads eines fremden Users gelesen oder verändert werden.
 */

import { Queue, type ConnectionOptions } from "bullmq";
import IORedis from "ioredis";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { leads, runs } from "@/lib/db/schema";
import {
  findDuplicates,
  validateLeadInline,
  type DuplicateInput,
} from "./inline-validate";
import {
  bulkSetPreflightStatus,
  getLeadsForPreflightStart,
  type PreflightStatusUpdate,
} from "@/lib/db/queries/leads";

export const PREFLIGHT_QUEUE_NAME = "lead-preflight";
export const PIPELINE_QUEUE_NAME = "lead-pipeline";

/**
 * Wire-Format für einen Preflight-Job. Agent 2's Worker liest diese Felder
 * 1:1 — Änderungen erfordern Coordination.
 */
export interface PreflightJobData {
  leadId: string;
  runId: string;
  userId: string;
  campaignId: string;
}

/**
 * Wire-Format für einen Pipeline-Job (Phase 2). Spiegelt `LeadJobData` aus
 * `src/worker/types.ts` — wir definieren ihn lokal nochmal, damit dieses
 * Modul keine Hard-Dependency auf den worker-tree hat (der lazy-loaded
 * BullMQ + Browser-Pool zieht).
 */
interface PipelineJobData {
  leadId: string;
  runId: string;
  userId: string;
  campaignId: string;
}

// ── Redis-Verbindung (lazy, geteilt zwischen preflight + pipeline) ─────────

let _redisConnection: IORedis | null = null;

function getRedisUrl(): string {
  const url = process.env.REDIS_URL;
  if (!url) throw new Error("[preflight/enqueue] REDIS_URL is required");
  return url;
}

function getRedisConnection(): IORedis {
  if (_redisConnection) return _redisConnection;
  _redisConnection = new IORedis(getRedisUrl(), {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    connectTimeout: 10_000,
    enableOfflineQueue: false,
    retryStrategy(times: number) {
      return Math.min(1000 * 2 ** Math.min(times, 6), 10_000);
    },
  });
  _redisConnection.on("error", (err) => {
    // eslint-disable-next-line no-console
    console.error("[preflight/enqueue:redis] error:", err.message);
  });
  return _redisConnection;
}

function getConnectionOpts(): ConnectionOptions {
  return getRedisConnection() as unknown as ConnectionOptions;
}

// ── Queue-Singletons ───────────────────────────────────────────────────────

let _preflightQueue: Queue<PreflightJobData> | null = null;
let _pipelineQueueForApproval: Queue<PipelineJobData> | null = null;

/**
 * Liefert die `lead-preflight`-Queue. Lazy-instanziiert; einmal pro Prozess.
 * Wir definieren die Queue hier statt sie aus `@/worker/queue` zu importieren,
 * damit dieses Modul ohne Worker-Side-Effects (Browser-Pool, FFmpeg-Init)
 * in einem Next.js-Edge/Node-Request-Kontext lauffähig bleibt.
 */
export function preflightQueue(): Queue<PreflightJobData> {
  if (_preflightQueue) return _preflightQueue;
  _preflightQueue = new Queue<PreflightJobData>(PREFLIGHT_QUEUE_NAME, {
    connection: getConnectionOpts(),
    defaultJobOptions: {
      attempts: 2,
      backoff: { type: "exponential", delay: 5_000 },
      removeOnComplete: 100,
      removeOnFail: 500,
    },
  });
  return _preflightQueue;
}

/**
 * Liefert die bestehende `lead-pipeline`-Queue. Wir importieren NICHT die
 * Singleton-Instanz aus `@/worker/queue`, weil das Modul beim Import
 * unmittelbar BullMQ-+-Redis-State aufbaut und im Next.js-Request-Kontext
 * ein zweiter Singleton-Konflikt wäre. Statt dessen wirft BullMQ keinen
 * Fehler, wenn mehrere Queue-Instanzen denselben Namen+Connection nutzen —
 * der Effekt ist eine einzige tatsächliche Redis-Queue.
 */
function pipelineQueueLocal(): Queue<PipelineJobData> {
  if (_pipelineQueueForApproval) return _pipelineQueueForApproval;
  _pipelineQueueForApproval = new Queue<PipelineJobData>(PIPELINE_QUEUE_NAME, {
    connection: getConnectionOpts(),
    defaultJobOptions: {
      attempts: 2,
      backoff: { type: "exponential", delay: 5_000 },
      removeOnComplete: 100,
      removeOnFail: 500,
    },
  });
  return _pipelineQueueForApproval;
}

// ───────────────────────────────────────────────────────────────────────────
// ── Phase 1: enqueueForPreflight() ────────────────────────────────────────
// ───────────────────────────────────────────────────────────────────────────

export interface EnqueueForPreflightResult {
  /** Anzahl Leads, die der Run insgesamt führt (nicht soft-deleted). */
  totalLeads: number;
  /** Anzahl Leads, die als Preflight-Job in BullMQ landen. */
  queuedForPreflight: number;
  /**
   * Anzahl Leads, die inline disqualifiziert wurden (missing_field /
   * duplicate / invalid_url) und gar keinen Worker-Job sehen.
   */
  alreadyDisqualified: number;
}

/**
 * Wird vom `/api/runs/[id]/start`-Endpunkt aufgerufen, nachdem die Leads
 * bulk-inserted wurden.
 *
 * Schritte:
 *   1. Lade alle nicht-removed Leads des Runs.
 *   2. Inline-Validation (Pflichtfelder, URL-Format, Email-Format).
 *   3. Duplikat-Detection über Host + Email (innerhalb des Batches).
 *   4. Schritte 2+3 schreiben terminal-Stati (missing_field / duplicate /
 *      url_dead) DIREKT in `leads.preflight_status` — diese Leads bekommen
 *      KEINEN Worker-Job.
 *   5. Alle übrigen Leads werden in `lead-preflight` enqueued, mit
 *      Stale-Job-Purge (siehe Modul-Header).
 *
 * Idempotenz: der Caller stellt sicher, dass dieser Helper nicht mehrfach
 * pro Run aufgerufen wird (`runs.status`-Übergang). Innerhalb dieses Helpers
 * deduplizieren wir aber pro Lead über die jobId = leadId — selbst bei
 * Race wäre ein Doppel-Enqueue kein Datenkorruption-Risiko.
 */
export async function enqueueForPreflight(
  runId: string,
  userId: string,
  campaignId: string,
): Promise<EnqueueForPreflightResult> {
  // 1) Leads laden (Tenant-Guard im Query).
  const rows = await getLeadsForPreflightStart(runId, userId);
  const total = rows.length;

  // 2) Inline-Validation pro Lead.
  const updates: PreflightStatusUpdate[] = [];
  const eligibleForDupCheck: DuplicateInput[] = [];
  for (const r of rows) {
    const v = validateLeadInline(r.data);
    if (v.ok) {
      eligibleForDupCheck.push({ id: r.id, data: r.data });
      continue;
    }
    // Pflichtfeld fehlt ODER URL kaputt → kein Worker-Job.
    const status =
      v.issues.includes("invalid_url")
        ? "url_dead"
        : "missing_field";
    updates.push({
      leadId: r.id,
      status,
      errorMessage: v.issues.join(", "),
    });
  }

  // 3) Duplikat-Detection auf den verbliebenen Leads.
  // `Array.from(map.entries())` statt `for…of map` — tsconfig hat kein
  // target, fällt also auf ES5 zurück (kein nativer Map-Iterator).
  const dupes = findDuplicates(eligibleForDupCheck);
  const dupIds = new Set<string>();
  for (const [dupId, originalId] of Array.from(dupes.entries())) {
    dupIds.add(dupId);
    updates.push({
      leadId: dupId,
      status: "duplicate",
      duplicateOfLeadId: originalId,
    });
  }

  // 4) Disqualifizierte Leads in einem Transaktions-Schreiben markieren.
  if (updates.length > 0) {
    await bulkSetPreflightStatus(updates);
  }

  // 5) Verbleibende Leads enqueuen. Stale-Job-Purge zuerst.
  const queueable = eligibleForDupCheck
    .filter((r) => !dupIds.has(r.id))
    .map((r) => r.id);

  if (queueable.length > 0) {
    const queue = preflightQueue();
    await Promise.all(
      queueable.map((id) => queue.remove(id).catch(() => undefined)),
    );
    await queue.addBulk(
      queueable.map((leadId) => ({
        name: "lead-preflight",
        data: { leadId, runId, userId, campaignId },
        opts: { jobId: leadId },
      })),
    );
  }

  return {
    totalLeads: total,
    queuedForPreflight: queueable.length,
    alreadyDisqualified: updates.length,
  };
}

// ───────────────────────────────────────────────────────────────────────────
// ── Phase 2: enqueueApprovedLeadsForPhase2() ──────────────────────────────
// ───────────────────────────────────────────────────────────────────────────

export interface EnqueueApprovedResult {
  /**
   * Anzahl Leads, die wirklich in `lead-pipeline` enqueued wurden.
   * Bei `false` wurde die Status-Transition nicht durchgeführt (z.B. weil
   * der Run schon in `generating`/`completed` war) — der Caller sollte das
   * als Erfolgsfall behandeln (idempotent).
   */
  queued: number;
  /** True, wenn der Run-Status `approved → generating` durchgeführt wurde. */
  transitioned: boolean;
  /** Lokaler Campaign-Identifier — auch nützlich für Logs / Audit. */
  campaignId: string | null;
}

/**
 * Wird von Agent 1's `/api/runs/[id]/preflight/approve/route.ts` aufgerufen,
 * NACHDEM Agent 1 `runs.status` auf `'approved'` gesetzt hat. Wir machen
 * dann den nächsten Schritt: `approved → generating` + Phase-2-Enqueue.
 *
 * Vertrag mit Agent 1
 * ────────────────────
 *   const result = await enqueueApprovedLeadsForPhase2(runId, userId);
 *   return NextResponse.json({ ok: true, queued: result.queued });
 *
 * Idempotenz: das Set-Update auf `runs.status='generating'` läuft mit einer
 * `WHERE status='approved'`-Bedingung. Mehrfach-Aufrufe sind dadurch sicher
 * (nur der erste Caller "gewinnt" und enqueued). Bei späteren Aufrufen
 * findet der Caller den Run bereits in `generating`/`completed` und macht
 * nichts mehr.
 *
 * Stale-Job-Purge wie überall: `queue.remove(jobId)` VOR `addBulk`.
 */
export async function enqueueApprovedLeadsForPhase2(
  runId: string,
  userId: string,
): Promise<EnqueueApprovedResult> {
  // 1) Lade alle approved + nicht-removed Leads des Runs, plus campaignId.
  const rows = await db
    .select({
      leadId: leads.id,
      campaignId: runs.campaignId,
    })
    .from(leads)
    .innerJoin(runs, eq(runs.id, leads.runId))
    .where(
      and(
        eq(leads.runId, runId),
        eq(runs.userId, userId),
        sql`${leads.approvedAt} IS NOT NULL`,
        isNull(leads.removedAt),
      ),
    );

  if (rows.length === 0) {
    // Nichts approved → nichts zu tun. KEIN Run-Status-Übergang, weil der
    // User die Approval revertet haben könnte.
    return { queued: 0, transitioned: false, campaignId: null };
  }

  const campaignId = rows[0].campaignId;
  const leadIds = rows.map((r) => r.leadId);

  // 2) Status-Transition `approved → generating`. Idempotenz: WHERE auf alten
  //    Status filtert Doppel-Calls atomar aus.
  const transitioned = await db
    .update(runs)
    .set({ status: "generating", startedAt: new Date() })
    .where(
      and(
        eq(runs.id, runId),
        eq(runs.userId, userId),
        eq(runs.status, "approved"),
      ),
    )
    .returning({ id: runs.id });

  // Auch wenn der Run nicht (mehr) `approved` ist (Race: zweiter Klick) kann
  // es sein, dass jemand schon enqueued hat. Wir geben dann queued=0 zurück.
  if (transitioned.length === 0) {
    return { queued: 0, transitioned: false, campaignId };
  }

  // 3) Stale-Job-Purge + bulk-add in pipeline-queue. Ein Retry nach kurzem
  //    Delay: mit `enableOfflineQueue: false` schlägt der allererste Redis-
  //    Befehl nach einem frischen Prozess-Boot fehl, solange die Verbindung
  //    noch im Aufbau ist — der zweite Versuch sitzt dann. Wirft erst nach
  //    dem zweiten Fehlschlag; der Run bleibt in `generating` und wird vom
  //    Orphaned-Pending-Recovery im Worker aufgesammelt.
  const queue = pipelineQueueLocal();
  const purgeAndAdd = async (): Promise<void> => {
    await Promise.all(
      leadIds.map((id) => queue.remove(id).catch(() => undefined)),
    );
    await queue.addBulk(
      leadIds.map((leadId) => ({
        name: "lead-pipeline",
        data: { leadId, runId, userId, campaignId },
        opts: { jobId: leadId },
      })),
    );
  };
  try {
    await purgeAndAdd();
  } catch {
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    await purgeAndAdd();
  }

  return { queued: leadIds.length, transitioned: true, campaignId };
}

// ───────────────────────────────────────────────────────────────────────────
// ── Recovery-Helper: für den Worker-Stuck-Recovery-Pass ───────────────────
// ───────────────────────────────────────────────────────────────────────────

/**
 * Enqueued eine Liste von Lead-IDs in die `lead-preflight`-Queue. Wird vom
 * Worker's `stuckLeadRecovery()` aufgerufen, um pending/stuck Preflight-
 * Leads zu requeuen. Stale-Job-Purge ist inkludiert.
 *
 * Idempotenz: jobId = leadId, plus expliziter `remove()`-Call vor dem
 * `addBulk()` — gleiche Logik wie im Pipeline-Recovery.
 */
export async function requeuePreflightLeads(
  payloads: Array<PreflightJobData>,
): Promise<void> {
  if (payloads.length === 0) return;
  const queue = preflightQueue();
  await Promise.all(
    payloads.map((p) => queue.remove(p.leadId).catch(() => undefined)),
  );
  await queue.addBulk(
    payloads.map((p) => ({
      name: "lead-preflight",
      data: p,
      opts: { jobId: p.leadId },
    })),
  );
}

/**
 * Schließt die im Modul gehaltenen Queue-Instanzen + die Redis-Verbindung.
 * Wird nur von Tests / Graceful-Shutdown gebraucht. In Next.js-Requests
 * NICHT aufrufen — die Verbindungen sind für die Lebenszeit des Prozesses
 * gedacht.
 */
export async function closePreflightEnqueueModule(): Promise<void> {
  try {
    if (_preflightQueue) await _preflightQueue.close();
  } catch {
    /* ignore */
  }
  try {
    if (_pipelineQueueForApproval) await _pipelineQueueForApproval.close();
  } catch {
    /* ignore */
  }
  try {
    if (_redisConnection) await _redisConnection.quit();
  } catch {
    /* ignore */
  }
  _preflightQueue = null;
  _pipelineQueueForApproval = null;
  _redisConnection = null;
}
