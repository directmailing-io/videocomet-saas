import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  analyticsEvents,
  campaigns,
  leadEvents,
  leads,
  pipelineEvents,
  runs,
} from "@/lib/db/schema";
import type { RunAbConfig } from "@/lib/db/schema";
import { enqueueWebhooksForRunFinalized } from "@/lib/webhooks/lead-event-hook";
import { sendRunCompletionNotification } from "@/lib/run-notifications";
import { insertPipelineEvent } from "@/lib/db/queries/pipeline-events";
import { sendOpsAlert } from "@/lib/ops-alert";
import { leadJobPriority } from "@/lib/queue-priority";

/**
 * Erlaubte Run-Status-Übergänge für die Preflight-Pipeline.
 *
 *   draft              → preflighting
 *   preflighting       → awaiting_approval | cancelled
 *   awaiting_approval  → approved | cancelled
 *   approved           → generating | cancelled  (Phase-2-Trigger)
 *   ANY (alive)        → cancelled
 *   failed             → preflighting           (Retry-Pfad)
 *
 * Terminale Stati (completed | failed | cancelled) sind nicht mehr
 * verlassbar, ausser `failed → preflighting` für expliziten User-Retry.
 */
const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  draft: ["preflighting", "cancelled"],
  mapping: ["preflighting", "cancelled"],
  preflighting: ["awaiting_approval", "cancelled", "failed"],
  awaiting_approval: ["approved", "cancelled"],
  approved: ["generating", "cancelled"],
  // paused = Intro-Notbremse (Migration 0048): zu viele fallback_error-Intros
  // → Run hält an. Fortsetzen via POST /api/runs/[id]/resume.
  generating: ["completed", "failed", "cancelled", "paused"],
  paused: ["generating", "cancelled"],
  failed: ["preflighting", "cancelled"],
  completed: [],
  cancelled: [],
};

export type Run = typeof runs.$inferSelect;
export type NewRun = typeof runs.$inferInsert;

export type CreateRunInput = Omit<NewRun, "id" | "userId" | "createdAt">;

export type UpdateRunPatch = Partial<Omit<Run, "id" | "userId" | "createdAt">>;

export async function createRun(userId: string, input: CreateRunInput): Promise<Run> {
  const [row] = await db
    .insert(runs)
    .values({ ...input, userId })
    .returning();
  if (!row) throw new Error("Failed to create run");
  return row;
}

export async function updateRun(
  id: string,
  userId: string,
  patch: UpdateRunPatch,
): Promise<Run> {
  const [row] = await db
    .update(runs)
    .set(patch)
    .where(
      and(eq(runs.id, id), eq(runs.userId, userId), isNull(runs.deletedAt)),
    )
    .returning();
  if (!row) throw new Error("Not found");
  return row;
}

/**
 * Setzt den Run-Status auf "completed", wenn ALLE Leads einen terminalen
 * Status haben (completed oder failed) und der Run noch nicht abgeschlossen
 * ist. Idempotent: mehrere Calls sind sicher (UPDATE-WHERE-Filter blockt
 * Doppel-Schreibungen).
 *
 * Wird vom Worker am Ende jedes Lead-Jobs aufgerufen, weil es im aktuellen
 * Pipeline-Setup keinen separaten "Run-Finalizer"-Job gibt.
 */
