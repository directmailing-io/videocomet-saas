/**
 * Intro-Preview-Processor.
 *
 * Erzeugt nach Preflight-Abschluss (Promotion → awaiting_approval) bis zu
 * 3 kurze Vorschau-Videos (~15s) mit personalisierter KI-Begrüßung, damit
 * der User die Qualität VOR der Freigabe beurteilen kann.
 *
 * Design-Entscheidungen:
 *   - Läuft asynchron NACH der Promotion — blockiert den Statuswechsel nie.
 *     Die UI pollt `runs.intro_preview` (NULL = noch nicht fertig / kein
 *     Intro, [] = versucht aber nichts gelungen, [entries] = fertig).
 *   - Idempotent: wenn `runs.intro_preview` bereits gesetzt ist (auch []),
 *     wird der Job übersprungen (BullMQ-Retry / doppelte Enqueues).
 *   - Kandidaten: nicht-entfernte Leads mit preflight_status='ok', nach
 *     rowIndex sortiert, dedupliziert nach normalisiertem Vornamen —
 *     der User soll 3 VERSCHIEDENE Namen hören.
 *   - Fehlgeschlagene Leads werden übersprungen (max. ~6 Versuche),
 *     Preview-Fehler sind nie fatal.
 *   - Feature nicht bereit (Intro aus, Voice/Kalibrierung fehlt): Job endet
 *     ohne Schreiben — `intro_preview` bleibt NULL, das Approve-Gate greift
 *     dann nicht.
 */

import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  campaigns,
  introCalibrations,
  leads,
  mediaItems,
  runs,
  voiceProfiles,
  type IntroPreviewEntry,
} from "@/lib/db/schema";
import { resolveIntroSubstitutions } from "@/lib/intro-name-check";
import { DEFAULT_TTS_TEMPLATE, INTRO_PREVIEW_TARGET } from "@/lib/intro";
import { uploadIntroFile } from "@/lib/bunny/intro-storage";
import { createTempDir, cleanupTempDir } from "../lib/temp";
import { generatePersonalizedWebcam } from "../lib/intro-engine";
import type { IntroPreviewJobData } from "../intro-queue";

/** Vorschau-Länge in Sekunden. Kurz genug fuer schnelles sync.so-Rendering,
 *  lang genug damit der User die Anrede + Beginn des ersten Satzes bewerten
 *  kann. */
const PREVIEW_TRIM_SEC = 8;
/**
 * Wie viele Kandidaten wir parallel rendern — Ziel + Puffer für Fallbacks.
 * Größer wäre schneller, würde aber Fish/sync.so unnötig belasten und die
 * Kosten hochtreiben. 4 = Ziel 3 + ein Reserve-Lead für Fehlgeschlagene.
 */
const PREVIEW_PARALLEL = INTRO_PREVIEW_TARGET + 1;

