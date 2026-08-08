/**
 * Zentrale Klartext-Labels für Run-Status. Rohe Status-Strings wie
 * "awaiting_approval" dürfen NIE im UI landen — User verstehen sie nicht.
 * Jedes Label ist einfaches Deutsch und sagt, was gerade passiert bzw.
 * was der User tun soll.
 */

export type RunStatus =
  | "draft"
  | "mapping"
  | "preflighting"
  | "awaiting_approval"
  | "approved"
  | "generating"
  | "completed"
  | "failed"
  | "cancelled";

export type RunStatusVariant = "brand" | "success" | "warn" | "danger" | "neutral";

const LABELS: Record<RunStatus, string> = {
  draft: "Entwurf",
  mapping: "Wird vorbereitet",
  preflighting: "Leads werden geprüft",
  awaiting_approval: "Wartet auf deine Freigabe",
  approved: "Freigegeben, startet gleich",
  generating: "Videos werden erstellt",
  completed: "Fertig",
  failed: "Fehlgeschlagen",
  cancelled: "Abgebrochen",
};

const VARIANTS: Record<RunStatus, RunStatusVariant> = {
  draft: "neutral",
  mapping: "brand",
  preflighting: "brand",
  awaiting_approval: "warn",
  approved: "brand",
  generating: "brand",
  completed: "success",
  failed: "danger",
  cancelled: "neutral",
};

export function runStatusLabel(status: string): string {
  return LABELS[status as RunStatus] ?? "In Arbeit";
}

export function runStatusVariant(status: string): RunStatusVariant {
  return VARIANTS[status as RunStatus] ?? "neutral";
}