export async function finalizeRunIfAllLeadsDone(runId: string): Promise<{
  finalized: boolean;
  total: number;
  done: number;
}> {
  // Soft-deleted Leads (preflight-rejected) zählen NICHT als ausstehend —
  // sonst wartet die Run-Finalisierung ewig auf einen Lead, der die
  // Pipeline gar nicht durchläuft. `removed_at IS NULL` schließt diese
  // Rows aus dem Total raus.
  const rows = (await db.execute(sql`
    SELECT
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE ${leads.status} IN ('completed', 'failed'))::int AS done
    FROM ${leads}
    WHERE ${leads.runId} = ${runId}
      AND ${leads.removedAt} IS NULL
  `)) as unknown as Array<{ total: number; done: number }>;
  const r = Array.isArray(rows) ? rows[0] : (rows as { rows?: Array<{ total: number; done: number }> }).rows?.[0];
  const total = Number(r?.total ?? 0);
  const done = Number(r?.done ?? 0);
  if (total === 0 || done < total) {
    return { finalized: false, total, done };
  }

  // Gate + Auto-Retry laufen nur für aktiv generierende Runs — sonst
  // würde ein später Aufruf (Resume-Route, Nachzügler-Job) Leads einer
  // längst abgeschlossenen Runde erneut einreihen.
  const [runRow] = await db
    .select({
      status: runs.status,
      userId: runs.userId,
      campaignId: runs.campaignId,
      envelopeTemplateId: runs.envelopeTemplateId,
      abConfig: runs.abConfig,
      introExpected: runs.introExpected,
    })
    .from(runs)
    .where(eq(runs.id, runId))
    .limit(1);
  if (runRow?.status === "generating") {
    // ── Run-Completeness-Gate (Reliability 2026-08-20, config-aware
    // seit 2026-08-21) ────────────────────────────────────────────────
    // Safety-Net unter dem per-Lead-Gate in der Pipeline: ein Lead, der
    // "completed" ist, aber einen für SEINE Konfiguration erforderlichen
    // Bestandteil nicht hat, wird hier auf failed gekippt. Ein User darf
    // NIE eine erfolgreiche Runde sehen, in der etwas fehlt. Die
    // Bedingungen spiegeln missingLeadArtifacts (artifact-completeness.ts).
    const [campaignRow] = runRow.campaignId
      ? await db
          .select({
            introEnabled: campaigns.introEnabled,
            envelopeTemplateId: campaigns.envelopeTemplateId,
          })
          .from(campaigns)
          .where(eq(campaigns.id, runRow.campaignId))
          .limit(1)
      : [];
    const introRequired =
      campaignRow?.introEnabled === true && runRow.introExpected === true;
    const envelopeRequired =
      (runRow.envelopeTemplateId ?? campaignRow?.envelopeTemplateId) != null;
    const abRequired = runRow.abConfig != null;

    const incompleteConds = [
      sql`${leads.videoUrl} IS NULL`,
      sql`${leads.slug} IS NULL`,
      // PDF-Pflicht wird hier bewusst NICHT geprüft: die exakte Stage-
      // Bedingung hängt von skipPdf-Flags + pageUrl ab, die nur der
      // Pipeline-Job kennt — das per-Lead-Gate (Stage 9d) deckt sie ab.
      ...(introRequired
        ? [
            sql`(${leads.introStatus} IS NULL OR ${leads.introStatus} NOT IN ('generated', 'fallback_name'))`,
          ]
        : []),
      ...(envelopeRequired ? [sql`${leads.envelopePdfUrl} IS NULL`] : []),
      ...(abRequired
        ? [
            sql`(${leads.abVariant} IS NULL OR ${leads.abVariant} NOT IN ('A', 'B'))`,
          ]
        : []),
    ];
    const flipped = await db
      .update(leads)
      .set({
        status: "failed",
        errorMessage:
          "Automatisch als fehlgeschlagen markiert: Pflicht-Bestandteil fehlt (Video, Landingpage, KI-Begrüßung, Umschlag oder A/B-Variante)",
      })
      .where(
        and(
          eq(leads.runId, runId),
          isNull(leads.removedAt),
          eq(leads.status, "completed"),
          sql.join(
            [sql`(`, sql.join(incompleteConds, sql` OR `), sql`)`],
            sql``,
          ),
        ),
      )
      .returning({ id: leads.id });
    for (const f of flipped) {
      await insertPipelineEvent({
        runId,
        leadId: f.id,
        level: "error",
        stage: "run",
        message:
          "Completeness-Gate: Lead war als erfolgreich markiert, aber ein Pflicht-Bestandteil fehlt (Video, Landingpage, KI-Begrüßung, Umschlag oder A/B-Variante) — auf fehlgeschlagen gesetzt.",
      });
    }

    // ── Auto-Retry fehlgeschlagener Leads (genau 1× pro Lead) ─────────
    // Bevor die Runde mit Fehlschlägen finalisiert wird, bekommt jeder
    // failed Lead EINE automatische Neu-Einreihung (frische 3 BullMQ-
    // Versuche). Idempotenz: pipeline_events-Marker (stage='autoretry',
    // DIREKT und werfend geschrieben — insertPipelineEvent würde Fehler
    // schlucken und den Einmal-Schutz aushebeln). Konfigurationsfehler
    // schlagen im Retry sofort wieder fehl (UnrecoverableError) — dann
    // finalisiert die Runde beim nächsten Aufruf mit Fehlschlägen.
    if (runRow.userId && runRow.campaignId) {
      const retryRows = (await db.execute(sql`
        SELECT ${leads.id} AS id, ${leads.rowIndex} AS row_index
        FROM ${leads}
        WHERE ${leads.runId} = ${runId}
          AND ${leads.removedAt} IS NULL
          AND ${leads.status} = 'failed'
          AND NOT EXISTS (
            SELECT 1 FROM ${pipelineEvents} pe
            WHERE pe.lead_id = ${leads.id} AND pe.stage = 'autoretry'
          )
      `)) as unknown as Array<{ id: string; row_index: number | null }>;
      const retryable = Array.isArray(retryRows)
        ? retryRows
        : ((retryRows as { rows?: Array<{ id: string; row_index: number | null }> })
            .rows ?? []);
      let requeued = 0;
      for (const lead of retryable) {
        try {
          await db.insert(pipelineEvents).values({
            runId,
            leadId: lead.id,
            level: "info",
            stage: "autoretry",
            message:
              "Automatischer Wiederholungsversuch: Lead wird einmalig neu eingereiht, bevor die Runde abgeschlossen wird.",
          });
          await db
            .update(leads)
            .set({ status: "pending", errorMessage: null })
            .where(eq(leads.id, lead.id));
          const { pipelineQueue } = await import("@/worker/queue");
          const queue = pipelineQueue();
          // jobId = leadId wie überall sonst (Recovery-Loops purgen und
          // dedupen über genau diese ID — eine abweichende Autoretry-ID
          // würde bei >2 min Queue-Wartezeit eine Doppel-Pipeline durch
          // die Orphaned-Pending-Recovery erzeugen). Stale-Job vorher
          // entfernen, sonst dedupt BullMQ gegen den alten failed-Job.
          await queue.remove(lead.id).catch(() => undefined);
          await queue.add(
            "lead-pipeline",
            {
              leadId: lead.id,
              runId,
              userId: runRow.userId,
              campaignId: runRow.campaignId,
            },
            {
              jobId: lead.id,
              priority: leadJobPriority(lead.row_index),
            },
          );
          requeued++;
        } catch (err) {
          // Enqueue fehlgeschlagen (Redis?) → Lead bleibt/wird wieder
          // failed, Runde finalisiert mit Fehlschlägen statt zu hängen.
          await db
            .update(leads)
            .set({
              status: "failed",
              errorMessage:
                "Automatischer Wiederholungsversuch konnte nicht eingereiht werden",
            })
            .where(eq(leads.id, lead.id))
            .catch(() => undefined);
          console.warn(
            `[run-finalize] autoretry enqueue failed for lead=${lead.id}:`,
            err instanceof Error ? err.message : err,
          );
        }
      }
      if (requeued > 0) {
        return { finalized: false, total, done: done - requeued };
      }
    }
  }
  // Denormalisierte Counter aus dem aktuellen Lead-Status ableiten und
  // im selben UPDATE mitschreiben — sonst bleiben `completed_leads`/
  // `failed_leads` auf 0, was die UI mit „0 von X fertig" verwirrend
  // anzeigt (Vorfall 2026-08-19: 10 fertige Runs in 24 h wirken kaputt).
  // Backfill für alte Runs siehe drizzle/0055_run_counter_backfill.sql.
  const tally = (await db.execute(sql`
    SELECT
      COUNT(*) FILTER (WHERE ${leads.status} = 'completed')::int AS completed,
      COUNT(*) FILTER (WHERE ${leads.status} = 'failed')::int AS failed
    FROM ${leads}
    WHERE ${leads.runId} = ${runId}
      AND ${leads.removedAt} IS NULL
  `)) as unknown as Array<{ completed: number; failed: number }>;
  const tallyRow = Array.isArray(tally)
    ? tally[0]
    : (tally as { rows?: Array<{ completed: number; failed: number }> }).rows?.[0];
  const completedCount = Number(tallyRow?.completed ?? 0);
  const failedCount = Number(tallyRow?.failed ?? 0);

  const result = await db
    .update(runs)
    .set({
      status: "completed",
      completedAt: new Date(),
      completedLeads: completedCount,
      failedLeads: failedCount,
    })
    .where(
      and(
        eq(runs.id, runId),
        // 'paused' ist bewusst ausgeschlossen: ein angehaltener Run darf
        // nicht durch nebenläufig fertig werdende Leads „completed" werden —
        // der User soll erst prüfen und explizit fortsetzen.
        sql`${runs.status} NOT IN ('completed', 'failed', 'cancelled', 'paused')`,
        // Race-Guard (Reliability 2026-08-20): ein NEBENLÄUFIGER Finalize-
        // Aufruf kann einen failed Lead gerade auf pending geflippt haben
        // (Auto-Retry), NACHDEM wir oben total/done gezählt haben. Der
        // UPDATE prüft deshalb atomar nochmal, dass wirklich kein Lead
        // mehr nicht-terminal ist — sonst würde die Runde "completed",
        // während ein Retry-Lead noch läuft.
        sql`NOT EXISTS (
          SELECT 1 FROM ${leads}
          WHERE ${leads.runId} = ${runs.id}
            AND ${leads.removedAt} IS NULL
            AND ${leads.status} NOT IN ('completed', 'failed')
        )`,
      ),
    )
    .returning({ id: runs.id });
  const finalized = result.length > 0;
  // Outgoing-Webhook-Hook: bei tatsächlichem Übergang nach 'completed'
  // den `run.completed`-Webhook feuern. Idempotent durch die WHERE-Klausel
  // oben — nur der erste finalisierende Aufruf bekommt eine zurückgegebene
  // Row und feuert. Fire-and-forget; nie blocking.
  if (finalized) {
    void enqueueWebhooksForRunFinalized({ runId, kind: "run.completed" });
    // Abschluss-Mail (W3): gleicher Idempotenz-Gedanke, aber mit eigenem
    // atomarem Claim auf runs.completion_email_sent_at — falls mehrere
    // Pfade finalisieren, verschickt trotzdem nur einer.
    void sendRunCompletionNotification(runId);
    // Ops-Alert an den Admin, wenn trotz Auto-Retry Leads fehlgeschlagen
    // sind. Fire-and-forget + intern gedrosselt — darf nie blockieren.
    if (failedCount > 0) {
      void sendOpsAlert({
        topic: `run-failures-${runId}`,
        subject: `Runde mit ${failedCount} fehlgeschlagenen Leads abgeschlossen`,
        text: `Run ${runId} wurde abgeschlossen mit ${failedCount} von ${total} fehlgeschlagenen Leads (nach automatischem Wiederholungsversuch). Details im Admin unter dem Run-Log.`,
      });
    }
  }
  return { finalized, total, done };
}

