"use client";

import * as React from "react";
import { AlertTriangle, Loader2, RotateCcw } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/**
 * Pre-Flight-Status — exakt der Enum-Vertrag aus dem Backend.
 */
export type PreflightStatus =
  | "pending"
  | "running"
  | "ok"
  | "url_dead"
  | "url_redirect"
  | "missing_field"
  | "duplicate"
  | "tls_error"
  | "slow"
  | "bot_block"
  | "screenshot_unavailable"
  | "unknown_error";

/**
 * Lead-Datensatz, wie er aus `/api/runs/[id]/preflight/leads` kommt.
 * Wird hier exportiert, damit Grid, Lightbox & Toolbar dieselbe Quelle
 * der Wahrheit teilen.
 */
export interface PreflightLead {
  id: string;
  runId: string;
  rowIndex: number;
  firstName: string | null;
  lastName: string | null;
  fullName: string | null;
  companyName: string | null;
  websiteUrl: string | null;
  preflightStatus: PreflightStatus;
  preflightFinalUrl: string | null;
  preflightHttpStatus: number | null;
  preflightDurationMs: number | null;
  preflightErrorMessage: string | null;
  preflightScreenshotUrl: string | null;
  preflightAttempts: number;
  duplicateOfLeadId: string | null;
  removedAt: string | null;
  approvedAt: string | null;
}

/**
 * Status-Klassifizierung in drei Schweregrade.
 * - "danger" markiert "Lead defekt, Video würde peinlich aussehen"
 * - "warn"   markiert "Lead wahrscheinlich problematisch, prüfen"
 * - "info"   markiert "Lead funktional unvollständig, aber rettbar"
 * - "ok"     markiert "alles in Ordnung — keine visuelle Auszeichnung"
 * - "neutral" markiert nicht-finale Phasen (pending/running)
 */
export type StatusSeverity = "danger" | "warn" | "info" | "ok" | "neutral";

export function severityOf(status: PreflightStatus): StatusSeverity {
  switch (status) {
    case "url_dead":
    case "tls_error":
      return "danger";
    case "url_redirect":
    case "slow":
    case "bot_block":
      return "warn";
    case "missing_field":
    case "duplicate":
    case "screenshot_unavailable":
    case "unknown_error":
      return "info";
    case "ok":
      return "ok";
    default:
      return "neutral";
  }
}

export const STATUS_LABEL: Record<PreflightStatus, string> = {
  pending: "Wartet",
  running: "Lädt…",
  ok: "OK",
  url_dead: "URL tot",
  url_redirect: "Umleitung",
  missing_field: "Daten unvollständig",
  duplicate: "Duplikat",
  tls_error: "TLS-Fehler",
  slow: "Langsam",
  bot_block: "Bot-Block",
  screenshot_unavailable: "Screenshot fehlt",
  unknown_error: "Fehler",
};

/**
 * Sichtbare Counts-Konfiguration für die Filter-Toolbar.
 * (Wird vom Client zusammengezählt.)
 */
export interface StatusCounts {
  pending: number;
  running: number;
  ok: number;
  problematic: number;
  removed: number;
  total: number;
}

export function isProblematic(status: PreflightStatus): boolean {
  const s = severityOf(status);
  return s === "danger" || s === "warn" || s === "info";
}

/**
 * Display-Helpers, von Grid + Lightbox geteilt.
 */
export function displayName(lead: PreflightLead): string {
  if (lead.fullName && lead.fullName.trim().length > 0) return lead.fullName;
  const parts = [lead.firstName, lead.lastName].filter(
    (p): p is string => typeof p === "string" && p.trim().length > 0,
  );
  if (parts.length > 0) return parts.join(" ");
  return `Lead #${lead.rowIndex + 1}`;
}

export function displayCompany(lead: PreflightLead): string {
  return lead.companyName?.trim() || "—";
}

export function displayDomain(lead: PreflightLead): string {
  const url = lead.preflightFinalUrl ?? lead.websiteUrl;
  if (!url) return "—";
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0];
  }
}

export function displayDuration(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms)) return "—";
  if (ms < 1000) return `${ms} ms`;
  const s = ms / 1000;
  return `${s.toFixed(s >= 10 ? 0 : 1)} s`;
}

const severityTopBorder: Record<StatusSeverity, string> = {
  danger: "before:bg-danger",
  warn: "before:bg-warn",
  info: "before:bg-ink-muted/40",
  ok: "before:bg-transparent",
  neutral: "before:bg-transparent",
};

const severityBadgeVariant: Record<
  StatusSeverity,
  "danger" | "warn" | "neutral" | "brand"
> = {
  danger: "danger",
  warn: "warn",
  info: "neutral",
  ok: "neutral",
  neutral: "brand",
};

export interface LeadCardProps {
  lead: PreflightLead;
  selected: boolean;
  focused: boolean;
  onSelectToggle: (e: React.MouseEvent | React.KeyboardEvent) => void;
  onOpen: () => void;
  onRetryScreenshot: () => void;
}

/**
 * Eine einzelne Karte im Grid. Bewusst memoized — die Card-Komponente
 * darf nur re-rendern, wenn sich ihre Inputs ändern. Sonst macht das
 * SSE-Tick bei 500 Karten 500× Reconciliation.
 */
