/**
 * One-shot: Regeneriert alle PDFs (Brief + QR) für ALLE aktiven Runs einer
 * Kampagne.
 *
 * Use case: Nachdem die `leads.slug`-Spalte massenhaft bereinigt wurde (z.B.
 * `-2`-Suffix entfernt) müssen die bereits gerenderten PDFs in Bunny Edge
 * Storage neu erzeugt werden — sonst zeigen die abgedruckten URLs + QR-Codes
 * auf die alten, jetzt nicht mehr existierenden Slug-Varianten.
 *
 * Was passiert pro Lead:
 *  1. Bestehende PDF-Datei in Bunny Storage löschen (CDN-Cache-Invalidierung).
 *  2. Lead-Status-Felder zurücksetzen: pdfUrl, status, started/completedAt,
 *     currentStage, attempts, errorMessage. Video- + Slug-Felder bleiben
 *     unangetastet (Webcam-Only-Mode → shared Bunny-Stream-Video bleibt;
 *     Slug ist die aktuell saubere Version in der DB).
 *  3. BullMQ-Job auf `lead-pipeline` enqueuen mit `skipVideo=true`. Die
 *     Pipeline rebuildet pageUrl aus `lead.slug` (jetzt sauber), regen't
 *     QR + DOCX, lädt PDF unter exakt demselben Bunny-Pfad neu hoch.
 *
 * Run-Status wird auf 'generating' gesetzt, damit das UI live mit-tracken
 * kann. Run-Statistiken (completed/failed counters) werden NICHT reset —
 * `finalizeRunIfAllLeadsDone` schreibt sie nach Pipeline-Ende neu.
 *
 * Spiegelt 1:1 das Verhalten von `POST /api/runs/[id]/regenerate?mode=pdf`,
 * skaliert aber über alle aktiven Runs einer Kampagne in einem Aufruf und
 * benötigt keinen Session-Cookie (direkter DB- + Redis-Zugriff).
 *
 * Aufruf (lokal):
 *   npx tsx scripts/regenerate-campaign-pdfs.ts <campaignId>
 *
 * Aufruf (Production-Container):
 *   docker exec videocomet-app sh -lc \
 *     'cd /app && npx tsx scripts/regenerate-campaign-pdfs.ts <campaignId>'
 */

import "dotenv/config";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "../src/lib/db";
import { leads, runs } from "../src/lib/db/schema";
import { deleteFile, parseStorageUrl } from "../src/lib/bunny/storage";
import { pipelineQueue } from "../src/worker/queue";

const ACTIVE_RUN_STATUSES = [
  "completed",
  "failed",
  "approved",
  "awaiting_approval",
] as const;

/**
 * Parst den Remote-Pfad eines Bunny-CDN-Lead-PDFs. Pattern:
 * `https://<zone>.b-cdn.net/runs/<runId>/leads/<leadId>.pdf`.
 * Fallback auf den canonical `runs/<runId>/leads/<leadId>.pdf` falls die
 * URL unparseable ist — dann nehmen wir an, dass die Datei im default-zone
 * dort liegt und versuchen trotzdem zu löschen.
 */
function bunnyRemotePathForLead(
  runId: string,
  leadId: string,
  pdfUrl: string | null,
): string {
  if (pdfUrl) {
    const parsed = parseStorageUrl(pdfUrl);
    if (parsed?.path) return parsed.path;
  }
  return `runs/${runId}/leads/${leadId}.pdf`;
}