/**
 * Fire-and-forget Webhook-Hook für den `run.failed`-Pfad. Wird vom
 * Caller (Pipeline-Worker bzw. Recovery-Logik) explizit aufgerufen,
 * wenn der Run auf `status='failed'` gesetzt wird. Nicht in
 * `finalizeRunIfAllLeadsDone` integriert, weil "alle Leads done" ein
 * Erfolg ist (auch wenn einzelne failed sind) — `run.failed` ist
 * spezifisch für den Fall, dass der gesamte Run einen Fatal-Fehler
 * trifft.
 */
export function notifyRunFailed(runId: string): void {
  void enqueueWebhooksForRunFinalized({ runId, kind: "run.failed" });
}

export async function deleteRun(id: string, userId: string): Promise<void> {
  const result = await db
    .delete(runs)
    .where(and(eq(runs.id, id), eq(runs.userId, userId)))
    .returning({ id: runs.id });
  if (result.length === 0) throw new Error("Not found");
}

/**
 * Soft-Delete: setzt `deletedAt`. Cascade auf Leads / Bunny-Assets passiert
 * NICHT automatisch — der Caller entfernt die `bunny_asset_refs` und der
 * Background-Purge-Worker übernimmt das eigentliche Bunny-Cleanup.
 */
export async function softDeleteRun(id: string, userId: string): Promise<void> {
  const result = await db
    .update(runs)
    .set({ deletedAt: new Date() })
    .where(
      and(eq(runs.id, id), eq(runs.userId, userId), isNull(runs.deletedAt)),
    )
    .returning({ id: runs.id });
  if (result.length === 0) throw new Error("Not found");
}