export async function processIntroPreviewJob(job: {
  data: IntroPreviewJobData;
}): Promise<{ status: "done" | "skipped"; previews?: number; reason?: string }> {
  const { runId } = job.data;

  const [run] = await db
    .select({
      id: runs.id,
      userId: runs.userId,
      campaignId: runs.campaignId,
      status: runs.status,
      introPreview: runs.introPreview,
      introPreviewCompletedAt: runs.introPreviewCompletedAt,
    })
    .from(runs)
    .where(eq(runs.id, runId))
    .limit(1);
  if (!run) return { status: "skipped", reason: "run_not_found" };

  // Idempotenz: nur skippen, wenn der Vorlauf ECHT fertig ist. Ein
  // Zwischenstand (introPreview != null, completed_at == null) darf nicht
  // stehenbleiben — der Retry-Pfad startet dann sauber neu.
  if (run.introPreviewCompletedAt) {
    return { status: "skipped", reason: "already_generated" };
  }
  // Atomic Claim: reset intro_preview auf null NUR wenn completed_at auch
  // NULL ist. Verhindert Race, wenn zwei Worker-Instanzen gleichzeitig den
  // Job starten (BullMQ hat Locks, aber Recovery-Watcher + manueller
  // Enqueue könnten theoretisch beide passieren). Wenn der Reset 0 Rows
  // affected → ein anderer Prozess ist gleichzeitig aktiv oder war schneller.
  if (run.introPreview !== null) {
    const claimed = await db
      .update(runs)
      .set({ introPreview: null })
      .where(and(eq(runs.id, runId), isNull(runs.introPreviewCompletedAt)))
      .returning({ id: runs.id });
    if (claimed.length === 0) {
      return { status: "skipped", reason: "already_completed_by_other" };
    }
  }

  const [campaign] = await db
    .select({
      introEnabled: campaigns.introEnabled,
      webcamMediaId: campaigns.webcamMediaId,
    })
    .from(campaigns)
    .where(eq(campaigns.id, run.campaignId))
    .limit(1);
  if (!campaign?.introEnabled || !campaign.webcamMediaId) {
    return { status: "skipped", reason: "intro_not_enabled" };
  }

  // Voice-Profil + Kalibrierung müssen ready sein — sonst NULL lassen
  // (Pipeline setzt die Leads später ohnehin auf intro_status='disabled').
  const [voiceProfile] = await db
    .select({ status: voiceProfiles.status, fishModelId: voiceProfiles.fishModelId })
    .from(voiceProfiles)
    .where(eq(voiceProfiles.userId, run.userId))
    .limit(1);
  const [calibration] = await db
    .select()
    .from(introCalibrations)
    .where(eq(introCalibrations.mediaItemId, campaign.webcamMediaId))
    .limit(1);
  if (
    voiceProfile?.status !== "ready" ||
    !voiceProfile.fishModelId ||
    calibration?.status !== "ready"
  ) {
    return { status: "skipped", reason: "intro_not_ready" };
  }

  const [webcam] = await db
    .select({ publicUrl: mediaItems.publicUrl })
    .from(mediaItems)
    .where(eq(mediaItems.id, campaign.webcamMediaId))
    .limit(1);
  if (!webcam?.publicUrl) {
    return { status: "skipped", reason: "webcam_missing" };
  }

  // Kandidaten: nicht entfernt, Preflight ok, in Listen-Reihenfolge.
  const candidates = await db
    .select({ id: leads.id, data: leads.data })
    .from(leads)
    .where(
      and(
        eq(leads.runId, runId),
        isNull(leads.removedAt),
        sql`${leads.preflightStatus} = 'ok'`,
      ),
    )
    .orderBy(asc(leads.rowIndex))
    .limit(200);

  const tmpDir = await createTempDir(`intro-preview-${runId.slice(0, 8)}`);
  try {
    // Webcam einmal pro Job herunterladen. Referer mitschicken — Bunny-
    // CDN-Hotlink-Protection blockt sonst (Pattern aus video-render.ts).
    const referer = process.env.APP_URL ?? "https://app.videocomet.de";
    const res = await fetch(webcam.publicUrl, {
      headers: {
        Referer: referer,
        Origin: referer,
        "User-Agent": "videocomet-worker/1.0",
      },
    });
    if (!res.ok) {
      return { status: "skipped", reason: `webcam_download_http_${res.status}` };
    }
    const webcamLocalPath = join(tmpDir, "webcam-src.mp4");
    await writeFile(webcamLocalPath, Buffer.from(await res.arrayBuffer()));

    const template = calibration.ttsTemplate?.trim() || DEFAULT_TTS_TEMPLATE;

    // Vorfiltern + Dedup — nur Kandidaten, für die Substitutionen aus den
    // Lead-Daten resolvbar sind. Erst DANN begrenzen wir die Anzahl, um
    // die Reserve-Slots nicht durch früh disqualifizierte Leads zu
    // verschwenden.
    const seenNames = new Set<string>();
    const eligible: Array<{
      leadId: string;
      substitutions: Record<string, string>;
    }> = [];
    for (const lead of candidates) {
      if (eligible.length >= PREVIEW_PARALLEL) break;
      const substResult = resolveIntroSubstitutions(
        template,
        (lead.data ?? {}) as Record<string, string>,
      );
      if (!substResult.ok) continue;
      const nameKey = Object.values(substResult.substitutions)
        .join(" ")
        .toLowerCase();
      if (seenNames.has(nameKey)) continue;
      seenNames.add(nameKey);
      eligible.push({ leadId: lead.id, substitutions: substResult.substitutions });
    }

    // Erste `intro_preview`-Zeile setzen, damit die UI vom Spinner-State
    // in den Progress-State wechselt (statt „wird erstellt" ohne Zahlen
    // zeigt sie jetzt „0 von N fertig"). Reine Klammer-Aktion.
    await db
      .update(runs)
      .set({ introPreview: [] })
      .where(eq(runs.id, runId));

    // Parallel rendern — sync.so-Lipsync ist der Flaschenhals (~30-60s
    // pro Video). Serieller Lauf hat ~3 Minuten gedauert; parallel fällt
    // die Wall-Time näher an ein einzelnes Rendering. Erfolge werden
    // sofort atomar an `intro_preview` angehängt, damit die UI live
    // wächst statt am Ende „alle drei auf einmal" zu bekommen.
    const fishModelId = voiceProfile.fishModelId; // narrow für Closures
    const outcomes = await Promise.allSettled(
      eligible.map(async (cand) => {
        const result = await generatePersonalizedWebcam({
          userId: run.userId,
          tag: `pv-${cand.leadId.slice(0, 8)}`,
          substitutions: cand.substitutions,
          calibration,
          fishModelId,
          webcamLocalPath,
          workDir: tmpDir,
          trimToSec: PREVIEW_TRIM_SEC,
        });
        if (!result.ok) {
          console.warn(
            `[intro-preview:${runId}] lead ${cand.leadId} fallback: ${result.reason}`,
          );
          return null;
        }
        const upload = await uploadIntroFile({
          userId: run.userId,
          fileName: `preview-${runId}-${cand.leadId}.mp4`,
          buffer: await readFile(result.outputPath),
          contentType: "video/mp4",
        });
        const entry: IntroPreviewEntry = {
          leadId: cand.leadId,
          videoUrl: upload.url,
        };
        // Atomarer JSONB-Append — mehrere parallele Renderings können
        // gleichzeitig committen, ohne sich gegenseitig zu überschreiben.
        // Der JSON-String wird von Drizzle parametrisiert, Postgres castet
        // ihn via ::jsonb (kein Injection-Risiko trotz Strings aus API-URLs).
        const entryJson = JSON.stringify([entry]);
        await db
          .update(runs)
          .set({
            introPreview: sql`COALESCE(${runs.introPreview}, '[]'::jsonb) || ${entryJson}::jsonb`,
          })
          .where(eq(runs.id, runId));
        return entry;
      }),
    );

    const successful = outcomes.filter(
      (o) => o.status === "fulfilled" && o.value !== null,
    ).length;
    for (const o of outcomes) {
      if (o.status === "rejected") {
        console.warn(
          `[intro-preview:${runId}] render error: ${(o.reason as Error).message}`,
        );
      }
    }

    // Abschluss-Marker setzen — die UI weiß jetzt „fertig, das ist alles".
    await db
      .update(runs)
      .set({ introPreviewCompletedAt: new Date() })
      .where(eq(runs.id, runId));

    return { status: "done", previews: successful };
  } finally {
    await cleanupTempDir(tmpDir);
  }
}
