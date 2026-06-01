/**
 * Gemeinsame Typen + UI-Helper für die Custom-Domain-Komponenten.
 *
 * Status-Lebenszyklus laut Worker:
 *   pending → verifying → issuing_cert → active   (Happy-Path)
 *   pending → ... → failed                        (nach 24h Backoff)
 */

export type DomainStatus =
  | "pending"
  | "verifying"
  | "issuing_cert"
  | "active"
  | "failed";

export type DomainKind = "subdomain" | "apex";

export interface DnsInstructionRecord {
  type: string;
  name: string;
  value: string;
}

export interface DnsInstructions {
  verifyRecord: DnsInstructionRecord;
  pointing: DnsInstructionRecord;
}

export interface DomainListItem {
  id: string;
  hostname: string;
  kind: DomainKind;
  status: DomainStatus;
  verifiedAt: string | null;
  sslExpiresAt: string | null;
  lastCheckedAt: string | null;
  lastError: string | null;
  createdAt: string;
  dnsInstructions?: DnsInstructions;
}

/** Deutsch-Label für Status — wird im Badge und in Toasts genutzt. */
export function statusLabel(status: DomainStatus): string {
  switch (status) {
    case "pending":
      return "Wartet";
    case "verifying":
      return "DNS-Prüfung";
    case "issuing_cert":
      return "SSL wird ausgestellt";
    case "active":
      return "Aktiv";
    case "failed":
      return "Fehlgeschlagen";
  }
}

/**
 * Badge-Farbschema laut Vorgabe:
 *  - active → success (gruen)
 *  - verifying / issuing_cert → warn (gelb)
 *  - failed → danger (rot)
 *  - pending → neutral (grau)
 */
export function statusBadgeVariant(
  status: DomainStatus,
): "success" | "warn" | "danger" | "neutral" {
  switch (status) {
    case "active":
      return "success";
    case "verifying":
    case "issuing_cert":
      return "warn";
    case "failed":
      return "danger";
    case "pending":
    default:
      return "neutral";
  }
}

/** Kurz-Format für "Letzte Prüfung" / "SSL gueltig bis" Spalten. */
export function formatRelativeOrDate(
  iso: string | null,
  fallback = "—",
): string {
  if (!iso) return fallback;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return fallback;
  const now = Date.now();
  const diff = now - d.getTime();
  const sec = Math.round(diff / 1000);
  if (sec < 60) return "Gerade eben";
  if (sec < 3600) return `vor ${Math.round(sec / 60)} Min`;
  if (sec < 86400) return `vor ${Math.round(sec / 3600)} Std`;
  if (sec < 7 * 86400) return `vor ${Math.round(sec / 86400)} Tg`;
  return d.toLocaleDateString("de-DE", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

export function formatAbsoluteDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("de-DE", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}