export async function getRun(id: string, userId: string): Promise<Run> {
  const [row] = await db
    .select()
    .from(runs)
    .where(
      and(eq(runs.id, id), eq(runs.userId, userId), isNull(runs.deletedAt)),
    )
    .limit(1);
  if (!row) throw new Error("Not found");
  return row;
}

export async function listCampaignRuns(
  campaignId: string,
  userId: string,
): Promise<Run[]> {
  return db
    .select()
    .from(runs)
    .where(
      and(
        eq(runs.campaignId, campaignId),
        eq(runs.userId, userId),
        isNull(runs.deletedAt),
      ),
    )
    .orderBy(desc(runs.createdAt));
}

/**
 * Returns runs joined with live per-status counts from the `leads` table.
 * We compute completed/failed via correlated subqueries because the cached
 * counters on `runs` (completed_leads, failed_leads) lag behind worker
 * updates in practice and would render a 0% bar even when leads are done.
 */
export interface RunWithCounts {
  id: string;
  campaignId: string;
  name: string;
  status: Run["status"];
  totalLeads: number;
  completedLeads: number;
  failedLeads: number;
  startedAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  /** A/B-Snapshot der Runde (null = Runde lief ohne A/B-Test). */
  abConfig: RunAbConfig | null;
  /** Live-Zähler je Variante — nur relevant wenn abConfig gesetzt. */
  abLeadsA: number;
  abLeadsB: number;
  abViewedA: number;
  abViewedB: number;
  /** Ausgabe-Zähler für die Icon-Spalte in der Runden-Tabelle. */
  letterCount: number;
  envelopeCount: number;
  emailSentCount: number;
}

