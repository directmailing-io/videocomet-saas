/**
 * Intro-Staging-Processor (Queue `intro-generation`).
 *
 * Erzeugt die personalisierte Video-Begrüßung für EINEN Lead VOR dem
 * eigentlichen Render — früher lief das inline in Stage 0 der Render-
 * Pipeline, wo bis zu 16 parallele Render-Jobs um 3 sync.so-Slots
 * konkurrierten und nach >8 min stillschweigend aufs Original-Video
 * zurückfielen. Jetzt:
 *
 *   1. Idempotenz-Check: terminaler introStatus → nur noch Render enqueuen.
 *   2. Run-Guard: paused/cancelled/terminale Runs → Abbruch ohne Render.
 *   3. introStatus='generating' + introAttempts++ (Watchdog liest beides).
 *   4. Voice/Kalibrierung nicht bereit → 'disabled' → Render.
 *      Namensdaten unbrauchbar → 'fallback_name' → Render.
 *   5. Engine-Lauf. Erfolg → Upload nach Bunny + `intro_result` persistiert
 *      + 'generated' → Render. Die Render-Pipeline lädt das fertige Video
 *      nur noch herunter (Stage 0 neu: fetchIntroSegment).
 *   6. Fehler: retryable (Fish 429/5xx, sync.so-Concurrency) → BullMQ-Retry
 *      mit Backoff (4 Attempts). Finaler Fehlschlag → 'fallback_error'
 *      + EXPLIZITES pipeline_event + Notbremse-Check → Render (außer der
 *      Run wurde gerade pausiert).
 *
 * Notbremse: liegt die fallback_error-Quote des Runs über dem Schwellwert
 * (INTRO_FALLBACK_ALERT_THRESHOLD, default 10 %) bei mindestens
 * INTRO_FALLBACK_ALERT_MIN_LEADS (default 10) Leads, wird der Run atomar
 * `generating → paused` gesetzt statt still dutzende Leads ohne Intro
 * auszuspielen. Fortsetzen via POST /api/runs/[id]/resume.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { eq, sql } from "drizzle-orm";
import { DelayedError, type Job } from "bullmq";
import { db } from "@/lib/db";
import {
  campaigns,
  introCalibrations,
  leads,
  mediaItems,
  runs,
  voiceProfiles,
  type LeadIntroResult,
} from "@/lib/db/schema";
import { updateLeadStatus } from "@/lib/db/queries/leads";
import { insertPipelineEvent } from "@/lib/db/queries/pipeline-events";
import { uploadIntroFile } from "@/lib/bunny/intro-storage";
import { resolveIntroSubstitutions } from "@/lib/intro-name-check";
import { DEFAULT_TTS_TEMPLATE } from "@/lib/intro";
import { generatePersonalizedWebcam } from "../lib/intro-engine";
import {
  claimIntroCache,
  computeIntroCacheKey,
  markIntroCacheReady,
  releaseIntroCacheClaim,
} from "../lib/intro-dedup";
import { recordIntroDuration } from "../lib/run-eta";
import {
  countUserRenderBacklog,
  fairLeadPriority,
} from "@/lib/queue-fairness";
import { createTempDir, cleanupTempDir } from "../lib/temp";
import { pipelineQueue } from "../queue";
import type { IntroGenerationJobData } from "../intro-queue";
import type { LeadJobData } from "../types";

/**
 * Hartes Zeitbudget für EINEN Engine-Durchlauf: TTS + EQ + Segment-Encode +
 * sync.so-Polling (bis 6 min) + Assembly. Deutlich unter der Worker-Lock-
 * Duration (15 min), damit ein Timeout sauber als Job-Fehler landet statt
 * als stalled Job.
 */
const INTRO_ENGINE_TIMEOUT_MS = 480_000;

