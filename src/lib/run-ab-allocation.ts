/**
 * A/B-Varianten-Zuteilung beim Run-Start (extrahiert 2026-08-21).
 *
 * Vorher lebte diese Logik nur in POST /api/runs/[id]/start — der
 * from-list-Pfad startete Runden OHNE Zuteilung: Leads bekamen still
 * Variante A (Fallback in der PDF-Stage), ohne in der A/B-Statistik zu
 * zählen. Jetzt teilen sich beide Start-Pfade exakt diese eine Funktion.
 *
 * Läuft NACH Dedupe + Validierung, damit nur echte (nicht-removed) Leads
 * in die Quote zählen. Die Regel + beide Brief-URLs werden als Snapshot in
 * `runs.abConfig` eingefroren — spätere Kampagnen-Änderungen (Test
 * deaktivieren, Gewinner übernehmen) ändern laufende Runden nicht.
 *
 * Exakte Quote statt Münzwurf: bei "random" wird per Fisher-Yates
 * geshuffelt und exakt round(n·weightA%) Leads bekommen A — ein
 * Bernoulli-Wurf pro Lead würde bei kleinen Listen stark streuen.
 */

import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { leads, runs } from "@/lib/db/schema";
import type { RunAbConfig } from "@/lib/db/schema";

export interface AbCampaignConfig {
  abTestingEnabled: boolean;
  pdfEnabled: boolean;
  pdfGoogleDocsUrl: string | null;
  pdfGoogleDocsUrlB: string | null;
  abSplitMode: "random" | "sequential";
  abSplitWeightA: number;
}

/**
 * Teilt allen nicht-removed Leads des Runs eine A/B-Variante zu und
 * schreibt den Snapshot nach `runs.abConfig`. Liefert den Snapshot oder
 * null, wenn der A/B-Test für diese Kampagne nicht aktiv/vollständig ist.
 */
export async function allocateAbVariantsForRun(input: {
  runId: string;
  campaign: AbCampaignConfig;
  /** Regel-Override aus dem Wizard; ohne Body gilt die Kampagnen-Regel. */
  abRequest?: { mode: "random" | "sequential"; weightA: number } | null;
  /**
   * true (Default) → Snapshot direkt nach runs.abConfig schreiben.
   * false → Aufrufer persistiert selbst (z.B. /start schreibt ihn im
   * selben updateRun mit dem Status-Übergang).
   */
  persistToRun?: boolean;
}): Promise<RunAbConfig | null> {
  const { campaign } = input;
  const abActive =
    campaign.abTestingEnabled === true &&
    campaign.pdfEnabled === true &&
    typeof campaign.pdfGoogleDocsUrl === "string" &&
    campaign.pdfGoogleDocsUrl.trim() !== "" &&
    typeof campaign.pdfGoogleDocsUrlB === "string" &&
    campaign.pdfGoogleDocsUrlB.trim() !== "";
  if (!abActive) return null;

  const rule = input.abRequest ?? {
    mode: campaign.abSplitMode,
    weightA: campaign.abSplitWeightA,
  };
  const abConfig: RunAbConfig = {
    mode: rule.mode,
    weightA: rule.weightA,
    urlA: campaign.pdfGoogleDocsUrl!.trim(),
    urlB: campaign.pdfGoogleDocsUrlB!.trim(),
  };

  const eligible = await db
    .select({ id: leads.id, rowIndex: leads.rowIndex })
    .from(leads)
    .where(and(eq(leads.runId, input.runId), isNull(leads.removedAt)))
    .orderBy(leads.rowIndex);

  const countA = Math.round((rule.weightA / 100) * eligible.length);
  let idsA: string[];
  if (rule.mode === "sequential") {
    idsA = eligible.slice(0, countA).map((l) => l.id);
  } else {
    const shuffled = [...eligible];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    idsA = shuffled.slice(0, countA).map((l) => l.id);
  }
  const idsASet = new Set(idsA);
  const idsB = eligible.filter((l) => !idsASet.has(l.id)).map((l) => l.id);

  if (idsA.length > 0) {
    await db.update(leads).set({ abVariant: "A" }).where(inArray(leads.id, idsA));
  }
  if (idsB.length > 0) {
    await db.update(leads).set({ abVariant: "B" }).where(inArray(leads.id, idsB));
  }

  if (input.persistToRun !== false) {
    await db
      .update(runs)
      .set({ abConfig })
      .where(eq(runs.id, input.runId));
  }

  return abConfig;
}