// ───────────────────────────────────────────────────────────────────────────
// ── Preflight ─────────────────────────────────────────────────────────────
// ───────────────────────────────────────────────────────────────────────────

/** Alias für den vollen Run-Status (inkl. Preflight-Stati aus Migration 0006). */
export type ExtendedRunStatus = Run["status"];

/**
 * Setzt den Run-Status guarded: das UPDATE schlägt nur durch, wenn der aktuell
 * gespeicherte Status zu den als erlaubt deklarierten Vorgänger-Stati gehört.
 * Damit ist die Transition atomar (optimistic concurrency control) — selbst
 * wenn zwei Requests gleichzeitig denselben Run vorantreiben wollen, gewinnt
 * nur einer.
 *
 * Liefert `{ ok: false, currentStatus }` zurück, wenn die Transition nicht
 * erlaubt war ODER der Run nicht zum User gehört (Tenant-Guard).
 */
export async function setRunStatus(
  runId: string,
  userId: string,
  newStatus: ExtendedRunStatus,
  additional?: Partial<UpdateRunPatch>,
): Promise<
  | { ok: true; run: Run }
  | { ok: false; currentStatus: ExtendedRunStatus | null }
> {
  // Liste der Vorgänger-Stati, von denen aus die neue Status erlaubt ist.
  const validPredecessors = Object.entries(ALLOWED_TRANSITIONS)
    .filter(([, targets]) => targets.includes(newStatus))
    .map(([from]) => from);

  // cancelled darf von jedem nicht-terminalen Status aus erreicht werden —
  // bauen wir auch ohne explizite Tabelle an, damit Cancel immer zieht.
  const predecessors =
    newStatus === "cancelled"
      ? Array.from(
          new Set([
            ...validPredecessors,
            "draft",
            "mapping",
            "preflighting",
            "awaiting_approval",
            "approved",
            "generating",
            "paused",
          ]),
        )
      : validPredecessors;

  if (predecessors.length === 0) {
    // Niemand darf in den neuen Status springen — Schema-Bug.
    const [cur] = await db
      .select({ status: runs.status })
      .from(runs)
      .where(
        and(eq(runs.id, runId), eq(runs.userId, userId), isNull(runs.deletedAt)),
      )
      .limit(1);
    return { ok: false, currentStatus: (cur?.status as ExtendedRunStatus) ?? null };
  }

  const [updated] = await db
    .update(runs)
    .set({ status: newStatus, ...(additional ?? {}) })
    .where(
      and(
        eq(runs.id, runId),
        eq(runs.userId, userId),
        isNull(runs.deletedAt),
        inArray(runs.status, predecessors as Run["status"][]),
      ),
    )
    .returning();

  if (updated) return { ok: true, run: updated };

  // Update hat nicht gegriffen — entweder Tenant-Mismatch oder Status passt nicht.
  const [cur] = await db
    .select({ status: runs.status })
    .from(runs)
    .where(
      and(eq(runs.id, runId), eq(runs.userId, userId), isNull(runs.deletedAt)),
    )
    .limit(1);
  return { ok: false, currentStatus: (cur?.status as ExtendedRunStatus) ?? null };
}

/**
 * Liest einen Run inkl. der Preflight-Counter (approved / rejected / failed).
 * Wrapper um `getRun`, der das Result als ungeschachteltes Object liefert —
 * macht den API-Code lesbarer und vermeidet doppelte SELECTs.
 */