function LeadCardImpl({
  lead,
  selected,
  focused,
  onSelectToggle,
  onOpen,
  onRetryScreenshot,
}: LeadCardProps) {
  const sev = severityOf(lead.preflightStatus);
  const problematic = isProblematic(lead.preflightStatus);
  const status = lead.preflightStatus;

  const showSpinner = status === "running";
  const showSkeleton = status === "pending";
  const hasScreenshot = Boolean(lead.preflightScreenshotUrl);

  function handleKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      onOpen();
    } else if (e.key === " ") {
      e.preventDefault();
      onSelectToggle(e);
    }
  }

  return (
    <div
      role="gridcell"
      tabIndex={focused ? 0 : -1}
      aria-selected={selected}
      aria-label={`${displayName(lead)} – ${STATUS_LABEL[status]}`}
      onClick={onOpen}
      onKeyDown={handleKeyDown}
      className={cn(
        "group relative flex flex-col bg-surface border border-line rounded-squircle-sm overflow-hidden cursor-pointer transition-all duration-150",
        "before:absolute before:top-0 before:left-0 before:right-0 before:h-[2px] before:content-['']",
        severityTopBorder[sev],
        "hover:shadow-card hover:-translate-y-0.5",
        selected && "ring-2 ring-brand ring-offset-1 ring-offset-surface-soft",
        focused && !selected && "ring-2 ring-brand/30",
        lead.removedAt && "opacity-50",
      )}
    >
      {/* Bild-Bereich (16:9) */}
      <div className="relative aspect-video bg-surface-muted overflow-hidden">
        {showSkeleton ? (
          <div className="absolute inset-0 bg-gradient-to-br from-surface-muted via-line-soft to-surface-muted animate-pulse" />
        ) : showSpinner ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 bg-surface-muted">
            <Loader2 className="size-5 text-brand animate-spin" />
            <span className="text-[11px] font-medium text-ink-muted">Lädt…</span>
          </div>
        ) : hasScreenshot ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={lead.preflightScreenshotUrl ?? undefined}
            alt={`Webseite von ${displayDomain(lead)}`}
            loading="lazy"
            decoding="async"
            className="absolute inset-0 size-full object-cover"
          />
        ) : (
          // Terminal-Status ohne Screenshot → AlertTriangle + Retry
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-3 text-center bg-surface-muted">
            <AlertTriangle className="size-5 text-warn" />
            <span className="text-[11px] font-medium text-ink leading-tight">
              Screenshot fehlgeschlagen
            </span>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onRetryScreenshot();
              }}
              aria-label="Screenshot erneut versuchen"
              className="inline-flex items-center gap-1 text-[11px] font-semibold text-brand-deep hover:text-brand-800 transition-colors"
            >
              <RotateCcw className="size-3" />
              Neu versuchen
            </button>
          </div>
        )}

        {/* Status-Pill (nur bei Problem / nicht-ok) */}
        {sev !== "ok" && sev !== "neutral" && (
          <div className="absolute top-2 left-2">
            <Badge
              variant={severityBadgeVariant[sev]}
              dot
              className="shadow-card backdrop-blur-sm bg-opacity-95"
            >
              {STATUS_LABEL[status]}
            </Badge>
          </div>
        )}
        {status === "running" && (
          <div className="absolute top-2 left-2">
            <Badge variant="brand" className="shadow-card">
              <Loader2 className="size-3 animate-spin" />
              Lädt…
            </Badge>
          </div>
        )}

        {/* Checkbox rechts-unten:
            - Problem-Karten: immer sichtbar
            - OK-Karten: nur on-hover bzw. wenn selected */}
        <div
          className={cn(
            "absolute bottom-2 right-2 z-10 transition-opacity duration-150",
            problematic || selected
              ? "opacity-100"
              : "opacity-0 group-hover:opacity-100 focus-within:opacity-100",
          )}
          onClick={(e) => e.stopPropagation()}
        >
          <span
            role="presentation"
            className="flex items-center justify-center size-7 rounded-md bg-surface/95 shadow-card backdrop-blur-sm border border-line/80"
          >
            <Checkbox
              checked={selected}
              onClick={(e) => {
                e.stopPropagation();
                onSelectToggle(e);
              }}
              aria-label={selected ? "Auswahl aufheben" : "Lead markieren"}
            />
          </span>
        </div>
      </div>

      {/* Footer */}
      <div className="flex flex-col gap-0.5 px-3 py-2.5 min-w-0">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-sm font-semibold text-ink truncate">
            {displayName(lead)}
          </span>
          {displayCompany(lead) !== "—" && (
            <>
              <span className="text-ink-muted text-xs shrink-0">·</span>
              <span className="text-sm text-ink-soft truncate min-w-0">
                {displayCompany(lead)}
              </span>
            </>
          )}
        </div>
        <div className="flex items-center gap-1.5 text-xs text-ink-muted tabular-nums">
          <span className="truncate">{displayDomain(lead)}</span>
          {lead.preflightDurationMs !== null && (
            <>
              <span className="shrink-0">·</span>
              <span className="shrink-0">
                {displayDuration(lead.preflightDurationMs)}
              </span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export const LeadCard = React.memo(LeadCardImpl, (prev, next) => {
  // Karten neu rendern, wenn sich ihre relevanten Inputs ändern.
  // Wir vermeiden vor allem unnötige Reconciliation bei SSE-Bursts,
  // bei denen 99 % der Karten identisch bleiben.
  return (
    prev.selected === next.selected &&
    prev.focused === next.focused &&
    prev.lead === next.lead &&
    prev.onOpen === next.onOpen &&
    prev.onSelectToggle === next.onSelectToggle &&
    prev.onRetryScreenshot === next.onRetryScreenshot
  );
});
LeadCard.displayName = "LeadCard";
