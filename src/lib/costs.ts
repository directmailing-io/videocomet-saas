/**
 * Kosten-Konstanten + Logger für externe API-Kosten pro Video-Job.
 *
 * Preise Stand 2026-09 (Standard-Tarife, keine Enterprise-Rabatte):
 *   - Fish Audio s2.1-pro: 15 € / 1M Zeichen
 *   - sync.so lipsync-2: 0,06 € / Sekunde generiertes Video
 *
 * Alle Beträge in Micro-EUR (1_000_000 = 1 €) — so bleiben Sub-Cent-
 * Preise (Fish: ~0,0015 € pro Anrede) rundungsfrei summierbar.
 *
 * Logging ist fire-and-forget: das Kosten-Log darf NIE einen Video-Render
 * blockieren oder scheitern lassen (Reporting-Nice-to-Have, kein Blocker).
 */

import { db } from "@/lib/db";
import { costEvents } from "@/lib/db/schema";

export const MICRO_EUR_PER_EUR = 1_000_000;

/** Fish Audio: 15 € / 1M chars → 15 Micro-EUR pro Zeichen. */
export const FISH_TTS_MICRO_EUR_PER_CHAR = 15;

/** sync.so lipsync-2: 0,06 € / s → 60_000 Micro-EUR pro Sekunde. */
export const SYNCSO_MICRO_EUR_PER_SECOND = 60_000;

export type CostKind = "intro_tts" | "intro_lipsync" | "other";

export interface LogCostEventInput {
  userId?: string | null;
  leadId?: string | null;
  runId?: string | null;
  campaignId?: string | null;
  kind: CostKind;
  amountMicroEur: number;
  meta?: Record<string, unknown>;
}

/**
 * Loggt einen Kosten-Event. Fehler werden geschluckt — das Kosten-Log
 * darf nie eine Video-Pipeline umbringen.
 */
export async function logCostEvent(input: LogCostEventInput): Promise<void> {
  try {
    if (!Number.isFinite(input.amountMicroEur) || input.amountMicroEur < 0) {
      return;
    }
    await db.insert(costEvents).values({
      userId: input.userId ?? null,
      leadId: input.leadId ?? null,
      runId: input.runId ?? null,
      campaignId: input.campaignId ?? null,
      kind: input.kind,
      amountMicroEur: Math.round(input.amountMicroEur),
      meta: input.meta ?? {},
    });
  } catch (err) {
    console.warn(
      `[costs] log failed (${input.kind}):`,
      (err as Error).message?.slice(0, 200),
    );
  }
}

/** Formatiert Micro-EUR als „0,4523 €" für Anzeige. */
export function formatMicroEur(microEur: number): string {
  const eur = microEur / MICRO_EUR_PER_EUR;
  return new Intl.NumberFormat("de-DE", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 4,
    maximumFractionDigits: 4,
  }).format(eur);
}

/** Kompakt für Übersichten: „12,34 €" (2 Nachkommastellen). */
export function formatMicroEurCompact(microEur: number): string {
  const eur = microEur / MICRO_EUR_PER_EUR;
  return new Intl.NumberFormat("de-DE", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(eur);
}