function envNum(name: string, fallback: number): number {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

/** Notbremse: Quote fallback_error / lebende Leads über diesem Wert → pause. */
const FALLBACK_ALERT_THRESHOLD = envNum("INTRO_FALLBACK_ALERT_THRESHOLD", 0.1);
/** Notbremse greift erst ab dieser Run-Größe (kleine Runs = zu volatil). */
const FALLBACK_ALERT_MIN_LEADS = envNum("INTRO_FALLBACK_ALERT_MIN_LEADS", 10);

/** Terminale Intro-Stati: Staging ist entschieden, nur noch Render nötig. */
const TERMINAL_INTRO_STATUSES = new Set([
  "generated",
  "fallback_name",
  "fallback_error",
  "disabled",
]);

async function withTimeout<T>(
  fn: () => Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      fn(),
      new Promise<T>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`[intro-generation:${label}] timed out after ${ms}ms`)),
          ms,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Enqueued den Render-Job für EINEN Lead (jobId = leadId, Purge-before-Add
 * wie überall — BullMQ dedupt sonst gegen completed/failed Sets).
 */
async function enqueueRenderJob(data: LeadJobData): Promise<void> {
  const queue = pipelineQueue();
  try {
    await queue.remove(data.leadId);
  } catch {
    // Aktiver Job lässt sich nicht entfernen — Dedup greift, kein Doppel.
  }
  // Fairness: Zeilen-Reihenfolge + User-Backlog-Offset (Phase 1) — der
  // Count läuft pro Lead frisch und ist damit adaptiv zum aktuellen Stand.
  const [row] = await db
    .select({ rowIndex: leads.rowIndex })
    .from(leads)
    .where(eq(leads.id, data.leadId))
    .limit(1);
  const userBacklog = await countUserRenderBacklog(data.userId, data.runId);
  await queue.add("lead-pipeline", data, {
    jobId: data.leadId,
    priority: fairLeadPriority(row?.rowIndex, userBacklog),
  });
}

/**
 * Notbremse-Check. Liefert `true`, wenn der Run soeben pausiert wurde
 * (dann KEIN Render-Enqueue mehr für diesen Lead). Atomar über
 * `WHERE status='generating'` — nur ein Konkurrent gewinnt und schreibt
 * das pipeline_event.
 */
export async function checkEmergencyBrake(runId: string): Promise<boolean> {
  const rows = (await db.execute(sql`
    SELECT
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE ${leads.introStatus} = 'fallback_error')::int AS failed
    FROM ${leads}
    WHERE ${leads.runId} = ${runId}
      AND ${leads.removedAt} IS NULL
  `)) as unknown as Array<{ total: number; failed: number }>;
  const r = Array.isArray(rows)
    ? rows[0]
    : (rows as { rows?: Array<{ total: number; failed: number }> }).rows?.[0];
  const total = Number(r?.total ?? 0);
  const failed = Number(r?.failed ?? 0);
  if (total < FALLBACK_ALERT_MIN_LEADS) return false;
  if (failed / total <= FALLBACK_ALERT_THRESHOLD) return false;

  const paused = await db
    .update(runs)
    .set({ status: "paused" })
    .where(sql`${runs.id} = ${runId} AND ${runs.status} = 'generating'`)
    .returning({ id: runs.id });
  if (paused.length === 0) {
    // Schon pausiert (oder Run nicht mehr generating) — Konkurrent war
    // schneller. Trotzdem true zurückgeben, wenn der Run jetzt paused ist,
    // damit wir keinen Render mehr enqueuen.
    const [cur] = await db
      .select({ status: runs.status })
      .from(runs)
      .where(eq(runs.id, runId))
      .limit(1);
    return cur?.status === "paused";
  }
  await insertPipelineEvent({
    runId,
    level: "error",
    stage: "render",
    message:
      `Zu viele personalisierte Begrüßungen fehlgeschlagen (${failed} von ${total}) — ` +
      `der Lauf wurde angehalten. Bitte prüfen und über „Fortsetzen" wieder starten.`,
  }).catch(() => undefined);
  console.warn(
    `[intro-generation] emergency brake: run=${runId} paused (${failed}/${total} fallback_error)`,
  );
  return true;
}

/**
 * Terminaler Fallback: introStatus setzen, Event schreiben, Notbremse
 * prüfen und (wenn der Run weiterläuft) den Render-Job enqueuen.
 */