async function main(): Promise<void> {
  const campaignId = process.argv[2];
  if (!campaignId) {
    console.error(
      "Usage: npx tsx scripts/regenerate-campaign-pdfs.ts <campaignId>",
    );
    process.exit(2);
  }

  console.log(`[regen-pdfs] campaign=${campaignId}`);

  // 1. Aktive Runs holen (nicht soft-deleted, nicht laufend).
  const activeRuns = await db
    .select({
      id: runs.id,
      userId: runs.userId,
      status: runs.status,
      name: runs.name,
    })
    .from(runs)
    .where(
      and(
        eq(runs.campaignId, campaignId),
        isNull(runs.deletedAt),
        inArray(runs.status, [...ACTIVE_RUN_STATUSES]),
      ),
    );

  if (activeRuns.length === 0) {
    console.log("[regen-pdfs] no active runs found — nothing to do.");
    process.exit(0);
  }

  // Sanity: bei 'generating' brechen wir komplett ab — der User würde sonst
  // zwei konkurrente Pipelines auf den gleichen Leads triggern.
  const generatingRuns = await db
    .select({ id: runs.id, status: runs.status })
    .from(runs)
    .where(
      and(
        eq(runs.campaignId, campaignId),
        isNull(runs.deletedAt),
        eq(runs.status, "generating"),
      ),
    );
  if (generatingRuns.length > 0) {
    console.error(
      `[regen-pdfs] ABORT: ${generatingRuns.length} run(s) in 'generating' state — wait for them to finish or cancel them first.`,
    );
    for (const r of generatingRuns) console.error(`  - run=${r.id}`);
    process.exit(3);
  }

  const uniqueStatuses = Array.from(
    new Set(activeRuns.map((r) => r.status)),
  );
  console.log(
    `[regen-pdfs] active runs: ${activeRuns.length} (statuses: ${uniqueStatuses.join(", ")})`,
  );
  for (const r of activeRuns) {
    console.log(`  - run=${r.id} status=${r.status} name="${r.name}"`);
  }

  // 2. Leads pro Run sammeln. Wir verarbeiten nur nicht-soft-deleted Leads
  //    (preflight-rejected werden ohnehin von der Pipeline ignoriert).
  const runIds = activeRuns.map((r) => r.id);
  const allLeads = await db
    .select({
      id: leads.id,
      runId: leads.runId,
      campaignId: leads.campaignId,
      pdfUrl: leads.pdfUrl,
      slug: leads.slug,
    })
    .from(leads)
    .where(and(inArray(leads.runId, runIds), isNull(leads.removedAt)));

  if (allLeads.length === 0) {
    console.log("[regen-pdfs] no leads to process.");
    process.exit(0);
  }

  const total = allLeads.length;
  console.log(`[regen-pdfs] total leads to regenerate: ${total}`);

  // 3. Bunny-PDFs LÖSCHEN (CDN-Cache invalidieren).
  //    Best-effort: 404er werden geschluckt (Datei evtl. schon weg). Andere
  //    Fehler werden gezählt, brechen aber nicht ab — die DB-Reset-Schritte
  //    sollen trotzdem durchlaufen, sonst sitzt der Run halb-zurückgesetzt
  //    fest.
  let deleted = 0;
  let deleteSkipped = 0;
  let deleteErrors = 0;
  for (let i = 0; i < allLeads.length; i++) {
    const lead = allLeads[i];
    const path = bunnyRemotePathForLead(lead.runId, lead.id, lead.pdfUrl);
    try {
      await deleteFile(path);
      deleted += 1;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // Bunny gibt 404 als BunnyApiError (`failed with 404`). Das ist OK.
      if (msg.includes("404")) {
        deleteSkipped += 1;
      } else {
        deleteErrors += 1;
        console.warn(
          `[regen-pdfs] delete failed for lead=${lead.id} path=${path}: ${msg}`,
        );
      }
    }
    if ((i + 1) % 50 === 0 || i + 1 === allLeads.length) {
      console.log(
        `[regen-pdfs] bunny delete progress: ${i + 1}/${total} (deleted=${deleted}, missing=${deleteSkipped}, errors=${deleteErrors})`,
      );
    }
  }

  // 4. DB-Reset pro Lead-Bulk: alle relevanten Felder in einem Update.
  //    KRITISCH: slug, videoUrl, thumbnailUrl, bunnyVideoId, domainId bleiben
  //    unangetastet — die Pipeline wird mit `skipVideo=true` aufgerufen und
  //    soll die existierenden, korrekten Werte weiterverwenden.
  const leadIds = allLeads.map((l) => l.id);

  // Drizzle hat kein natives `setNull`-Helper; wir benutzen direktes SQL,
  // damit die Spalten sauber auf NULL gesetzt werden (Drizzle `.set({ x:
  // null })` funktioniert für `text`/`timestamp`/`integer` mit `notNull`-
  // Wert (attempts → 0)). Wir reichen jeden Wert separat, damit der Typ
  // korrekt erhalten bleibt.
  await db
    .update(leads)
    .set({
      pdfUrl: null,
      pdfExpiresAt: null,
      status: "pending",
      startedAt: null,
      completedAt: null,
      currentStage: null,
      attempts: 0,
      errorMessage: null,
    })
    .where(inArray(leads.id, leadIds));

  console.log(`[regen-pdfs] DB reset done for ${leadIds.length} leads.`);

  // 5. Runs auf 'generating' setzen + Counter resetten, damit
  //    `finalizeRunIfAllLeadsDone` sauber neu zählt.
  await db
    .update(runs)
    .set({
      status: "generating",
      startedAt: new Date(),
      completedAt: null,
      completedLeads: 0,
      failedLeads: 0,
    })
    .where(inArray(runs.id, runIds));

  console.log(`[regen-pdfs] ${runIds.length} run(s) marked 'generating'.`);

  // 6. BullMQ-Jobs enqueuen. Identische Payload-Form wie das
  //    `regenerate?mode=pdf`-Endpoint:
  //      name:  'lead-pipeline'
  //      data:  { leadId, runId, userId, campaignId, skipVideo: true }
  //      opts:  { jobId: leadId }
  //    `addBulk` will silently dedupe wenn der gleiche `jobId` im
  //    completed/failed ZSET sitzt — wir entfernen ihn vorher explizit.
  const runUserById = new Map(activeRuns.map((r) => [r.id, r.userId]));
  const queue = pipelineQueue();

  // ALT-Job aus Redis-ZSETs räumen (sonst dedupe-Stille).
  let removed = 0;
  for (let i = 0; i < leadIds.length; i++) {
    try {
      await queue.remove(leadIds[i]);
      removed += 1;
    } catch {
      // Job existiert nicht in der Queue — alles gut.
    }
    if ((i + 1) % 100 === 0 || i + 1 === leadIds.length) {
      console.log(
        `[regen-pdfs] queue.remove progress: ${i + 1}/${leadIds.length} (removed=${removed})`,
      );
    }
  }

  // Chunked addBulk (BullMQ kann grosse Bulks, aber wir bleiben unter
  // dem 500-Item-Sweet-Spot um Memory + Redis-Pipeline-Latenz handlich
  // zu halten).
  const CHUNK = 250;
  let enqueued = 0;
  for (let i = 0; i < allLeads.length; i += CHUNK) {
    const slice = allLeads.slice(i, i + CHUNK);
    await queue.addBulk(
      slice.map((l) => {
        const userId = runUserById.get(l.runId);
        if (!userId) {
          throw new Error(
            `[regen-pdfs] missing userId for run=${l.runId} (lead=${l.id})`,
          );
        }
        return {
          name: "lead-pipeline",
          data: {
            leadId: l.id,
            runId: l.runId,
            userId,
            campaignId: l.campaignId,
            skipVideo: true,
          },
          opts: { jobId: l.id },
        };
      }),
    );
    enqueued += slice.length;
    console.log(`[regen-pdfs] enqueue progress: ${enqueued}/${total}`);
  }

  // 7. Verification: queue depth report.
  const counts = await queue.getJobCounts(
    "waiting",
    "active",
    "delayed",
    "completed",
    "failed",
  );
  console.log(
    `[regen-pdfs] queue '${queue.name}' depth — waiting=${counts.waiting} active=${counts.active} delayed=${counts.delayed} completed=${counts.completed} failed=${counts.failed}`,
  );
  console.log(`[regen-pdfs] ${enqueued} jobs queued for ${total} leads.`);

  // Sanity-Check: COUNT(*) der Leads die jetzt in status='pending' sind.
  const pendingRows = await db
    .select({ id: leads.id })
    .from(leads)
    .where(and(inArray(leads.id, leadIds), eq(leads.status, "pending")));
  console.log(
    `[regen-pdfs] sanity: ${pendingRows.length}/${total} leads in DB status=pending`,
  );

  // Sauber raus — BullMQ + Postgres haben Connection-Pools, ohne explizit
  // close() würde der Prozess sonst hängen.
  await queue.close();
  console.log(`[regen-pdfs] done.`);
  process.exit(0);
}

main().catch((err) => {
  console.error("[regen-pdfs] fatal:", err);
  process.exit(1);
});
