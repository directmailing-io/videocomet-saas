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
import { DEFAULT_TTS_TEMPLATE } from "@/lib/intro";
import { uploadIntroFile } from "@/lib/bunny/intro-storage";
import { createTempDir, cleanupTempDir } from "../lib/temp";
import { generatePersonalizedWebcam } from "../lib/intro-engine";
import type { IntroPreviewJobData } from "../intro-queue";

/** Vorschau-Länge in Sekunden. */
const PREVIEW_TRIM_SEC = 15;
/** Ziel: so viele erfolgreiche Previews. */
const PREVIEW_TARGET = 3;
/** Obergrenze an Engine-Versuchen (Kosten-/Zeit-Deckel). */
const PREVIEW_MAX_ATTEMPTS = 6;

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
    })
    .from(runs)
    .where(eq(runs.id, runId))
    .limit(1);
  if (!run) return { status: "skipped", reason: "run_not_found" };

  // Idempotenz: bereits erzeugt (auch leeres Array zählt als "versucht").
  if (run.introPreview !== null && run.introPreview !== undefined) {
    return { status: "skipped", reason: "already_generated" };
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

    const previews: IntroPreviewEntry[] = [];
    const seenNames = new Set<string>();
    let attempts = 0;

    const template = calibration.ttsTemplate?.trim() || DEFAULT_TTS_TEMPLATE;

    for (const lead of candidates) {
      if (previews.length >= PREVIEW_TARGET) break;
      if (attempts >= PREVIEW_MAX_ATTEMPTS) break;

      const substResult = resolveIntroSubstitutions(
        template,
        (lead.data ?? {}) as Record<string, string>,
      );
      if (!substResult.ok) continue;
      // Dedup-Key aus allen Substitutionen (Vorname ODER Anrede+Nachname).
      const nameKey = Object.values(substResult.substitutions)
        .join(" ")
        .toLowerCase();
      if (seenNames.has(nameKey)) continue;
      seenNames.add(nameKey);

      attempts += 1;
      try {
        const result = await generatePersonalizedWebcam({
          userId: run.userId,
          tag: `pv-${lead.id.slice(0, 8)}`,
          substitutions: substResult.substitutions,
          calibration,
          fishModelId: voiceProfile.fishModelId,
          webcamLocalPath,
          workDir: tmpDir,
          trimToSec: PREVIEW_TRIM_SEC,
        });
        if (!result.ok) {
          console.warn(
            `[intro-preview:${runId}] lead ${lead.id} fallback: ${result.reason}`,
          );
          continue;
        }
        const upload = await uploadIntroFile({
          userId: run.userId,
          fileName: `preview-${runId}-${lead.id}.mp4`,
          buffer: await readFile(result.outputPath),
          contentType: "video/mp4",
        });
        previews.push({ leadId: lead.id, videoUrl: upload.url });
      } catch (err) {
        console.warn(
          `[intro-preview:${runId}] lead ${lead.id} error: ${(err as Error).message}`,
        );
      }
    }

    // Auch [] schreiben — signalisiert der UI "versucht, nichts gelungen"
    // (Approve-Gate greift bei leerem Array bewusst NICHT).
    await db
      .update(runs)
      .set({ introPreview: previews })
      .where(eq(runs.id, runId));

    return { status: "done", previews: previews.length };
  } finally {
    await cleanupTempDir(tmpDir);
  }
}
