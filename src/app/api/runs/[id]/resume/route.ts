export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { and, eq, isNull, sql } from "drizzle-orm";
import { validateRequest } from "@/lib/auth";
import { db } from "@/lib/db";
import { leads, runs } from "@/lib/db/schema";
import { insertPipelineEvent } from "@/lib/db/queries/pipeline-events";
import { finalizeRunIfAllLeadsDone } from "@/lib/db/queries/runs";
import { enqueueLeadsForIntroStaging } from "@/lib/preflight/job-enqueue";
import { leadJobPriority } from "@/lib/queue-priority";
import { Queue, type ConnectionOptions } from "bullmq";
import IORedis from "ioredis";

/**
 * POST /api/runs/[id]/resume
 *
 * Setzt einen durch die Intro-Notbremse pausierten Run fort
 * (`paused → generating`, atomar via WHERE-Guard) und stößt die
 * hängengebliebenen Leads wieder an:
 *
 *   - pending-Leads mit introStatus queued/generating (oder ohne
 *     terminalen Intro-Status) → zurück in die `intro-generation`-Queue.
 *   - pending-Leads mit terminalem Intro-Status (generated, fallback_name,
 *     fallback_error, disabled) → direkt in die `lead-pipeline` (schneller
 *     als auf den
 *     2-Minuten-Orphan-Watchdog im Worker zu warten).
 *
 * Body (optional): { continueWithoutIntro: true } — explizites Opt-out für
 * Runden mit verbindlicher KI-Begrüßung (runs.introExpected=true): setzt
 * introExpected=false im selben atomaren Update, damit Leads mit
 * fehlgeschlagener Begrüßung (fallback_error/disabled) NICHT im Stage-0-
 * Fail-Fast bzw. Completeness-Gate landen, sondern bewusst mit dem
 * Original-Video produziert werden. Ohne das Flag bleibt die Erwartung
 * bestehen (fail-loud).
 *
 * Idempotenz: nur der erste Aufruf gewinnt die Status-Transition; spätere
 * Aufrufe liefern 409 mit dem aktuellen Status.
 */

// Lokale lead-pipeline-Queue (gleiche Begründung wie in
// `src/lib/preflight/job-enqueue.ts`: kein Import aus dem worker-tree).
const PIPELINE_QUEUE_NAME = "lead-pipeline";

let _redis: IORedis | null = null;
let _pipelineQueue: Queue<{
  leadId: string;
  runId: string;
  userId: string;
  campaignId: string;
}> | null = null;

function pipelineQueueLocal() {
  if (_pipelineQueue) return _pipelineQueue;
  const url = process.env.REDIS_URL;
  if (!url) throw new Error("[runs:resume] REDIS_URL is required");
  _redis = new IORedis(url, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    connectTimeout: 10_000,
    enableOfflineQueue: false,
  });
  _redis.on("error", (err) => {
    // eslint-disable-next-line no-console
    console.error("[runs:resume:redis] error:", err.message);
  });
  _pipelineQueue = new Queue(PIPELINE_QUEUE_NAME, {
    connection: _redis as unknown as ConnectionOptions,
    defaultJobOptions: {
      attempts: 2,
      backoff: { type: "exponential", delay: 5_000 },
      removeOnComplete: 100,
      removeOnFail: 500,
    },
  });
  return _pipelineQueue;
}