async function finishWithFallback(opts: {
  jobData: LeadJobData;
  introStatus: "fallback_name" | "fallback_error" | "disabled";
  message: string;
  level?: "info" | "warn";
  durationMs?: number;
}): Promise<void> {
  await updateLeadStatus(opts.jobData.leadId, {
    introStatus: opts.introStatus,
    introResult: null,
  });
  await insertPipelineEvent({
    runId: opts.jobData.runId,
    leadId: opts.jobData.leadId,
    level: opts.level ?? "warn",
    stage: "render",
    message: opts.message,
    durationMs: opts.durationMs,
  }).catch(() => undefined);

  // Notbremse nur für echte Fehler-Fallbacks — fehlende Namen ('fallback_
  // name') und deaktivierte Intros sind erwartbares Verhalten, kein Incident.
  if (opts.introStatus === "fallback_error") {
    const pausedNow = await checkEmergencyBrake(opts.jobData.runId);
    if (pausedNow) return;
  }
  // Run könnte parallel pausiert/abgebrochen worden sein (Notbremse eines
  // anderen Leads, User-Cancel) — dann keinen Render mehr enqueuen; der
  // Resume-Endpoint reiht die Leads neu ein.
  const [curRun] = await db
    .select({ status: runs.status })
    .from(runs)
    .where(eq(runs.id, opts.jobData.runId))
    .limit(1);
  if (curRun?.status !== "generating") return;
  await enqueueRenderJob(opts.jobData);
}

