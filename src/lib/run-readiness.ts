/**
 * Run-Readiness-Gate (Reliability 2026-08-21).
 *
 * ZENTRALE Vorab-Prüfung: Kann diese Kampagne in ihrer aktuellen
 * Konfiguration überhaupt vollständig produzieren? Wird von ALLEN
 * Run-Start-Pfaden aufgerufen (POST /api/runs/[id]/start und
 * POST /api/campaigns/[id]/runs/from-list), damit kein Pfad mehr an den
 * Gates vorbei in die Produktion rennt (Vorfall 2026-08-21: from-list
 * startete eine Intro-Kampagne ohne bereite Kalibrierung — die Runde
 * lief still komplett ohne KI-Begrüßung durch).
 *
 * Die Bedingungen spiegeln exakt die Annahmen der Pipeline-Stages:
 *   - Webcam-Video mit publicUrl  → Stage 1-2 wirft sonst pro Lead.
 *   - with-presentation Segmente  → Renderer braucht mind. 1 Segment.
 *   - pdfEnabled → Google-Docs-URL, sonst entsteht nie ein Brief.
 *   - introEnabled → Stimme + Kalibrierung ready (gleiche Logik wie
 *     intro-generation.ts), sonst endet jeder Lead in 'disabled'.
 *   - Umschlag-Vorlage muss existieren, sonst skippt Stage 9b still.
 */

import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  campaigns,
  envelopeTemplates,
  introCalibrations,
  mediaItems,
  voiceProfiles,
} from "@/lib/db/schema";

export interface RunReadinessBlocker {
  code:
    | "campaign_not_found"
    | "webcam_missing"
    | "segments_missing"
    | "pdf_url_missing"
    | "intro_not_ready"
    | "envelope_template_missing";
  message: string;
}

export interface RunReadinessResult {
  ok: boolean;
  blockers: RunReadinessBlocker[];
  /** Kampagne hat die KI-Begrüßung aktiviert. */
  introEnabled: boolean;
  /** Stimme + Kalibrierung sind bereit — Begrüßung kann geliefert werden. */
  introReady: boolean;
}

export async function checkRunReadiness(input: {
  userId: string;
  campaignId: string;
  /** Runden-Override der Umschlag-Vorlage (z.B. from-list-Wizard). */
  envelopeTemplateIdOverride?: string | null;
  /**
   * true  → nicht bereite KI-Begrüßung blockiert den Start (from-list —
   *         dort gibt es keine Review-Seite mit Opt-out).
   * false → der Aufrufer hat ein eigenes Intro-Gate mit expliziter
   *         „ohne KI-Begrüßung produzieren"-Entscheidung (/start).
   */
  requireIntroReady: boolean;
}): Promise<RunReadinessResult> {
  const blockers: RunReadinessBlocker[] = [];

  const [campaign] = await db
    .select({
      mode: campaigns.mode,
      segments: campaigns.segments,
      webcamMediaId: campaigns.webcamMediaId,
      pdfEnabled: campaigns.pdfEnabled,
      pdfGoogleDocsUrl: campaigns.pdfGoogleDocsUrl,
      introEnabled: campaigns.introEnabled,
      envelopeTemplateId: campaigns.envelopeTemplateId,
    })
    .from(campaigns)
    .where(eq(campaigns.id, input.campaignId))
    .limit(1);

  if (!campaign) {
    return {
      ok: false,
      blockers: [
        {
          code: "campaign_not_found",
          message: "Diese Kampagne gibt es nicht mehr.",
        },
      ],
      introEnabled: false,
      introReady: false,
    };
  }

  // ── Webcam-Video (Pflicht für jede Video-Produktion) ─────────────────
  let webcamOk = false;
  if (campaign.webcamMediaId) {
    const [media] = await db
      .select({ publicUrl: mediaItems.publicUrl })
      .from(mediaItems)
      .where(eq(mediaItems.id, campaign.webcamMediaId))
      .limit(1);
    webcamOk = !!media?.publicUrl;
  }
  if (!webcamOk) {
    blockers.push({
      code: "webcam_missing",
      message:
        "Der Kampagne fehlt ein Webcam-Video. Bitte nimm eins auf oder lade eins hoch, bevor du die Runde startest.",
    });
  }

  // ── Präsentations-Segmente ───────────────────────────────────────────
  if (
    campaign.mode === "with-presentation" &&
    (!Array.isArray(campaign.segments) || campaign.segments.length === 0)
  ) {
    blockers.push({
      code: "segments_missing",
      message:
        "Die Kampagne ist auf „Video mit Inhalten“ eingestellt, hat aber keine Inhalte (Szenen). Bitte füge mindestens eine Szene hinzu.",
    });
  }

  // ── PDF-Brief ────────────────────────────────────────────────────────
  if (
    campaign.pdfEnabled &&
    !(
      typeof campaign.pdfGoogleDocsUrl === "string" &&
      campaign.pdfGoogleDocsUrl.trim() !== ""
    )
  ) {
    blockers.push({
      code: "pdf_url_missing",
      message:
        "Der PDF-Brief ist aktiviert, aber es ist keine Google-Docs-Vorlage hinterlegt. Bitte Vorlage verknüpfen oder den Brief deaktivieren.",
    });
  }

  // ── KI-Begrüßung ─────────────────────────────────────────────────────
  // Gleiche Bereitschafts-Logik wie der Staging-Worker
  // (intro-generation.ts): Kampagnen-Stimme bevorzugt, Account-Stimme als
  // Fallback; die Webcam-Kalibrierung muss ready sein.
  const introEnabled = campaign.introEnabled === true;
  let introReady = false;
  if (introEnabled && campaign.webcamMediaId) {
    const [voice] = await db
      .select({ status: voiceProfiles.status })
      .from(voiceProfiles)
      .where(eq(voiceProfiles.userId, input.userId))
      .limit(1);
    const [calib] = await db
      .select({
        status: introCalibrations.status,
        voiceStatus: introCalibrations.voiceStatus,
        voiceFishModelId: introCalibrations.voiceFishModelId,
      })
      .from(introCalibrations)
      .where(eq(introCalibrations.mediaItemId, campaign.webcamMediaId))
      .limit(1);
    const hasVoice =
      (calib?.voiceStatus === "ready" && !!calib.voiceFishModelId) ||
      voice?.status === "ready";
    introReady = hasVoice && calib?.status === "ready";
  }
  if (introEnabled && !introReady && input.requireIntroReady) {
    blockers.push({
      code: "intro_not_ready",
      message:
        "Die KI-Begrüßung ist aktiviert, aber Stimme oder Webcam-Kalibrierung sind noch nicht bereit. Bitte prüf das Webcam-Video in den Kampagnen-Einstellungen — oder schalte die KI-Begrüßung aus, wenn die Runde ohne laufen soll.",
    });
  }

  // ── Umschlag-Vorlage ─────────────────────────────────────────────────
  const effectiveEnvelopeTemplateId =
    input.envelopeTemplateIdOverride ?? campaign.envelopeTemplateId ?? null;
  if (effectiveEnvelopeTemplateId) {
    const [tpl] = await db
      .select({ id: envelopeTemplates.id })
      .from(envelopeTemplates)
      .where(eq(envelopeTemplates.id, effectiveEnvelopeTemplateId))
      .limit(1);
    if (!tpl) {
      blockers.push({
        code: "envelope_template_missing",
        message:
          "Die gewählte Umschlag-Vorlage existiert nicht mehr. Bitte wähl eine andere Vorlage oder starte ohne Umschlag.",
      });
    }
  }

  return { ok: blockers.length === 0, blockers, introEnabled, introReady };
}
