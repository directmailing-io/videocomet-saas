import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { introCalibrations } from "@/lib/db/schema";
import { introCalibrationQueue } from "@/worker/intro-queue";
import { DEFAULT_TTS_TEMPLATE } from "@/lib/intro";

/**
 * Best-effort: Video-Kalibrierung für die KI-Begrüßung anstoßen, damit sie
 * beim ersten Run schon fertig ist. Fehler brechen den Aufrufer nie ab —
 * der Run-Start-Endpoint fällt ohne fertige Kalibrierung auf den
 * Direktpfad zurück. Wird bei Kampagnen-Erstellung UND bei der
 * Aktivierung eines Entwurfs aufgerufen.
 */
export async function ensureIntroCalibration(
  userId: string,
  webcamMediaId: string,
  introTtsTemplate?: string,
): Promise<void> {
  try {
    const [existing] = await db
      .select({
        id: introCalibrations.id,
        status: introCalibrations.status,
        voiceStatus: introCalibrations.voiceStatus,
      })
      .from(introCalibrations)
      .where(eq(introCalibrations.mediaItemId, webcamMediaId))
      .limit(1);
    if (existing && existing.status === "ready" && existing.voiceStatus !== "ready") {
      // Kalibrierung fertig, aber noch keine Kampagnen-Stimme (Video aus
      // der Zeit vor per-Video-Training oder Trainings-Fehler) → Job neu
      // anstoßen; der Processor misst neu und trainiert die Stimme mit.
      await introCalibrationQueue().add(
        "intro-calibration",
        { calibrationId: existing.id },
        { jobId: `intro-calibration-${existing.id}-${Date.now()}` },
      );
    }
    // Fertige oder laufende Kalibrierung nicht zurücksetzen.
    if (!existing || existing.status === "failed") {
      const initialTemplate = introTtsTemplate ?? DEFAULT_TTS_TEMPLATE;
      const [calibration] = await db
        .insert(introCalibrations)
        .values({
          mediaItemId: webcamMediaId,
          userId,
          status: "pending",
          ttsTemplate: initialTemplate,
        })
        .onConflictDoUpdate({
          target: introCalibrations.mediaItemId,
          set: {
            status: "pending",
            error: null,
            // Beim Retry-Weg (failed → pending) auch das Template
            // aktualisieren, wenn der Client eines mitgesendet hat.
            ...(introTtsTemplate ? { ttsTemplate: introTtsTemplate } : {}),
            updatedAt: sql`now()`,
          },
        })
        .returning();
      await introCalibrationQueue().add(
        "intro-calibration",
        { calibrationId: calibration.id },
        { jobId: `intro-calibration-${calibration.id}-${Date.now()}` },
      );
    }
  } catch (err) {
    console.error("[intro-calibration] enqueue failed:", err);
  }
}