export async function getRunForPreflight(
  runId: string,
  userId: string,
): Promise<Run> {
  return getRun(runId, userId);
}

/**
 * Inkrementiert/setzt die Preflight-Aggregat-Counter auf einem Run.
 * Wird vom Approve-/Reject-Endpoint nach der eigentlichen DB-Mutation
 * aufgerufen, damit das UI die Zähler ohne separaten COUNT(*) lesen kann.
 *
 * Werte werden SET (nicht incrementiert), weil der Caller die echten
 * Zähler aus dem Update-Result kennt und Race-Conditions damit unmöglich
 * sind (es gibt genau einen "Approve"-Aufruf pro Run).
 */
export async function updateRunCounts(
  runId: string,
  userId: string,
  counts: {
    approvedLeadCount?: number;
    rejectedLeadCount?: number;
    preflightFailedCount?: number;
  },
): Promise<Run> {
  const patch: UpdateRunPatch = {};
  if (counts.approvedLeadCount !== undefined) {
    patch.approvedLeadCount = counts.approvedLeadCount;
  }
  if (counts.rejectedLeadCount !== undefined) {
    patch.rejectedLeadCount = counts.rejectedLeadCount;
  }
  if (counts.preflightFailedCount !== undefined) {
    patch.preflightFailedCount = counts.preflightFailedCount;
  }
  return updateRun(runId, userId, patch);
}

// ───────────────────────────────────────────────────────────────────────────
// ── Shared Thumbnail (Paket D, Thumbnail-Generator) ──────────────────────
// ───────────────────────────────────────────────────────────────────────────

/**
 * Liest die aktuell für den Run gecachte Shared-Thumbnail-URL aus dem
 * Kampagnen-Thumbnail-Generator. NULL = noch nicht erzeugt.
 *
 * ACHTUNG: `runs.sharedThumbnailUrl` ist eine *poly*-Spalte:
 *   - In webcam-only Runs hält der `runVideoResolveShared`-Pfad hier den
 *     Bunny-Stream-Thumbnail des geteilten Webcam-Videos.
 *   - In Runs mit aktivem Thumbnail-Generator (`campaigns.thumbnail_image_
 *     enabled = true`) hält dieselbe Spalte das vom Generator gerenderte
 *     Custom-Thumbnail (das, was wir hier lesen).
 * Welcher Wert gilt, entscheidet das Lesen-aus-Kontext (Pipeline kennt
 * `campaign.thumbnailImageEnabled`). Deswegen liefern wir hier nur den
 * Roh-Wert; die Pipeline-Stage entscheidet, ob das die richtige Bedeutung
 * hat.
 */
export async function getSharedThumbnailUrl(
  runId: string,
): Promise<string | null> {
  const [row] = await db
    .select({ url: runs.sharedThumbnailUrl })
    .from(runs)
    .where(eq(runs.id, runId))
    .limit(1);
  return row?.url ?? null;
}

/**
 * Schreibt die geteilte Thumbnail-URL für den Run idempotent. Wird vom
 * Lock-Owner nach erfolgreichem Render+Upload aufgerufen.
 *
 * Wir nutzen einen einfachen UPDATE — das WHERE-Filter auf NULL würde
 * uns vor späten Doppelschreibungen schützen, ist aber problematisch
 * (siehe Polymorphie oben: in webcam-only Runs ist die Spalte evtl.
 * schon vom Shared-Video belegt). Deshalb: bedingungsloses UPDATE. Race-
 * sicher ist die Stage durch den `pg_try_advisory_xact_lock` in
 * `claimSharedThumbnailRender()` davor.
 */
export async function setSharedThumbnailUrl(
  runId: string,
  url: string,
): Promise<void> {
  await db
    .update(runs)
    .set({ sharedThumbnailUrl: url })
    .where(eq(runs.id, runId));
}

