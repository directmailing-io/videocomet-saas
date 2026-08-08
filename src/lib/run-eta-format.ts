/**
 * Geteilte Typen + Formatierung für die Run-ETA (W3). Bewusst ohne
 * Server-Imports — wird sowohl im Worker (Berechnung) als auch in
 * Client-Komponenten (Anzeige) verwendet.
 */

export interface RunEtaEntry {
  /** Geglättete Rest-Dauer ab `updatedAt`. */
  remainingMs: number;
  /** Untere Kante der Spanne (optimistisch). */
  lowMs: number;
  /** Obere Kante der Spanne (konservativ). */
  highMs: number;
  /** ISO-Zeitpunkt der Berechnung — Anzeige zählt ab hier herunter. */
  updatedAt: string;
  renderRemaining: number;
  introRemaining: number;
}

function roundToStepMs(ms: number, stepMin: number): number {
  const step = stepMin * 60_000;
  return Math.round(ms / step) * step;
}

function formatDurationDe(ms: number): string {
  if (ms < 120_000) return "unter 2 Min.";
  const rounded = ms >= 3_600_000 ? roundToStepMs(ms, 5) : roundToStepMs(ms, 1);
  const totalMin = Math.round(rounded / 60_000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h === 0) return `~${m} Min.`;
  if (m === 0) return `~${h} Std.`;
  return `~${h} Std. ${m} Min.`;
}

function formatClockDe(date: Date): string {
  const rounded = new Date(Math.round(date.getTime() / 300_000) * 300_000);
  const hh = String(rounded.getHours()).padStart(2, "0");
  const mm = String(rounded.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

/**
 * "Noch ~2 Std. 10 Min. · fertig ca. zwischen 16:45 und 17:30 Uhr".
 * Zählt ab `updatedAt` herunter; liefert `null`, wenn der Cache-Eintrag
 * veraltet ist (>3 min alt — Worker schreibt alle ~12 s).
 */
export function formatRunEta(
  entry: RunEtaEntry,
  nowMs: number = Date.now(),
): string | null {
  const updated = Date.parse(entry.updatedAt);
  if (!Number.isFinite(updated) || nowMs - updated > 180_000) return null;
  const elapsed = Math.max(0, nowMs - updated);
  const remaining = Math.max(0, entry.remainingMs - elapsed);
  const low = Math.max(0, entry.lowMs - elapsed);
  const high = Math.max(low + 60_000, entry.highMs - elapsed);

  const fromLabel = formatClockDe(new Date(nowMs + low));
  const toLabel = formatClockDe(new Date(nowMs + high));
  const spansDays = new Date(nowMs + high).getDate() !== new Date(nowMs).getDate();
  const windowLabel = spansDays
    ? ""
    : fromLabel === toLabel
      ? ` · fertig ca. ${toLabel} Uhr`
      : ` · fertig ca. zwischen ${fromLabel} und ${toLabel} Uhr`;
  return `Noch ${formatDurationDe(remaining)}${windowLabel}`;
}