export async function POST(
  req: Request,
  { params }: { params: { id: string } },
) {
  let continueWithoutIntro = false;
  try {
    const body = (await req.json()) as { continueWithoutIntro?: unknown };
    continueWithoutIntro = body?.continueWithoutIntro === true;
  } catch {
    // kein/ungültiger Body → Default-Verhalten
  }
  // requireUserApi bewusst NICHT verwendet — das sperrt Admins aus (403 bei
  // role !== 'user'), Admins sollen fremde Runs aber fortsetzen dürfen.
  const { user } = await validateRequest();
  if (!user) {
    return NextResponse.json(
      { error: "Nicht angemeldet.", details: null },
      { status: 401 },
    );
  }
  const runId = params.id;
  const isAdmin = user.role === "admin";
  // Tenant-Guard nur für normale User; Admin darf jeden Run fortsetzen.
  const ownerFilter = isAdmin ? sql`TRUE` : eq(runs.userId, user.id);

  // 1) Atomare Transition paused → generating.
  const [resumed] = await db
    .update(runs)
    .set({
      status: "generating",
      ...(continueWithoutIntro ? { introExpected: false } : {}),
    })
    .where(
      and(
        eq(runs.id, runId),
        ownerFilter,
        isNull(runs.deletedAt),
        eq(runs.status, "paused"),
      ),
    )
    .returning({
      id: runs.id,
      campaignId: runs.campaignId,
      // Run-OWNER — Job-Data braucht die Tenant-ID des Runs, nicht die des
      // (evtl. Admin-)Aufrufers.
      userId: runs.userId,
    });

  if (!resumed) {
    const [cur] = await db
      .select({ status: runs.status })
      .from(runs)
      .where(and(eq(runs.id, runId), ownerFilter, isNull(runs.deletedAt)))
      .limit(1);
    if (!cur) {
      return NextResponse.json(
        { error: "Run nicht gefunden.", details: null },
        { status: 404 },
      );
    }
    return NextResponse.json(
      {
        error: "Nur angehaltene Läufe können fortgesetzt werden.",
        details: `current_status=${cur.status}`,
      },
      { status: 409 },
    );
  }

  // 2) Hängende Leads einsammeln (nur pending + nicht-removed).
  const pendingLeads = await db
    .select({
      id: leads.id,
      introStatus: leads.introStatus,
      introResult: leads.introResult,
      rowIndex: leads.rowIndex,
    })
    .from(leads)
    .where(
      and(
        eq(leads.runId, runId),
        eq(leads.status, "pending"),
        isNull(leads.removedAt),
        sql`${leads.approvedAt} IS NOT NULL`,
      ),
    );

  const isTerminalIntro = (l: (typeof pendingLeads)[number]): boolean =>
    l.introStatus === "fallback_name" ||
    l.introStatus === "fallback_error" ||
    l.introStatus === "disabled" ||
    (l.introStatus === "generated" && l.introResult != null);

  const stagingIds = pendingLeads.filter((l) => !isTerminalIntro(l)).map((l) => l.id);
  const renderLeads = pendingLeads.filter((l) => isTerminalIntro(l));

  // 3) Re-Enqueue. Fehler sind nicht fatal — der Intro-Watchdog bzw. die
  //    Orphaned-Pending-Recovery im Worker sammeln Reste binnen 2 min ein.
  let stagingQueued = 0;
  let renderQueued = 0;
  try {
    await enqueueLeadsForIntroStaging(stagingIds, runId);
    stagingQueued = stagingIds.length;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[runs:resume] intro staging enqueue failed:", err);
  }
  if (renderLeads.length > 0) {
    try {
      const queue = pipelineQueueLocal();
      await Promise.all(
        renderLeads.map((l) => queue.remove(l.id).catch(() => undefined)),
      );
      await queue.addBulk(
        renderLeads.map((l) => ({
          name: "lead-pipeline",
          data: {
            leadId: l.id,
            runId,
            userId: resumed.userId,
            campaignId: resumed.campaignId,
          },
          opts: { jobId: l.id, priority: leadJobPriority(l.rowIndex) },
        })),
      );
      renderQueued = renderLeads.length;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[runs:resume] render enqueue failed:", err);
    }
  }

  await insertPipelineEvent({
    runId,
    level: "info",
    stage: "run",
    message: continueWithoutIntro
      ? `Lauf fortgesetzt OHNE verbindliche KI-Begrüßung (explizite Nutzer-Entscheidung) — ${stagingQueued} Begrüßungen neu eingereiht, ${renderQueued} Leads direkt zum Render.`
      : `Lauf fortgesetzt — ${stagingQueued} Begrüßungen neu eingereiht, ${renderQueued} Leads direkt zum Render.`,
  }).catch(() => undefined);

  // Edge-Case: alle Leads waren beim Pausieren schon terminal (nichts mehr
  // zu enqueuen) — dann würde der Run sonst ewig in 'generating' hängen.
  await finalizeRunIfAllLeadsDone(runId).catch(() => undefined);

  return NextResponse.json({
    ok: true,
    stagingQueued,
    renderQueued,
  });
}
