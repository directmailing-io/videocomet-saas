export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { eq, inArray } from "drizzle-orm";
import { requireUserApi } from "@/lib/auth-guard";
import { db } from "@/lib/db";
import { campaigns, leads, voiceProfiles } from "@/lib/db/schema";
import { getPreflightCounts } from "@/lib/db/queries/leads";
import { getRunForPreflight } from "@/lib/db/queries/runs";
import { INTRO_PREVIEW_TARGET } from "@/lib/intro";

/**
 * Intro-Block der Status-Antwort (personalisierte Video-Begrüßung,
 * Migration 0042). `previews` sind die Beispielvideos aus
 * `runs.intro_preview`, angereichert um den Lead-Vornamen fürs Label.
 */
interface IntroStatusPayload {
  enabled: boolean;
  voiceReady: boolean;
  previewApprovedAt: string | null;
  /**
   * `true` sobald `intro_preview_completed_at` gesetzt ist — der Worker
   * ist mit allen parallelen Renderings durch. `false` heißt „läuft
   * noch", auch wenn schon 1-2 Previews im Array stehen.
   */
  previewsGenerated: boolean;
  /** Ziel-Anzahl der Vorschau-Videos (INTRO_PREVIEW_TARGET). Für „X von N"-UI. */
  previewsExpected: number;
  previews: Array<{
    leadId: string;
    firstName: string | null;
    videoUrl: string;
  }>;
}

/** Vorname aus `leads.data` — gleiche Alias-Logik wie im Preflight-Grid. */
function pickFirstName(data: Record<string, string>): string | null {
  const direct = ["firstName", "Vorname", "first_name"];
  for (const k of direct) {
    const v = data[k];
    if (typeof v === "string" && v.trim().length > 0) return v.trim();
  }
  const normalise = (k: string) => k.toLowerCase().replace(/[^a-z0-9]/g, "");
  for (const [k, v] of Object.entries(data)) {
    if (
      typeof v === "string" &&
      v.trim().length > 0 &&
      direct.some((d) => normalise(d) === normalise(k))
    ) {
      return v.trim();
    }
  }
  return null;
}

/**
 * GET /api/runs/[id]/preflight/status
 *
 * Lightweight Polling-Endpoint für das UI. Liefert in einer Response
 * sowohl den Run-Lifecycle (started/completed) als auch die aggregierten
 * Lead-Counter. Progress-Percent basiert auf "alle nicht mehr in
 * pending/running" geteilt durch "total" — damit kommt 100% an, sobald
 * jeder Lead terminal ist (egal ob ok oder problematic).
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await requireUserApi();
  if (!auth.ok) return auth.response;

  let run;
  try {
    run = await getRunForPreflight(params.id, auth.user.id);
  } catch {
    return NextResponse.json(
      { error: "Run nicht gefunden.", details: null },
      { status: 404 },
    );
  }

  const counts = await getPreflightCounts(params.id, auth.user.id);

  const inFlight = counts.pending + counts.running;
  const progressPercent =
    counts.total === 0
      ? 0
      : Math.round(((counts.total - inFlight) / counts.total) * 100);

  // ── Intro-Status (personalisierte Video-Begrüßung) ──────────────────
  // Nur befüllt, wenn die Kampagne das Feature aktiviert hat. Das UI zeigt
  // damit Beispielvideos, den Generierungs-Fortschritt oder den Fallback-
  // Hinweis (kein ready-Voice-Profil → Original-Video, 1 Credit).
  let intro: IntroStatusPayload = {
    enabled: false,
    voiceReady: false,
    previewApprovedAt: null,
    previewsGenerated: false,
    previewsExpected: INTRO_PREVIEW_TARGET,
    previews: [],
  };
  const [campaign] = await db
    .select({ introEnabled: campaigns.introEnabled })
    .from(campaigns)
    .where(eq(campaigns.id, run.campaignId))
    .limit(1);
  if (campaign?.introEnabled) {
    const [voiceProfile] = await db
      .select({ status: voiceProfiles.status })
      .from(voiceProfiles)
      .where(eq(voiceProfiles.userId, auth.user.id))
      .limit(1);

    // Worker signalisiert das Ende über `intro_preview_completed_at`.
    // Bis dahin ist `intro_preview` ein möglicherweise wachsender
    // Zwischenstand (parallel gerenderte Previews werden inkrementell
    // angehängt).
    const generated = run.introPreviewCompletedAt !== null;
    const entries = run.introPreview ?? [];
    const firstNameByLead = new Map<string, string | null>();
    if (entries.length > 0) {
      const rows = await db
        .select({ id: leads.id, data: leads.data })
        .from(leads)
        .where(
          inArray(
            leads.id,
            entries.map((e) => e.leadId),
          ),
        );
      for (const row of rows) {
        firstNameByLead.set(row.id, pickFirstName(row.data ?? {}));
      }
    }

    intro = {
      enabled: true,
      voiceReady: voiceProfile?.status === "ready",
      previewApprovedAt: run.introPreviewApprovedAt
        ? run.introPreviewApprovedAt.toISOString()
        : null,
      previewsGenerated: generated,
      previewsExpected: INTRO_PREVIEW_TARGET,
      previews: entries.map((e) => ({
        leadId: e.leadId,
        firstName: firstNameByLead.get(e.leadId) ?? null,
        videoUrl: e.videoUrl,
      })),
    };
  }

  return NextResponse.json({
    runStatus: run.status,
    counts,
    startedAt: run.preflightStartedAt ? run.preflightStartedAt.toISOString() : null,
    completedAt: run.preflightCompletedAt
      ? run.preflightCompletedAt.toISOString()
      : null,
    progressPercent,
    intro,
  });
}