/**
 * Atomarer Lock-Claim für den Render eines geteilten Custom-Thumbnails.
 *
 * Implementierung: `pg_try_advisory_xact_lock(hashtext('shared-thumbnail:'
 * || $runId))`. Liefert `true` wenn DIESER Caller exklusiv weiterarbeiten
 * darf — Postgres serialisiert das pro Hash-Schlüssel über die gesamte
 * Connection. Andere Worker, die parallel claimen wollen, bekommen
 * `false` und sollen pollen (siehe `getSharedThumbnailUrl`).
 *
 * Warum advisory-lock und kein State-Spalten-Pattern wie bei shared-video?
 *   `runs.sharedThumbnailUrl` ist polymorph (siehe oben). Ein eigenes
 *   `sharedThumbnailState`-Feld würde das Schema unnötig duplizieren —
 *   advisory locks sind genau für „kurzlebige, asset-billige Serialisierung
 *   ohne State-Spalte" gemacht. Der Lock wird beim Transaktions-Ende
 *   automatisch freigegeben, deshalb wrappen wir ihn in `db.transaction()`.
 *
 * Niemals werfend für den Fall „Lock nicht bekommen" — der Caller pollt
 * dann auf `sharedThumbnailUrl`. Wirft nur bei echten DB-Fehlern.
 */
export async function withSharedThumbnailLock<T>(
  runId: string,
  fn: () => Promise<T>,
): Promise<{ acquired: true; value: T } | { acquired: false }> {
  return db.transaction(async (tx) => {
    const result = (await tx.execute(
      sql`SELECT pg_try_advisory_xact_lock(hashtext(${"shared-thumbnail:" + runId})) AS acquired`,
    )) as unknown as Array<{ acquired: boolean }>;
    const rows = Array.isArray(result)
      ? result
      : ((result as { rows?: Array<{ acquired: boolean }> }).rows ?? []);
    const acquired = rows[0]?.acquired === true;
    if (!acquired) {
      return { acquired: false as const };
    }
    const value = await fn();
    return { acquired: true as const, value };
  });
}

export async function listCampaignRunsWithCounts(
  campaignId: string,
  userId: string,
): Promise<RunWithCounts[]> {
  const rows = await db
    .select({
      id: runs.id,
      campaignId: runs.campaignId,
      name: runs.name,
      status: runs.status,
      totalLeads: runs.totalLeads,
      startedAt: runs.startedAt,
      completedAt: runs.completedAt,
      createdAt: runs.createdAt,
      liveCompleted: sql<number>`(
        SELECT COUNT(*)::int FROM ${leads}
        WHERE ${leads.runId} = ${runs.id} AND ${leads.status} = 'completed'
      )`,
      liveFailed: sql<number>`(
        SELECT COUNT(*)::int FROM ${leads}
        WHERE ${leads.runId} = ${runs.id} AND ${leads.status} = 'failed'
      )`,
      abConfig: runs.abConfig,
      // A/B-Zähler je Variante. `removed_at IS NULL` spiegelt die Zuteilung
      // im Start-Endpoint (nur echte Leads zählen in die Quote).
      abLeadsA: sql<number>`(
        SELECT COUNT(*)::int FROM ${leads}
        WHERE ${leads.runId} = ${runs.id} AND ${leads.abVariant} = 'A' AND ${leads.removedAt} IS NULL
      )`,
      abLeadsB: sql<number>`(
        SELECT COUNT(*)::int FROM ${leads}
        WHERE ${leads.runId} = ${runs.id} AND ${leads.abVariant} = 'B' AND ${leads.removedAt} IS NULL
      )`,
      abViewedA: sql<number>`(
        SELECT COUNT(*)::int FROM ${leads}
        WHERE ${leads.runId} = ${runs.id} AND ${leads.abVariant} = 'A' AND ${leads.removedAt} IS NULL AND ${leads.viewCount} > 0
      )`,
      abViewedB: sql<number>`(
        SELECT COUNT(*)::int FROM ${leads}
        WHERE ${leads.runId} = ${runs.id} AND ${leads.abVariant} = 'B' AND ${leads.removedAt} IS NULL AND ${leads.viewCount} > 0
      )`,
      // Icons-Spalte in der Runden-Tabelle: pro-Run-Kennzahlen für
      // Brief-/Umschlag-/Mail-Icons (siehe runs-table.tsx). Kein Cache-
      // Feld auf `runs` — wir zählen jedes Mal live, weil Regenerate/
      // Purge die Werte jederzeit ändern kann.
      letterCount: sql<number>`(
        SELECT COUNT(*)::int FROM ${leads}
        WHERE ${leads.runId} = ${runs.id} AND ${leads.pdfUrl} IS NOT NULL AND ${leads.removedAt} IS NULL
      )`,
      envelopeCount: sql<number>`(
        SELECT COUNT(*)::int FROM ${leads}
        WHERE ${leads.runId} = ${runs.id} AND ${leads.envelopePdfUrl} IS NOT NULL AND ${leads.removedAt} IS NULL
      )`,
      emailSentCount: sql<number>`(
        SELECT COALESCE(SUM(sent_count), 0)::int FROM email_blasts
        WHERE run_id = ${runs.id}
      )`,
    })
    .from(runs)
    .where(
      and(
        eq(runs.campaignId, campaignId),
        eq(runs.userId, userId),
        isNull(runs.deletedAt),
      ),
    )
    .orderBy(desc(runs.createdAt));

  return rows.map((r) => ({
    id: r.id,
    campaignId: r.campaignId,
    name: r.name,
    status: r.status,
    totalLeads: r.totalLeads,
    // Live counts are authoritative; the cached counters on `runs` are a
    // denormalization that the workers update best-effort.
    completedLeads: r.liveCompleted ?? 0,
    failedLeads: r.liveFailed ?? 0,
    startedAt: r.startedAt,
    completedAt: r.completedAt,
    createdAt: r.createdAt,
    abConfig: (r.abConfig as RunAbConfig | null) ?? null,
    abLeadsA: r.abLeadsA ?? 0,
    abLeadsB: r.abLeadsB ?? 0,
    abViewedA: r.abViewedA ?? 0,
    abViewedB: r.abViewedB ?? 0,
    letterCount: r.letterCount ?? 0,
    envelopeCount: r.envelopeCount ?? 0,
    emailSentCount: r.emailSentCount ?? 0,
  }));
}