export async function introGenerationProcessor(
  job: Job<IntroGenerationJobData>,
  token?: string,
): Promise<Record<string, unknown>> {
  const { leadId, runId } = job.data;

  const [lead] = await db.select().from(leads).where(eq(leads.id, leadId)).limit(1);
  if (!lead) throw new Error(`[intro-generation] missing lead=${leadId}`);
  const [run] = await db.select().from(runs).where(eq(runs.id, runId)).limit(1);
  if (!run) throw new Error(`[intro-generation] missing run=${runId}`);
  const [campaign] = await db
    .select()
    .from(campaigns)
    .where(eq(campaigns.id, run.campaignId))
    .limit(1);
  if (!campaign) {
    throw new Error(`[intro-generation] missing campaign for run=${runId}`);
  }

  const jobData: LeadJobData = {
    leadId,
    runId,
    userId: run.userId,
    campaignId: campaign.id,
  };
  const leadLabel = `Lead ${lead.rowIndex + 1}`;

  // ── Guards ────────────────────────────────────────────────────────────
  // Entfernte/fertige Leads brauchen weder Staging noch Render.
  if (lead.removedAt || lead.status === "completed") {
    return { skipped: "lead terminal/removed" };
  }
  // Run-Status: bei paused/cancelled/terminal NICHT weiterarbeiten. Der
  // Resume-Endpoint enqueued die queued-Leads neu.
  if (run.status !== "generating") {
    console.log(
      `[intro-generation] run=${runId} status=${run.status} — job abgebrochen (lead=${leadId})`,
    );
    return { skipped: `run status ${run.status}` };
  }
  // Idempotenz: terminaler introStatus (z.B. Watchdog-Doppel-Enqueue oder
  // Retry nach Teil-Erfolg) → nur noch sicherstellen, dass der Render läuft.
  if (
    lead.introStatus &&
    TERMINAL_INTRO_STATUSES.has(lead.introStatus) &&
    // 'generated' ohne persistiertes Ergebnis ist NICHT terminal — das
    // ist ein Alt-Lead aus der Inline-Ära (Regenerate-Pfad) und muss
    // neu gestaged werden.
    (lead.introStatus !== "generated" || lead.introResult)
  ) {
    await enqueueRenderJob(jobData);
    return { skipped: `introStatus ${lead.introStatus}`, renderEnqueued: true };
  }
  // Bereits persistiertes Ergebnis (Retry nach Teil-Erfolg, Race mit einem
  // Doppel-Enqueue) → nicht neu generieren, nur den Render sicherstellen.
  if (lead.introResult) {
    await enqueueRenderJob(jobData);
    return { skipped: "introResult exists", renderEnqueued: true };
  }
  // Intro global deaktiviert (Kampagne umkonfiguriert nach Enqueue).
  if (!campaign.introEnabled) {
    await updateLeadStatus(leadId, { introStatus: "disabled", introResult: null });
    await enqueueRenderJob(jobData);
    return { skipped: "intro disabled", renderEnqueued: true };
  }

  // Status/Versuchszähler werden erst NACH dem Dedup-Claim gesetzt (nur im
  // generate-Zweig) — Warte-Zyklen auf einen fremden Generator dürfen weder
  // introAttempts verbrennen noch den generating-Watchdog scharf stellen.
  const startedAt = Date.now();
  const willRetry = job.attemptsMade + 1 < (job.opts.attempts ?? 1);
  // Gesetzt, sobald DIESER Job den Dedup-Claim hält — Fehlerpfade geben ihn
  // frei, damit wartende Jobs mit gleicher Anrede nicht 12 min hängen.
  let ownedCacheKey: string | null = null;

  try {
    // ── Voraussetzungen: Voice-Profil + Kalibrierung ────────────────────
    const [voiceProfile] = await db
      .select()
      .from(voiceProfiles)
      .where(eq(voiceProfiles.userId, run.userId))
      .limit(1);
    const [calibration] = campaign.webcamMediaId
      ? await db
          .select()
          .from(introCalibrations)
          .where(eq(introCalibrations.mediaItemId, campaign.webcamMediaId))
          .limit(1)
      : [];

    // Kampagnen-Stimme (aus dem Webcam-Video trainiert) bevorzugen;
    // Account-Profil nur als Fallback (z.B. Video-Ton < 30s).
    const introFishModelId =
      calibration?.voiceStatus === "ready" && calibration.voiceFishModelId
        ? calibration.voiceFishModelId
        : voiceProfile?.status === "ready"
          ? voiceProfile.fishModelId
          : null;

    if (!introFishModelId || calibration?.status !== "ready") {
      await finishWithFallback({
        jobData,
        introStatus: "disabled",
        message: `${leadLabel}: Intro übersprungen — Voice-Profil oder Webcam-Kalibrierung nicht bereit; Original-Video wird verwendet`,
      });
      return { introStatus: "disabled" };
    }

    // ── Namens-Substitution ─────────────────────────────────────────────
    const template = calibration.ttsTemplate?.trim() || DEFAULT_TTS_TEMPLATE;
    const substResult = resolveIntroSubstitutions(
      template,
      (lead.data ?? {}) as Record<string, string>,
    );
    if (!substResult.ok) {
      await finishWithFallback({
        jobData,
        introStatus: "fallback_name",
        level: "info",
        message: `${leadLabel}: Intro-Fallback — Namensdaten nicht brauchbar (${substResult.reason}); Original-Video wird verwendet`,
      });
      return { introStatus: "fallback_name" };
    }

    // ── Anrede-Dedup (W4) ───────────────────────────────────────────────
    // Gleicher aufgelöster TTS-Text + Stimme + Webcam + Kalibrierungs-Stand
    // → Begrüßung nur einmal generieren (TTS + sync.so kosten pro Lauf).
    // Text-Auflösung identisch zur Engine (intro-engine.ts, Schritt 1).
    if (!campaign.webcamMediaId) {
      throw new Error("campaign has no webcam media for intro staging");
    }
    let ttsText = template;
    for (const [key, value] of Object.entries(substResult.substitutions)) {
      ttsText = ttsText.replaceAll(`{${key}}`, value.trim());
    }
    const introDisplayName =
      substResult.substitutions.vorname ??
      [substResult.substitutions.anrede, substResult.substitutions.nachname]
        .filter(Boolean)
        .join(" ");
    const cacheKey = computeIntroCacheKey({
      ttsText: ttsText.trim(),
      fishModelId: introFishModelId,
      webcamMediaId: campaign.webcamMediaId,
      calibrationUpdatedAt: calibration.updatedAt,
    });
    const claim = await claimIntroCache(run.userId, cacheKey);

    if (claim.role === "hit") {
      const introResult: LeadIntroResult = {
        ...claim.result,
        firstName: introDisplayName,
      };
      await updateLeadStatus(leadId, {
        introStatus: "generated",
        introResult,
      });
      await insertPipelineEvent({
        runId,
        leadId,
        level: "info",
        stage: "render",
        message: `${leadLabel}: personalisierte Begrüßung ("${introDisplayName}") wiederverwendet — identische Anrede bereits generiert`,
      }).catch(() => undefined);
      const [curRun] = await db
        .select({ status: runs.status })
        .from(runs)
        .where(eq(runs.id, runId))
        .limit(1);
      if (curRun?.status === "generating") {
        await enqueueRenderJob(jobData);
      }
      return { introStatus: "generated", reused: true };
    }

    if (claim.role === "wait") {
      // Ein anderer Job generiert dieselbe Begrüßung gerade. Job verzögern
      // statt Slot blockieren; DelayedError verbraucht KEINEN BullMQ-Attempt.
      // Lead bleibt 'queued' — Watchdog (B) re-enqueued zur Not, was nur
      // einen weiteren Claim-Check bedeutet.
      await job.moveToDelayed(Date.now() + 30_000, token);
      throw new DelayedError();
    }

    // claim.role === 'generate': ab hier sind wir Cache-Owner.
    ownedCacheKey = cacheKey;

    // ── Staging beginnt: Status + Versuchszähler ────────────────────────
    // `startedAt` dient dem Intro-Watchdog als Zeitanker (generating >20 min
    // → Recovery). Die Render-Pipeline überschreibt es beim Render-Start.
    await updateLeadStatus(leadId, {
      introStatus: "generating",
      introAttempts: (lead.introAttempts ?? 0) + 1,
      startedAt: new Date(),
    });

    // ── Webcam-Quelle lokal materialisieren ─────────────────────────────
    const [webcam] = await db
      .select()
      .from(mediaItems)
      .where(eq(mediaItems.id, campaign.webcamMediaId))
      .limit(1);
    if (!webcam?.publicUrl) {
      throw new Error("webcam media has no public URL for intro staging");
    }

    const workDir = await createTempDir(`intro-${leadId.slice(0, 8)}`);
    try {
      const introDir = join(workDir, "intro");
      await mkdir(introDir, { recursive: true });
      const introWebcamPath = join(introDir, "webcam-src.mp4");
      // Referer mitschicken — Bunny-CDN-Hotlink-Protection blockt sonst
      // (gleiche Header wie fetchToFile in video-render.ts).
      const introReferer = process.env.APP_URL ?? "https://app.videocomet.de";
      const webcamRes = await fetch(webcam.publicUrl, {
        headers: {
          Referer: introReferer,
          Origin: introReferer,
          "User-Agent": "videocomet-worker/1.0",
        },
      });
      if (!webcamRes.ok) {
        throw new Error(`webcam download HTTP ${webcamRes.status} for intro staging`);
      }
      await writeFile(introWebcamPath, Buffer.from(await webcamRes.arrayBuffer()));

      // ── Engine-Lauf (retryable Fehler werfen bis hier hoch) ───────────
      const result = await withTimeout(
        () =>
          generatePersonalizedWebcam({
            userId: run.userId,
            tag: leadId.slice(0, 8),
            substitutions: substResult.substitutions,
            calibration,
            fishModelId: introFishModelId,
            webcamLocalPath: introWebcamPath,
            workDir: introDir,
          }),
        INTRO_ENGINE_TIMEOUT_MS,
        leadId.slice(0, 8),
      );

      const introMs = Date.now() - startedAt;

      if (!result.ok) {
        // Dauerhafter Quality-/Engine-Fallback (QA-Gate, Fish-Definitiv-
        // Fehler…) — kein Retry, explizit ausweisen.
        await releaseIntroCacheClaim(run.userId, cacheKey).catch(() => undefined);
        ownedCacheKey = null;
        await finishWithFallback({
          jobData,
          introStatus: "fallback_error",
          message: `${leadLabel}: Intro-Fallback — ${result.reason.slice(0, 300)}; Original-Video wird verwendet`,
          durationMs: introMs,
        });
        return { introStatus: "fallback_error", reason: result.reason.slice(0, 300) };
      }

      // ── Erfolg: fertiges Video nach Bunny, Ergebnis persistieren ──────
      const buffer = await readFile(result.outputPath);
      const uploaded = await uploadIntroFile({
        userId: run.userId,
        // Nonce im Dateinamen: bei Re-Generierung (Regenerate-Pfad) darf
        // der Bunny-CDN-Cache nicht die alte Datei unter gleicher URL
        // ausliefern — jede Generierung bekommt eine eindeutige URL.
        fileName: `staged/${runId}/${leadId}-${Date.now()}.mp4`,
        buffer,
        contentType: "video/mp4",
      });
      const introResult: LeadIntroResult = {
        url: uploaded.url,
        startTrimMs: result.startTrimMs,
        firstName: introDisplayName,
        generatedAt: new Date().toISOString(),
      };
      await updateLeadStatus(leadId, {
        introStatus: "generated",
        introResult,
      });
      // Dedup-Cache füllen — wartende Jobs mit gleicher Anrede übernehmen
      // das Ergebnis beim nächsten Delay-Tick.
      await markIntroCacheReady(run.userId, cacheKey, introResult).catch(
        () => undefined,
      );
      ownedCacheKey = null;
      await insertPipelineEvent({
        runId,
        leadId,
        level: "info",
        stage: "render",
        message: `${leadLabel}: personalisierte Begrüßung ("${introDisplayName}") in ${(introMs / 1000).toFixed(1)}s erzeugt`,
        durationMs: introMs,
      }).catch(() => undefined);
      await recordIntroDuration(introMs).catch(() => undefined);

      // Notbremse könnte durch PARALLELE Fehlschläge gerade gezogen worden
      // sein — Render nur enqueuen, wenn der Run noch läuft.
      const [curRun] = await db
        .select({ status: runs.status })
        .from(runs)
        .where(eq(runs.id, runId))
        .limit(1);
      if (curRun?.status === "generating") {
        await enqueueRenderJob(jobData);
      }
      return { introStatus: "generated", url: uploaded.url };
    } finally {
      await cleanupTempDir(workDir);
    }
  } catch (err) {
    // moveToDelayed-Pfad (Dedup-Wartende) — kein Fehler, direkt durchreichen.
    if (err instanceof DelayedError) throw err;
    if (ownedCacheKey) {
      await releaseIntroCacheClaim(run.userId, ownedCacheKey).catch(
        () => undefined,
      );
      ownedCacheKey = null;
    }
    const message = err instanceof Error ? err.message : String(err);
    if (willRetry) {
      // BullMQ retryt mit exponentiellem Backoff (30 s ×2) — Status bleibt
      // 'generating'; der Watchdog fängt verlorene Jobs zusätzlich ab.
      await insertPipelineEvent({
        runId,
        leadId,
        level: "warn",
        stage: "render",
        message: `${leadLabel}: Intro-Fehler — wird automatisch wiederholt (Versuch ${job.attemptsMade + 1}): ${message.slice(0, 200)}`,
        durationMs: Date.now() - startedAt,
      }).catch(() => undefined);
      throw err;
    }
    // Letzter Versuch fehlgeschlagen → expliziter Fallback + Notbremse.
    await finishWithFallback({
      jobData,
      introStatus: "fallback_error",
      message: `${leadLabel}: Intro-Fallback — ${message.slice(0, 300)}; Original-Video wird verwendet`,
      durationMs: Date.now() - startedAt,
    }).catch(async (fallbackErr) => {
      console.error(
        `[intro-generation] fallback persist failed for lead=${leadId}:`,
        fallbackErr instanceof Error ? fallbackErr.message : fallbackErr,
      );
      throw err;
    });
    return { introStatus: "fallback_error", reason: message.slice(0, 300) };
  }
}
