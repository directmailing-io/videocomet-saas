/**
 * Small DE-locale formatting helpers shared across the Analytics area.
 * No "use client" — these are pure functions, safe in both server and
 * client components.
 */

/** "30.05.2026" */
export function fmtDate(input: Date | string | null | undefined): string {
  if (!input) return "—";
  const d = input instanceof Date ? input : new Date(input);
  if (!Number.isFinite(d.getTime())) return "—";
  return new Intl.DateTimeFormat("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(d);
}

/** "30.05.2026, 21:38" */
export function fmtDateTime(input: Date | string | null | undefined): string {
  if (!input) return "—";
  const d = input instanceof Date ? input : new Date(input);
  if (!Number.isFinite(d.getTime())) return "—";
  return new Intl.DateTimeFormat("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

/** "30.05.2026 21:38:45" — precise to the second, for event-log rows. */
export function fmtDateTimeSec(input: Date | string | null | undefined): string {
  if (!input) return "—";
  const d = input instanceof Date ? input : new Date(input);
  if (!Number.isFinite(d.getTime())) return "—";
  return new Intl.DateTimeFormat("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(d);
}

/** "1:23" or "12:05" — for watch-time / "at-sec" payload values. */
export function fmtDurationShort(sec: number | null | undefined): string {
  if (typeof sec !== "number" || !Number.isFinite(sec) || sec < 0) return "0:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/** "2h 15m" / "12m 03s" / "45s" — verbose watch-time. */
export function fmtDurationVerbose(sec: number | null | undefined): string {
  if (typeof sec !== "number" || !Number.isFinite(sec) || sec <= 0) return "0s";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s.toString().padStart(2, "0")}s`;
  return `${s}s`;
}

/** "1.234" — German thousands separator. */
export function fmtInt(n: number | null | undefined): string {
  if (typeof n !== "number" || !Number.isFinite(n)) return "0";
  return new Intl.NumberFormat("de-DE").format(Math.round(n));
}

/** "12,3 %" — German decimal comma, optional decimals (default 1). */
export function fmtPercent(
  numerator: number,
  denominator: number,
  decimals = 1,
): string {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) {
    return "—";
  }
  const pct = (numerator / denominator) * 100;
  return `${new Intl.NumberFormat("de-DE", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(pct)} %`;
}

/** Human-readable event-kind labels. */
export const KIND_LABELS: Record<string, string> = {
  page_view: "Aufruf",
  video_play: "Play",
  video_progress: "Progress",
  video_ended: "Beendet",
  cta_click: "CTA-Klick",
};

export function kindLabel(kind: string): string {
  return KIND_LABELS[kind] ?? kind;
}

/** Status label mirroring the values used in /dashboard. */
export function runStatusLabel(status: string): string {
  switch (status) {
    case "draft":
      return "Entwurf";
    case "mapping":
      return "Mapping";
    case "generating":
      return "Generierung";
    case "completed":
      return "Fertig";
    case "failed":
      return "Fehler";
    case "cancelled":
      return "Abgebrochen";
    default:
      return status;
  }
}

export function runStatusVariant(
  status: string,
): "brand" | "success" | "warn" | "danger" | "neutral" {
  switch (status) {
    case "completed":
      return "success";
    case "generating":
    case "mapping":
      return "brand";
    case "failed":
      return "danger";
    case "cancelled":
      return "warn";
    default:
      return "neutral";
  }
}