// ───────────────────────────────────────────────────────────────────────────
// ── Tracking-Reset ────────────────────────────────────────────────────────
// ───────────────────────────────────────────────────────────────────────────

/**
 * Wipes all collected tracking data for a single run:
 *   - Deletes every `lead_events` row whose lead belongs to the run
 *   - Deletes every `analytics_events` row whose lead belongs to the run
 *   - Resets the denormalized per-lead counters on `leads`
 *     (view_count, play_count, watch_time_sec, cta_click_count) back to 0
 *     and clears the first/last-viewed and last-cta timestamps
 *
 * Does NOT touch pipeline-execution logs (`pipeline_events`), run-level
 * pipeline counters (`runs.completed_leads` / `failed_leads` / `total_leads`),
 * exclusion state (`leads.removed_at` / `removed_reason`) or rendered
 * artefacts (`leads.pdf_url`, `video_url`, `thumbnail_url`, `slug`, `status`).
 *
 * Tenant-Guard: `getRun()` throws if the run does not belong to `userId`,
 * so foreign run IDs surface as 404 in the API.
 *
 * Runs as one transaction so a partial failure can never leave aggregates
 * out of sync with the underlying event tables.
 */
export async function resetRunTracking(
  runId: string,
  userId: string,
): Promise<{
  leadsReset: number;
  leadEventsDeleted: number;
  analyticsEventsDeleted: number;
}> {
  // Tenant-Guard: 404 wenn der Run nicht zum User gehört (wirft).
  await getRun(runId, userId);

  return db.transaction(async (tx) => {
    // 1. lead_events löschen (alle Events für Leads dieses Runs).
    const leadEventsDeleted = await tx
      .delete(leadEvents)
      .where(
        inArray(
          leadEvents.leadId,
          tx.select({ id: leads.id }).from(leads).where(eq(leads.runId, runId)),
        ),
      )
      .returning({ id: leadEvents.id });

    // 2. analytics_events löschen (analog).
    const analyticsEventsDeleted = await tx
      .delete(analyticsEvents)
      .where(
        inArray(
          analyticsEvents.leadId,
          tx.select({ id: leads.id }).from(leads).where(eq(leads.runId, runId)),
        ),
      )
      .returning({ id: analyticsEvents.id });

    // 3. Denormalisierte Aggregat-Spalten auf den Leads zurücksetzen.
    //    URLs / Status / Exclusion-Felder bleiben unangetastet — der Run
    //    bleibt aus Pipeline-Sicht „fertig", nur das Tracking wird geleert.
    const leadsReset = await tx
      .update(leads)
      .set({
        viewCount: 0,
        playCount: 0,
        watchTimeSec: 0,
        ctaClickCount: 0,
        firstViewedAt: null,
        lastViewedAt: null,
        lastCtaAt: null,
      })
      .where(eq(leads.runId, runId))
      .returning({ id: leads.id });

    return {
      leadsReset: leadsReset.length,
      leadEventsDeleted: leadEventsDeleted.length,
      analyticsEventsDeleted: analyticsEventsDeleted.length,
    };
  });
}
