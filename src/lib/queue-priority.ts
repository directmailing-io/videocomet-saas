/**
 * Faire Warteschlange (W3): Render-/Intro-Jobs bekommen eine BullMQ-Priorität
 * nach Zeilen-Reihenfolge (rowIndex). Effekt bei mehreren gleichzeitigen
 * Kunden: die ersten Leads JEDES Runs laufen früh — ein 500er-Run blockiert
 * einen kleinen 20er-Run nicht mehr komplett.
 *
 * BullMQ: kleinere Zahl = früher dran; 0/undefined = unpriorisiert und läuft
 * VOR allen priorisierten Jobs (Alt-Jobs beim Rollout bleiben also vorne —
 * bewusst, kein Fairness-Bruch, nur eine Übergangsphase).
 */

/** BullMQ-Hard-Cap für priority (2^21). */
export const MAX_BULLMQ_PRIORITY = 2_097_152;

export function leadJobPriority(rowIndex: number | null | undefined): number {
  const idx =
    typeof rowIndex === "number" && Number.isFinite(rowIndex) && rowIndex >= 0
      ? rowIndex
      : 0;
  return Math.min(idx + 1, MAX_BULLMQ_PRIORITY);
}
